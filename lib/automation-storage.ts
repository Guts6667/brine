import { z } from 'zod';
import { companyDetailsSchema, companyInputSchema, isValidDate, normalizedDomain, parisToday } from './domain';
import type { Store } from './db';
import type { AsyncCloudStore } from './cloud-db';
import type { CompanyCandidate } from './company-search';
import type { SiteAnalysis } from './site-analysis';
import type { Company, CompanyDetails } from './types';

type AutomationStore = Store | AsyncCloudStore;
export interface SiteSuggestionSelection { contactIndexes: number[]; findingIds: string[] }

const importType = 'Import Annuaire des entreprises';
const importHeader = 'Entreprise issue de l’Annuaire des entreprises.';
const analysisType = 'Analyse automatique du site';
const maximumNoteLength = 10_000;
const queues = new WeakMap<AutomationStore, Promise<void>>();

// Serialize retries and double clicks using the same store. Each database method
// remains responsible for its own transaction; these helpers do not restore data.
async function serialize<T>(store: AutomationStore, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(store) || Promise.resolve();
  const operation = previous.then(work);
  const tail = operation.then(() => undefined, () => undefined);
  queues.set(store, tail);
  try { return await operation; }
  finally { if (queues.get(store) === tail) queues.delete(store); }
}

const boundedText = (maximum: number) => z.string().trim().max(maximum);
const publicUrl = (maximum: number) => boundedText(maximum).min(1).refine((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password && !/\s/.test(value);
  } catch { return false; }
}, 'Utilisez une URL http:// ou https:// valide.');
const httpUrl = publicUrl(2000);
const siteContentSchema = z.array(z.object({url:publicUrl(2048),title:boundedText(160),excerpt:boundedText(1200).min(1),collectedAt:z.iso.datetime().max(40)}).strict()).max(24).refine(blocks=>blocks.every(block=>blocks.filter(other=>other.url===block.url).length<=8),'La collecte est limitée à huit extraits par page.');
const candidateSchema = z.object({
  siren: z.string().regex(/^\d{9}$/, 'SIREN invalide.'),
  siret: z.string().regex(/^(?:\d{14})?$/, 'SIRET invalide.'),
  name: boundedText(180).min(1), city: boundedText(180), business: boundedText(300),
  activityCode: boundedText(20), address: boundedText(1000), sourceUrl: httpUrl,
}).strict().refine(({ siren, siret }) => !siret || siret.startsWith(siren), 'Le SIRET doit correspondre au SIREN.');

const contactSuggestionSchema = z.object({
  kind: z.enum(['email', 'phone', 'formUrl']), value: boundedText(2000).min(1), sourceUrl: httpUrl,
}).strict().superRefine(({ kind, value }, context) => {
  const contact = { name: '', role: '', email: '', phone: '', formUrl: '', profileUrl: '', [kind]: value };
  const parsed = companyDetailsSchema.safeParse({ name: 'Validation', website: '', contact });
  if (!parsed.success) context.addIssue({ code: 'custom', path: ['value'], message: 'Le moyen de contact proposé est invalide.' });
});
const findingSchema = z.object({
  id: boundedText(120).min(1).refine(value => !/[\u0000-\u001f]/.test(value), 'Identifiant de constat invalide.'),
  key: z.enum(['mobile', 'mainAction', 'contact', 'services', 'technical', 'siteAge']),
  note: boundedText(12000).min(1), sourceUrl: httpUrl,
  approach: boundedText(2000).optional(),
}).strict();
const analysisSchema = z.object({
  website: httpUrl,
  analyzedOn: z.string().refine(value => isValidDate(value) && value <= parisToday(), 'La date d’analyse doit être réelle et ne peut pas être future.'),
  pages: z.array(z.object({ url: httpUrl, title: boundedText(500) }).strict()).max(30),
  contacts: z.array(contactSuggestionSchema).max(100),
  findings: z.array(findingSchema).max(30),
  warnings: z.array(boundedText(2000)).max(30),
  content: siteContentSchema.optional(),
}).strict().superRefine((analysis, context) => {
  const domain = normalizedDomain(analysis.website);
  for (const source of [...analysis.pages.map(page => page.url), ...analysis.contacts.map(contact => contact.sourceUrl), ...(analysis.content||[]).map(block=>block.url)]) {
    if (normalizedDomain(source) !== domain) {
      context.addIssue({ code: 'custom', message: 'Une source de l’analyse ne correspond pas au site analysé.' });
      break;
    }
  }
  for (const finding of analysis.findings) {
    if (normalizedDomain(finding.sourceUrl) === domain) continue;
    const report = new URL(finding.sourceUrl);
    if (report.origin !== 'https://pagespeed.web.dev' || report.pathname !== '/analysis' || normalizedDomain(report.searchParams.get('url') || '') !== domain) {
      context.addIssue({ code: 'custom', message: 'Le rapport externe ne correspond pas au site analysé.' });
      break;
    }
  }
  if (new Set(analysis.findings.map(finding => finding.id)).size !== analysis.findings.length) {
    context.addIssue({ code: 'custom', path: ['findings'], message: 'Les identifiants de constat doivent être uniques.' });
  }
});
const selectionSchema = z.object({
  contactIndexes: z.array(z.number().int().nonnegative()).max(100),
  findingIds: z.array(boundedText(120).min(1)).max(30),
}).strict().superRefine((selection, context) => {
  if (new Set(selection.contactIndexes).size !== selection.contactIndexes.length || new Set(selection.findingIds).size !== selection.findingIds.length) {
    context.addIssue({ code: 'custom', message: 'Sélectionnez chaque suggestion une seule fois.' });
  }
});

/** Import one explicitly selected result; never infer qualification or contact. */
export async function importCompanyCandidate(store: AutomationStore, candidate: CompanyCandidate): Promise<{ id: string; name: string; duplicate: boolean }> {
  const parsed = candidateSchema.parse(candidate);
  const input = companyInputSchema.parse({ name: parsed.name, website: '', city: parsed.city, business: parsed.business });
  return serialize(store, async () => {
    const duplicates = await store.findDuplicates(input);
    // An imported company may since have been renamed or moved. Its source
    // identifiers are retained in the dated history rather than a new schema.
    for (const company of await store.listCompanies()) {
      const activities = await store.listActivities(company.id);
      const imported = activities.some(activity => {
        if (activity.kind !== 'note' || activity.type !== importType) return false;
        const [header, siren, siret] = activity.text.split('\n', 3);
        return header === importHeader && (siren === `SIREN : ${parsed.siren}` || Boolean(parsed.siret && siret === `SIRET : ${parsed.siret}`));
      });
      if (imported) return { id: company.id, name: company.name, duplicate: true };
    }
    if (duplicates.length) return { ...duplicates[0], duplicate: true };
    const company = await store.createCompany(input, {
      kind: 'note', type: importType, date: parisToday(),
      text: [importHeader, `SIREN : ${parsed.siren}`, `SIRET : ${parsed.siret || 'Non renseigné'}`,
        `Activité déclarée : ${parsed.activityCode || 'Non renseignée'}`,
        `Adresse déclarée : ${parsed.address || 'Non renseignée'}`,
        `Source : ${parsed.sourceUrl}`, `Consultation : ${parisToday()}`,
        'Les informations et la qualification restent à vérifier.',
      ].join('\n'),
    });
    return { id: company.id, name: company.name, duplicate: false };
  });
}

function companyDetails(company: Company): CompanyDetails {
  return {
    name: company.name, website: company.website, city: company.city, business: company.business,
    targetFit: company.targetFit, problemFound: company.problemFound, contactAvailable: company.contactAvailable,
    observation: company.observation, proofUrl: company.proofUrl, observedOn: company.observedOn,
    trigger: company.trigger, stage: company.stage, contact: { ...company.contact },
  };
}

const findingLabels = {
  mobile: 'Mobile', mainAction: 'Action principale', contact: 'Contact', services: 'Prestations',
  technical: 'Vérification technique', siteAge: 'Ancienneté du site',
} as const;

/** Save selected suggestions as evidence, without replacing manual assessments. */
export async function applySiteSuggestions(
  store: AutomationStore, id: string, analysis: SiteAnalysis,
  selection: SiteSuggestionSelection, expectedUpdatedAt: string,
): Promise<{ contactCount: number; findingCount: number }> {
  z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).parse(id);
  z.iso.datetime({ offset: true }).parse(expectedUpdatedAt);
  const parsed = analysisSchema.parse(analysis);
  const selected = selectionSchema.parse(selection);
  if (selected.contactIndexes.some(index => index >= parsed.contacts.length) || selected.findingIds.some(findingId => !parsed.findings.some(finding => finding.id === findingId))) {
    throw new Error('La sélection contient une suggestion introuvable. Relancez l’analyse.');
  }
  return serialize(store, async () => {
    const requireCurrent = async () => {
      const company = await store.getCompany(id);
      if (!company) throw new Error('Entreprise introuvable.');
      if (company.updatedAt !== expectedUpdatedAt) throw new Error('La fiche a changé depuis l’analyse. Actualisez-la et relancez l’analyse.');
      if (!company.website || normalizedDomain(company.website) !== normalizedDomain(parsed.website)) throw new Error('Le site analysé ne correspond pas au site de la fiche. Relancez l’analyse.');
      return company;
    };
    const before = await requireCurrent();
    const details = companyDetails(before);
    const contactBlocks: string[] = [];
    for (const index of selected.contactIndexes) {
      const contact = parsed.contacts[index];
      // When multiple suggestions target one channel, the first explicitly
      // selected value wins; existing channels are always kept verbatim.
      if (details.contact[contact.kind].trim()) continue;
      details.contact[contact.kind] = contact.value;
      contactBlocks.push(`Contact ajouté — ${contact.kind} : ${contact.value}\nSource : ${contact.sourceUrl}\nConsultation : ${parsed.analyzedOn}`);
    }
    companyDetailsSchema.parse(details);
    const activities = await store.listActivities(id);
    const findingBlocks = selected.findingIds.map(findingId => parsed.findings.find(finding => finding.id === findingId)!).map(finding =>
      `Constat à vérifier — ${findingLabels[finding.key]}\n${finding.note}\nSource : ${finding.sourceUrl}\nConsultation : ${parsed.analyzedOn}${finding.approach ? `\nPiste de premier contact à valider : ${finding.approach}` : ''}`,
    ).filter(block => !activities.some(activity => activity.kind === 'note' && activity.type === analysisType && activity.text.includes(block)));
    const count = { contactCount: contactBlocks.length, findingCount: findingBlocks.length };
    if (!count.contactCount && !count.findingCount) return count;
    const note = [
      `Suggestions du site ${parsed.website}`, ...contactBlocks, ...findingBlocks,
      'Ces suggestions ne valident aucun critère de qualification.',
    ].join('\n\n');
    if (note.length > maximumNoteLength) throw new Error('La sélection dépasse 10 000 caractères. Enregistrez moins de suggestions à la fois.');
    // Check again after building evidence, then compare the version inside the
    // write transaction that saves contacts and provenance together.
    await requireCurrent();
    await store.saveResearch(id, details, { kind: 'note', type: analysisType, date: parsed.analyzedOn, text: note }, expectedUpdatedAt);
    return count;
  });
}
