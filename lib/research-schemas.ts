import { z } from 'zod';
import { visualEvidenceSchema } from './visual-evidence';

const text = (max = 5000) => z.string().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'Le texte contient des caractères de contrôle.');
const id = text(180).min(1);
const ids = z.array(id).max(3000).refine(values => new Set(values).size === values.length, 'Les identifiants doivent être uniques.');
export const researchUrlSchema = text(2048).refine(value => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !!parsed.hostname && !parsed.username && !parsed.password && !/[\s\\]/.test(value);
  } catch { return false; }
}, 'Utilisez une URL publique HTTP ou HTTPS sans identifiants.');
const nonemptyUrl = researchUrlSchema.refine(Boolean, 'La source doit avoir une URL.');
const calendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
export const researchDateSchema = text(40).refine(value => !value || calendarDate(value) || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && calendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value))), 'Date de collecte invalide.');
const factSectionSchema = z.enum(['identity', 'fit', 'presence', 'presentation', 'contact', 'site', 'visibility', 'opportunities']);
export const researchSourceSchema = z.object({
  id, provider: z.enum(['registry', 'ademe', 'osm', 'google', 'maps', 'openrouter', 'website', 'pagespeed', 'manual', 'browserless']),
  url: nonemptyUrl, title: text(500), excerpt: text(12000), collectedAt: researchDateSchema,
  query: text(1000).optional(), externalId: text(500).optional(),
}).strict();
export const researchFactSchema = z.object({
  id, section: factSectionSchema, kind: z.enum(['observed', 'reported', 'hypothesis']),
  sentiment: z.enum(['positive', 'neutral', 'issue']), text: text(12000).min(1), sourceIds: ids,
  observedOn: researchDateSchema, origin:z.enum(['collection','qualification','manual_observation','exchange']).optional(),scope: text(3000), corrected: z.boolean().optional(),
  refutesFactId: id.optional(), visual: visualEvidenceSchema.optional(),
  review: z.object({state:z.enum(['proposed','confirmed','rejected']),nature:z.enum(['measurement','observation','appraisal']),provenance:z.enum(['render','vision','manual']),reviewedAt:researchDateSchema.optional(),note:text(3000).optional()}).strict().optional(),
}).strict().superRefine((fact, context) => {
  if (fact.visual && (fact.section !== 'site' || fact.kind === 'reported' || !fact.observedOn)) context.addIssue({ code: 'custom', path: ['visual'], message: 'Une observation visuelle doit être un constat daté de l’analyse du site.' });
});
export const researchContactSchema = z.object({
  kind: z.enum(['email', 'phone', 'formUrl', 'profileUrl']), value: text(2048).min(1), sourceUrl: nonemptyUrl, sourceId: id.optional(),
}).strict().superRefine((contact, context) => {
  const valid = contact.kind === 'email' ? z.email().safeParse(contact.value).success
    : contact.kind === 'phone' ? /^\+?[\d(][\d\s()./-]*$/.test(contact.value) && contact.value.replace(/\D/g, '').length >= 7 && contact.value.replace(/\D/g, '').length <= 15
      : nonemptyUrl.safeParse(contact.value).success;
  if (!valid) context.addIssue({ code: 'custom', path: ['value'], message: 'Coordonnée invalide.' });
});
export const aiPanelSchema = z.object({
  id, targetKey: text(2000).min(1), createdAt: researchDateSchema,
  responses: z.array(z.object({
    question: text(3000), answer: text(40000), model: text(180), engine: text(180), recordedAt: researchDateSchema,
    sources: z.array(researchSourceSchema).max(100), valid: z.boolean(),
    recommendations: z.array(z.object({ name: text(180), city: text(180), url: researchUrlSchema }).strict()).max(100), error: text().optional(),
  }).strict()).max(30),
}).strict();
export const providerProfileSchema = z.object({
  name: text(180), activity: text(300), skills: text(5000), services: text(5000), website: researchUrlSchema,
  references: text(10000), terms: text(5000), prices: text(3000), signature: text(2000), revision: z.number().int().nonnegative(),
}).strict();
export const approachPlanSchema = z.object({
  version: z.literal(1), method: z.literal('conversation-v1'), id, reportId: id, evidenceIds: ids,
  motive: text(12000).min(1), rationale: text(5000), hypothesis: text(5000), help: text(5000),
  question: text(1500).min(1), nextStep: text(3000), offer: text(5000), createdAt: researchDateSchema,
  alternatives: z.array(z.object({ motive: text(12000), evidenceIds: ids, rationale: text(5000) }).strict()).max(2).optional(),
  revalidateReason: text(5000).optional(),
}).strict();
export const contactDraftSchema = z.object({
  id, version: z.number().int().positive(), channel: z.enum(['email', 'call', 'reply', 'followup']), planId: id, reportId: id,
  profileRevision: z.number().int().nonnegative(), subject: text(500), text: text(30000),
  blocks: z.array(z.object({ label: text(180), text: text(12000) }).strict()).max(40), createdAt: researchDateSchema,
  origin: z.enum(['template', 'openrouter', 'manual']), usedAt: researchDateSchema.optional(),
}).strict();
export const contactReadinessSchema = z.object({
  target: z.boolean(), reason: z.boolean(), channel: z.boolean(), evidenceIds: ids, channelKind: z.enum(['email', 'phone']),
  confirmedAt: researchDateSchema.refine(Boolean), targetRevision: z.number().int().positive(), reportId: id,
}).strict();
export const contactEventSchema = z.object({
  id, submittedKey: id, date: text(10).refine(calendarDate), channel: z.enum(['email', 'phone']),
  outcome: z.enum(['no_response', 'conversation', 'callback', 'not_interested', 'opposition']), note: text(10000), draftId: id.optional(),
  nextAction: z.object({ text: text(2000).min(1), date: text(10).refine(calendarDate) }).strict().nullable(),
}).strict();
export const researchCorrectionSchema = z.object({
  id, companyId: id, factId: id, fingerprint: text(50000).min(1), note: text(12000).min(1), correctedAt: researchDateSchema.refine(Boolean),
  mode: z.enum(['fact', 'hypothesis']).optional(),
}).strict();
const sectionKeys = ['identity', 'fit', 'presence', 'presentation', 'contact', 'site', 'visibility', 'opportunities', 'method'] as const;
export const prospectReportSchema = z.object({
  version: z.literal(1), id, generatedAt: researchDateSchema, companyName: text(180).min(1), summary: text(12000),
  sources: z.array(researchSourceSchema).max(1500), facts: z.array(researchFactSchema).max(3000),
  contacts: z.array(researchContactSchema).max(500), profiles: z.array(nonemptyUrl).max(100),
  sections: z.array(z.object({ key: z.enum(sectionKeys), title: text(180), status: z.enum(['documented', 'partial', 'unverified', 'not_applicable']), factIds: ids, notes: z.array(text(12000)).max(3000) }).strict()).length(9),
  warnings: z.array(text(12000)).max(500), coverage: z.array(text(12000)).max(500),
  opportunities: z.array(approachPlanSchema).max(3000), panel: aiPanelSchema.optional(), narrative: text(50000).optional(),
}).strict().superRefine((report, context) => {
  const sources = new Set(report.sources.map(source => source.id)), facts = new Set(report.facts.map(fact => fact.id));
  if (sources.size !== report.sources.length) context.addIssue({ code: 'custom', path: ['sources'], message: 'Sources dupliquées.' });
  if (facts.size !== report.facts.length) context.addIssue({ code: 'custom', path: ['facts'], message: 'Constats dupliqués.' });
  if (new Set(report.sections.map(section => section.key)).size !== 9) context.addIssue({ code: 'custom', path: ['sections'], message: 'Les neuf sections du dossier sont nécessaires.' });
  report.facts.forEach((fact, index) => {
    if (fact.kind !== 'hypothesis' && !fact.sourceIds.length) context.addIssue({ code: 'custom', path: ['facts', index, 'sourceIds'], message: 'Un constat doit avoir une source.' });
    if (fact.sourceIds.some(sourceId => !sources.has(sourceId))) context.addIssue({ code: 'custom', path: ['facts', index, 'sourceIds'], message: 'Source inconnue.' });
  });
  report.sections.forEach((section, index) => {
    if (section.factIds.some(factId => !facts.has(factId))) context.addIssue({ code: 'custom', path: ['sections', index, 'factIds'], message: 'Constat inconnu.' });
  });
  report.contacts.forEach((contact, index) => {
    if (contact.sourceId && !sources.has(contact.sourceId)) context.addIssue({ code: 'custom', path: ['contacts', index, 'sourceId'], message: 'Source de contact inconnue.' });
  });
  report.opportunities.forEach((plan, index) => {
    if (plan.reportId !== report.id || plan.evidenceIds.some(factId => !facts.has(factId))) context.addIssue({ code: 'custom', path: ['opportunities', index], message: 'Piste sans preuve dans ce dossier.' });
  });
});
export const researchDataSchema = z.object({
  sources: z.array(researchSourceSchema).max(1500), facts: z.array(researchFactSchema).max(3000),
  contacts: z.array(researchContactSchema).max(500), profiles: z.array(nonemptyUrl).max(100), warnings: z.array(text(12000)).max(500),
  panel: aiPanelSchema.optional(), report: prospectReportSchema.optional(), narrative: text(50000).optional(),
  collectionStatus: text(500).optional(), identityKeys: z.array(text(1000)).max(200).optional(),
}).strict().superRefine((data, context) => {
  const sources = new Set(data.sources.map(source => source.id));
  if (sources.size !== data.sources.length || new Set(data.facts.map(fact => fact.id)).size !== data.facts.length) context.addIssue({ code: 'custom', message: 'Identifiants de collecte dupliqués.' });
  data.facts.forEach((fact, index) => {
    if ((fact.kind !== 'hypothesis' && !fact.sourceIds.length) || fact.sourceIds.some(sourceId => !sources.has(sourceId))) context.addIssue({ code: 'custom', path: ['facts', index, 'sourceIds'], message: 'Le constat doit citer une source collectée.' });
  });
});
