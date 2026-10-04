import { z } from 'zod';
import type { VisualEvidence } from './research-types';

export const MAX_VISUAL_SCREENSHOT_BYTES = 100 * 1024;
const screenshotPrefix = 'data:image/jpeg;base64,';
const safeText = (max: number) => z.string().trim().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'Le texte contient des caractères de contrôle.');

/** No resource is fetched: this check only constrains the public page cited by the user. */
export function isPublicVisualUrl(value: string): boolean {
  if (!value || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host) return false;
    if (/^(?:localhost|0\.0\.0\.0)$/.test(host) || /(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(host)) return false;
    if (host.startsWith('[')) {
      const ip = host.slice(1, -1);
      return !/^(?:0*:[0:]*$|::1$|f[cd]|fe[89ab]|ff|::ffff:)/i.test(ip);
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b));
    }
    return host.includes('.');
  } catch { return false; }
}

/** Inspect a bounded JPEG container, rather than trusting its data-URL MIME label. */
export function isValidVisualScreenshot(value: string): boolean {
  if (!value.startsWith(screenshotPrefix)) return false;
  const encoded = value.slice(screenshotPrefix.length);
  if (!encoded || encoded.length > Math.ceil(MAX_VISUAL_SCREENSHOT_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  let bytes: string;
  try { bytes = atob(encoded); } catch { return false; }
  if (bytes.length > MAX_VISUAL_SCREENSHOT_BYTES || bytes.length < 20 || bytes.charCodeAt(0) !== 0xff || bytes.charCodeAt(1) !== 0xd8 || bytes.charCodeAt(bytes.length - 2) !== 0xff || bytes.charCodeAt(bytes.length - 1) !== 0xd9) return false;
  let position = 2, hasFrame = false;
  const byte = (index: number) => bytes.charCodeAt(index);
  while (position < bytes.length - 2) {
    if (byte(position++) !== 0xff) return false;
    while (byte(position) === 0xff) position++;
    const marker = byte(position++);
    if (marker === 0xd9 || marker === 0xd8 || marker === 0 || marker >= 0xd0 && marker <= 0xd7) return false;
    if (position + 2 > bytes.length) return false;
    const length = byte(position) * 256 + byte(position + 1);
    if (length < 2 || position + length > bytes.length - 2) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 11) return false;
      const height = byte(position + 3) * 256 + byte(position + 4), width = byte(position + 5) * 256 + byte(position + 6), components = byte(position + 7);
      if (!height || !width || height > 10000 || width > 10000 || ![1, 3, 4].includes(components) || length !== 8 + 3 * components) return false;
      hasFrame = true;
    }
    if (marker === 0xda) return hasFrame && length >= 6 && position + length < bytes.length - 2;
    position += length;
  }
  return false;
}

export const visualEvidenceSchema = z.object({
  category: z.enum(['overlap', 'overflow', 'unreadable', 'broken_image', 'interaction', 'other']),
  device: z.enum(['desktop', 'mobile']),
  pageUrl: safeText(2048).refine(isPublicVisualUrl, 'Citez une page publique HTTP ou HTTPS sans identifiants.'),
  element: safeText(300).min(1, 'Indiquez l’élément concerné.'),
  viewport: z.object({ width: z.number().int().min(240).max(10000), height: z.number().int().min(240).max(10000) }).strict().optional(),
  screenshot: z.string().max(screenshotPrefix.length + Math.ceil(MAX_VISUAL_SCREENSHOT_BYTES / 3) * 4).refine(isValidVisualScreenshot, 'La capture doit être un fichier JPEG valide de 100 Ko maximum.').optional(),
  assetId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

const calendarDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const realDate = (value: string) => calendarDate(value) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && calendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
export const visualObservationInputSchema = visualEvidenceSchema.extend({
  observation: safeText(3000).min(1, 'Décrivez ce que vous avez vu ou testé.'),
  observedOn: safeText(40).refine(realDate, 'Indiquez la date réelle de l’observation.'),
}).strict();
export type VisualObservationInput = VisualEvidence & { observation: string; observedOn: string };

export function parseVisualObservation(input: unknown, now = new Date()): VisualObservationInput {
  const parsed = visualObservationInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Observation visuelle invalide.');
  const date = parsed.data.observedOn;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (date.length === 10 ? date > today : Date.parse(date) > now.getTime()) throw new Error('L’observation doit avoir une date réelle, aujourd’hui ou dans le passé.');
  return { ...parsed.data, pageUrl: new URL(parsed.data.pageUrl).href };
}

/** The screenshot is evidence for the same observation, not a reason to duplicate it on retry. */
export function visualObservationFingerprint(input: VisualObservationInput): string {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
  return JSON.stringify([new URL(input.pageUrl).href, input.observedOn, input.category, input.device, normalize(input.element), normalize(input.observation), input.viewport || null]);
}

export function visualObservationScope(input: VisualObservationInput): string {
  return `Observation visuelle humaine de ${input.element}, sur ${input.device === 'mobile' ? 'mobile' : 'ordinateur'}${input.viewport ? ` (${input.viewport.width} × ${input.viewport.height} px)` : ''}. Page consultée : ${input.pageUrl}. Constat limité à cette consultation ; aucune perte de clients ou conséquence commerciale mesurée. ${input.screenshot ? 'Capture jointe.' : 'Capture non jointe.'}`;
}
