import { z } from 'zod';
import { normalizedDomain, parisToday } from './domain';
import { normalizePublicSiteUrl, validatePublicSiteUrl, type SiteAnalysis } from './site-analysis';

if (typeof window !== 'undefined') throw new Error('L’audit mobile est réservé au serveur.');

const API_URL = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed';
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 40_000;
const auditSchema = z.object({
  score: z.number().finite().min(0).max(1).nullish(),
  scoreDisplayMode: z.string().max(40).optional(),
  numericValue: z.number().finite().nonnegative().optional(),
  numericUnit: z.string().max(40).optional(),
  displayValue: z.string().max(500).optional(),
});
const categorySchema = z.object({ score: z.number().finite().min(0).max(1).nullish() });
const lighthouseSchema = z.object({
  requestedUrl: z.string().max(2048).optional(),
  finalUrl: z.string().max(2048).optional(),
  fetchTime: z.string().max(80).optional(),
  lighthouseVersion: z.string().max(80).optional(),
  configSettings: z.object({ formFactor: z.string().max(20).optional() }).optional(),
  runtimeError: z.object({ code: z.string().max(80).optional() }).optional(),
  categories: z.object({ performance: categorySchema.optional(), accessibility: categorySchema.optional(), seo: categorySchema.optional() }).optional(),
  audits: z.object({
    'largest-contentful-paint': auditSchema.optional(),
    viewport: auditSchema.optional(),
    'meta-viewport': auditSchema.optional(),
    'http-status-code': auditSchema.optional(),
    'is-crawlable': auditSchema.optional(),
  }).optional(),
});
const responseSchema = z.object({ lighthouseResult: lighthouseSchema });
class MobileAuditError extends Error {}

function deadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new MobileAuditError('L’audit mobile dépasse le délai maximal de 40 secondes. Réessayez.'));
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new MobileAuditError('L’audit mobile dépasse le délai maximal de 40 secondes. Réessayez.'));
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

async function bodyJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new MobileAuditError('PageSpeed Insights a renvoyé une réponse invalide. Réessayez plus tard.');
  }
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) {
    throw new MobileAuditError('Le rapport PageSpeed Insights dépasse la taille maximale de 3 Mo.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MobileAuditError('PageSpeed Insights a renvoyé une réponse vide.');
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await deadline(reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await deadline(reader.cancel(), signal);
        throw new MobileAuditError('Le rapport PageSpeed Insights dépasse la taille maximale de 3 Mo.');
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
  text += decoder.decode();
  try { return JSON.parse(text) as unknown; }
  catch { throw new MobileAuditError('PageSpeed Insights a renvoyé une réponse invalide.'); }
}

function failing(audit: z.infer<typeof auditSchema> | undefined): boolean {
  return audit?.score === 0 && !['error', 'notApplicable', 'manual', 'informative'].includes(audit.scoreDisplayMode || '');
}

function auditResult(website: URL, data: z.infer<typeof lighthouseSchema>): SiteAnalysis {
  if (data.configSettings?.formFactor && data.configSettings.formFactor !== 'mobile') {
    throw new MobileAuditError('PageSpeed Insights n’a pas renvoyé un test mobile. Relancez l’audit.');
  }
  let finalUrl: URL;
  try { finalUrl = normalizePublicSiteUrl(data.finalUrl || website.href); }
  catch { throw new MobileAuditError('La destination signalée par PageSpeed Insights n’est pas une URL publique valide.'); }
  if (normalizedDomain(finalUrl.href) !== normalizedDomain(website.href)) {
    throw new MobileAuditError('Le site redirige vers un autre domaine. Vérifiez son adresse puis relancez l’audit sur la destination.');
  }
  if (data.requestedUrl) {
    let requested: URL;
    try { requested = normalizePublicSiteUrl(data.requestedUrl); }
    catch { throw new MobileAuditError('PageSpeed Insights a renvoyé une adresse de test invalide.'); }
    if (requested.href !== website.href) throw new MobileAuditError('Le rapport PageSpeed Insights ne correspond pas à la page demandée. Relancez l’audit.');
  }
  if (data.runtimeError?.code && data.runtimeError.code !== 'NO_ERROR') {
    throw new MobileAuditError('PageSpeed Insights n’a pas pu terminer la mesure de cette page. Vérifiez-la manuellement puis réessayez.');
  }
  const source = new URL('https://pagespeed.web.dev/analysis');
  source.searchParams.set('url', website.href);
  source.searchParams.set('form_factor', 'mobile');
  const sourceUrl = source.href;
  const warnings = [
    'Test de laboratoire ponctuel avec simulation mobile : les mesures peuvent varier et ne représentent pas les visites réelles de tous les utilisateurs.',
    'Les résultats n’établissent ni besoin commercial, ni budget, ni accord de contact. Vérifiez les anomalies avant toute proposition.',
    'Le lien PageSpeed permet de consulter ou de relancer un test ; les valeurs ci-dessous conservent celles de ce relevé.',
  ];
  const findings: SiteAnalysis['findings'] = [];
  const add = (id: string, key: 'mobile' | 'technical', note: string, approach?: string) => {
    findings.push({ id: `pagespeed-${id}`, key, note, sourceUrl, ...(approach ? { approach } : {}) });
  };
  const scores = [
    ['Performance', data.categories?.performance?.score],
    ['Accessibilité', data.categories?.accessibility?.score],
    ['SEO', data.categories?.seo?.score],
  ] as const;
  const metrics = scores.filter(([, score]) => typeof score === 'number')
    .map(([label, score]) => `${label} : ${Math.round(score! * 100)}/100`);
  const lcpAudit = data.audits?.['largest-contentful-paint'];
  const lcp = lcpAudit?.scoreDisplayMode !== 'error' && (!lcpAudit?.numericUnit || lcpAudit.numericUnit === 'millisecond')
    ? lcpAudit?.numericValue : undefined;
  if (typeof lcp === 'number') metrics.push(`LCP simulé (affichage du plus grand contenu) : ${Math.round(lcp)} ms`);
  if (metrics.length) {
    const testedAt = data.fetchTime && Number.isFinite(Date.parse(data.fetchTime)) ? ` Mesure PageSpeed datée du ${new Date(data.fetchTime).toISOString()}.` : '';
    const version = data.lighthouseVersion && /^[\d.]+$/.test(data.lighthouseVersion) ? ` Lighthouse ${data.lighthouseVersion}.` : '';
    add('metrics', 'technical', `PageSpeed Insights, simulation mobile. ${metrics.join(' ; ')}.${testedAt}${version}`);
  }
  if (typeof lcp === 'number' && lcp > 4000) {
    add('lcp', 'mobile', `Le LCP simulé atteint ${Math.round(lcp)} ms lors de ce test mobile, au-delà du repère de 4 000 ms. Cette mesure décrit ce chargement de laboratoire.`,
      'Si la lenteur se reproduit sur des téléphones et des connexions représentatifs, proposer un diagnostic du chargement avant de définir les corrections.');
  }
  // These two audits test different facts: viewport configuration and permission to zoom.
  if (failing(data.audits?.viewport)) {
    add('viewport', 'mobile', 'L’audit Lighthouse « viewport » échoue (score 0) : la balise viewport ne satisfait pas le contrôle de largeur ou d’échelle initiale de Lighthouse. Le rendu visuel sur téléphone reste à examiner.',
      'Si le défaut se confirme sur téléphone, proposer de corriger la configuration viewport puis de contrôler les pages concernées.');
  }
  if (failing(data.audits?.['meta-viewport'])) {
    add('meta-viewport', 'mobile', 'L’audit Lighthouse « meta-viewport » échoue (score 0) : la configuration viewport interdit le zoom ou limite son échelle maximale sous 5. Ce contrôle concerne l’accessibilité du zoom.',
      'Si cette restriction est confirmée, proposer de rétablir le zoom et de vérifier l’accessibilité sur téléphone.');
  }
  const statusAudit = data.audits?.['http-status-code'];
  if (failing(statusAudit)) {
    const status = /^[45]\d{2}$/.test(statusAudit?.displayValue || '') ? ` HTTP ${statusAudit!.displayValue}` : '';
    add('http-status-code', 'technical', `Lighthouse signale une réponse${status || ' HTTP non réussie'} sur la page testée (audit « http-status-code », score 0).`,
      'Si cette réponse d’erreur se reproduit pour les visiteurs, proposer de vérifier l’URL, les redirections et la réponse du serveur.');
  }
  if (failing(data.audits?.['is-crawlable'])) {
    add('is-crawlable', 'technical', 'Lighthouse signale un blocage d’indexation ou d’exploration sur cette page (audit « is-crawlable », score 0). Le caractère volontaire de cette directive reste à confirmer.',
      'Si cette page doit être publique et indexable, vérifier les directives robots et les paramètres d’indexation avec l’entreprise.');
  }
  if (!metrics.length) warnings.push('Les scores et le LCP ne sont pas disponibles dans ce rapport ; aucun résultat de vitesse n’est déduit.');
  if (!findings.length) warnings.push('Aucune mesure exploitable ni anomalie des contrôles sélectionnés n’a été retournée. Cela ne prouve pas l’absence de problème.');
  if (!data.configSettings?.formFactor) warnings.push('La requête demande un test mobile, mais les paramètres d’émulation ne sont pas précisés dans la réponse.');
  if (finalUrl.href !== website.href) warnings.push(`PageSpeed a testé la destination après redirection : ${finalUrl.href}`);
  return { website: website.href, analyzedOn: parisToday(), pages: [{ url: finalUrl.href, title: 'Page testée · PageSpeed mobile' }], contacts: [], findings, warnings };
}

/** Official API reference: https://developers.google.com/speed/docs/insights/rest/v5/pagespeedapi/runpagespeed. */
export async function auditMobile(website: string): Promise<SiteAnalysis> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let target: URL;
    try { target = await deadline(validatePublicSiteUrl(website, controller.signal), controller.signal); }
    catch {
      if (controller.signal.aborted) throw new MobileAuditError('L’audit mobile dépasse le délai maximal de 40 secondes. Réessayez.');
      throw new MobileAuditError('Utilisez l’adresse HTTP ou HTTPS d’un site public, sans identifiants ni adresse privée, locale ou réservée.');
    }
    const url = new URL(API_URL);
    url.searchParams.set('url', target.href);
    url.searchParams.set('strategy', 'mobile');
    url.searchParams.set('locale', 'fr');
    for (const category of ['performance', 'accessibility', 'seo']) url.searchParams.append('category', category);
    // Omit screenshots, page HTML and network logs from the response, as well as from persisted notes.
    url.searchParams.set('fields', 'lighthouseResult(requestedUrl,finalUrl,fetchTime,lighthouseVersion,configSettings(formFactor),runtimeError(code),categories(performance(score),accessibility(score),seo(score)),audits(largest-contentful-paint(score,scoreDisplayMode,numericValue,numericUnit),viewport(score,scoreDisplayMode),meta-viewport(score,scoreDisplayMode),http-status-code(score,scoreDisplayMode,displayValue),is-crawlable(score,scoreDisplayMode)))');
    const key = process.env.PAGESPEED_API_KEY?.trim();
    if (key) url.searchParams.set('key', key);
    const response = await deadline(fetch(url, { cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } }), controller.signal);
    if (response.status === 429) throw new MobileAuditError('Le quota PageSpeed Insights est atteint. Réessayez plus tard ; une clé API Google personnelle peut être configurée côté serveur pour disposer de son propre quota.');
    if ([401, 403].includes(response.status)) throw new MobileAuditError('PageSpeed Insights refuse l’accès. Vérifiez la clé API Google et l’activation du service côté serveur, ou réessayez sans clé.');
    if (!response.ok) throw new MobileAuditError('PageSpeed Insights est indisponible ou ne peut pas analyser cette adresse. Réessayez plus tard.');
    const result = responseSchema.safeParse(await bodyJson(response, controller.signal));
    if (!result.success) throw new MobileAuditError('PageSpeed Insights a renvoyé un rapport invalide.');
    return auditResult(target, result.data.lighthouseResult);
  } catch (error) {
    if (controller.signal.aborted) throw new MobileAuditError('L’audit mobile dépasse le délai maximal de 40 secondes. Réessayez.');
    if (error instanceof MobileAuditError) throw error;
    // Never expose a transport exception: its URL could contain the server API key.
    throw new MobileAuditError('PageSpeed Insights est injoignable pour le moment. Réessayez plus tard.');
  } finally { clearTimeout(timeout); }
}
