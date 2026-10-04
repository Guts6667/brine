import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SiteAnalysis } from './site-analysis';

const localKey = randomBytes(32).toString('hex');
const MAX_AGE = 20 * 60 * 1000;
interface Preview { companyId: string; updatedAt: string; analysis: SiteAnalysis; issuedAt: number }
function signature(payload: string) {
  return createHmac('sha256', process.env.BRINE_SESSION_SECRET || localKey)
    .update(`brine-site-preview-v1:${payload}`).digest();
}
export function sealAnalysisPreview(companyId: string, updatedAt: string, analysis: SiteAnalysis): string {
  const payload = Buffer.from(JSON.stringify({ companyId, updatedAt, analysis, issuedAt: Date.now() })).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}
export function readAnalysisPreview(token: string, companyId: string): Preview {
  const invalid = () => new Error('Cette analyse a expiré ou a changé. Relancez l’analyse du site.');
  if (token.length > 128 * 1024) throw invalid();
  const parts = token.split('.');
  if (parts.length !== 2) throw invalid();
  const actual = Buffer.from(parts[1], 'base64url'), expected = signature(parts[0]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
  let preview: Preview;
  try { preview = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch { throw invalid(); }
  if (preview.companyId !== companyId || typeof preview.issuedAt !== 'number' ||
    preview.issuedAt > Date.now() || Date.now() - preview.issuedAt > MAX_AGE) throw invalid();
  return preview;
}
