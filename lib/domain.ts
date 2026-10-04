import { campaignBackupSchema, checkCampaignRelations } from './campaign-backup';
import { z } from 'zod';
import { stages, type AiTest, type Company, type Contact } from './types';
import { emptyQualification, qualificationDataSchema } from './qualification';

z.config(z.locales.fr());

const text = (maximum = 5000) => z.string().trim().max(maximum, `Maximum ${maximum} caractères.`);
const optionalText = (maximum = 5000) => text(maximum).default('');
const answerSchema = z.enum(['yes', 'no', 'unknown'], { error: 'Choisissez Oui, Non ou À vérifier.' });
const stageSchema = z.enum(stages, { error: 'Choisissez une étape proposée.' });
const nameSchema = text(180).min(1, 'Renseignez le nom de l’entreprise.');

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export const dateSchema = z.string().refine(
  value => value === '' || isValidDate(value),
  'Renseignez une date réelle au format AAAA-MM-JJ.',
);

function safeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

const urlSchema = text(2000).refine(value => value === '' || safeHttpUrl(value),
  'Utilisez un lien complet commençant par https:// ou http://.');

function normalizeWebsite(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  // A typed scheme must be validated as-is; never turn javascript: into a website.
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  if (!safeHttpUrl(candidate) || /\s/.test(candidate)) return trimmed;
  return new URL(candidate).toString();
}

const websiteInputSchema = text(2000).transform(normalizeWebsite).pipe(urlSchema).default('');
const emailSchema = text(320).refine(value => value === '' || z.email().safeParse(value).success,
  'Renseignez une adresse email valide.');
function validPhone(value: string): boolean {
  const phone = value.trim();
  if (!/^(?:\+)?[\d(][\d\s()./-]*$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}
const phoneSchema = text(80).refine(value => value === '' || validPhone(value),
  'Renseignez un téléphone valide (7 à 15 chiffres).');

const contactFields = {
  name: text(180), role: text(180), email: emailSchema, phone: phoneSchema,
  formUrl: urlSchema, profileUrl: urlSchema,
};
const contactSchema = z.object(contactFields).strict();
const contactInputSchema = z.object({
  name: contactFields.name.default(''), role: contactFields.role.default(''),
  email: emailSchema.default(''), phone: phoneSchema.default(''),
  formUrl: urlSchema.default(''), profileUrl: urlSchema.default(''),
});
const emptyContact: Contact = { name: '', role: '', email: '', phone: '', formUrl: '', profileUrl: '' };

export function hasProfessionalContact(contact: Partial<Contact> | null | undefined): boolean {
  if (!contact) return false;
  return Boolean(
    (contact.email?.trim() && emailSchema.safeParse(contact.email).success) ||
    (contact.phone?.trim() && validPhone(contact.phone)) ||
    (contact.formUrl?.trim() && safeHttpUrl(contact.formUrl)) ||
    (contact.profileUrl?.trim() && safeHttpUrl(contact.profileUrl)),
  );
}

export const companyInputSchema = z.object({
  name: nameSchema, website: websiteInputSchema,
  city: optionalText(180), business: optionalText(300),
});

function checkQualification(data: {
  problemFound: string; observation: string; contactAvailable: string; contact: Contact;
}, context: z.RefinementCtx) {
  if (data.problemFound === 'yes' && !data.observation.trim()) {
    context.addIssue({ code: 'custom', path: ['observation'],
      message: 'Décrivez le problème concret pour répondre Oui.' });
  }
  if (data.contactAvailable === 'yes' && !hasProfessionalContact(data.contact)) {
    context.addIssue({ code: 'custom', path: ['contactAvailable'],
      message: 'Ajoutez au moins un moyen de contact professionnel pour répondre Oui.' });
  }
}

export const companyDetailsSchema = companyInputSchema.extend({
  targetFit: answerSchema.default('unknown'), problemFound: answerSchema.default('unknown'),
  contactAvailable: answerSchema.default('unknown'), observation: optionalText(),
  proofUrl: urlSchema.default(''), observedOn: dateSchema.default(''), trigger: optionalText(2000),
  stage: stageSchema.default('À étudier'), contact: contactInputSchema.default(emptyContact),
}).superRefine(checkQualification);

export const nextActionInputSchema = z.object({
  text: text(500).min(1, 'Décrivez la prochaine action.'), date: dateSchema.default(''),
});

export const activityInputSchema = z.object({
  kind: z.enum(['note', 'exchange'], { error: 'Choisissez une note ou un échange.' }).default('note'), type: optionalText(180),
  date: dateSchema.default(''), text: text(20000).min(1, 'Ajoutez le texte de la note ou de l’échange.'),
});

const settingsFields = { targetCity: text(180), targetBusiness: text(300) };
const fullSettingsFields = { ...settingsFields, targetCompanyType: text(300), targetOffer: text(1000), targetExclusions: text(2000) };
export const settingsSchema = z.object({
  ...settingsFields, targetCompanyType: text(300).default(''), targetOffer: text(1000).default(''), targetExclusions: text(2000).default(''),
});

const countSchema = z.number().int('Utilisez un entier.').nonnegative('Utilisez un nombre positif ou nul.').nullable();
const aiFields = {
  panel: text(300), period: text(300), tool: text(180), interface: text(300),
  mode: z.enum(['web', 'api', 'unknown'], { error: 'Choisissez Recherche web, API ou À préciser.' }), model: text(180), questions: text(20000),
  validResponses: countSchema, recommendations: countSchema, citations: countSchema,
  notes: text(20000), proofUrl: urlSchema,
};

function checkAiCounts(data: {
  validResponses: number | null; recommendations: number | null; citations: number | null;
}, context: z.RefinementCtx) {
  if (data.validResponses === null) return;
  for (const field of ['recommendations', 'citations'] as const) {
    if (data[field] !== null && data[field] > data.validResponses) {
      context.addIssue({ code: 'custom', path: [field],
        message: 'Ce nombre ne peut pas dépasser le nombre de réponses valides.' });
    }
  }
}

export const aiTestInputSchema = z.object({
  panel: aiFields.panel.default(''), period: aiFields.period.default(''), tool: aiFields.tool.default(''),
  interface: aiFields.interface.default(''), mode: aiFields.mode.default('unknown'),
  model: aiFields.model.default(''), questions: aiFields.questions.default(''),
  validResponses: countSchema.default(null), recommendations: countSchema.default(null),
  citations: countSchema.default(null), notes: aiFields.notes.default(''), proofUrl: urlSchema.default(''),
}).superRefine(checkAiCounts);

const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Identifiant invalide.');
const timestampSchema = z.iso.datetime({ offset: true });
const nextActionSchema = z.object({
  id: idSchema, text: text(500).min(1), date: dateSchema, createdAt: timestampSchema,
}).strict();
const companyFields = {
  id: idSchema, name: nameSchema, website: urlSchema, city: text(180), business: text(300),
  targetFit: answerSchema, problemFound: answerSchema, contactAvailable: answerSchema,
  observation: text(), proofUrl: urlSchema, observedOn: dateSchema, trigger: text(2000),
  stage: stageSchema, archived: z.boolean(), oppositionActive: z.boolean(),
  oppositionDate: dateSchema, oppositionNote: text(), contact: contactSchema,
  nextAction: nextActionSchema.nullable(), createdAt: timestampSchema, updatedAt: timestampSchema,
};
function checkCompanyIntegrity(company: {
  problemFound: string; observation: string; contactAvailable: string; contact: Contact;
  oppositionActive: boolean; nextAction: unknown; oppositionDate: string;
}, context: z.RefinementCtx) {
  checkQualification(company, context);
  if (company.oppositionActive && company.nextAction) {
    context.addIssue({ code: 'custom', path: ['nextAction'], message: 'Une opposition active doit annuler la prochaine action.' });
  }
  if (company.oppositionActive && !company.oppositionDate) {
    context.addIssue({ code: 'custom', path: ['oppositionDate'], message: 'Une opposition active doit avoir une date.' });
  }
}
const legacyStages = ['À étudier', 'À contacter', 'En échange', 'Proposition envoyée', 'Gagné', 'Perdu'] as const;
const legacyCompanySchema = z.object({ ...companyFields, stage: z.enum(legacyStages) }).strict().superRefine(checkCompanyIntegrity);
const companySchema = z.object({ ...companyFields, qualification: qualificationDataSchema }).strict().superRefine(checkCompanyIntegrity);
const activitySchema = z.object({
  id: idSchema, companyId: idSchema,
  kind: z.enum(['note', 'exchange', 'action_done', 'action_rescheduled', 'system'], { error: 'Type d’activité inconnu.' }),
  type: text(180), date: dateSchema, text: text(20000).min(1), createdAt: timestampSchema,
}).strict();
const aiTestSchema = z.object({
  id: idSchema, companyId: idSchema, ...aiFields, createdAt: timestampSchema,
}).strict().superRefine(checkAiCounts);

const backupFields = {
  exportedAt: timestampSchema, activities: z.array(activitySchema), aiTests: z.array(aiTestSchema),
};
const legacyBackupSchema = z.object({
  ...backupFields, schemaVersion: z.literal(1), companies: z.array(legacyCompanySchema),
  settings: z.object(fullSettingsFields).partial({ targetCompanyType: true, targetOffer: true, targetExclusions: true }).strict(),
}).strict().transform((backup) => ({
  ...backup, schemaVersion: 2 as const, companies: backup.companies.map((company) => ({ ...company, qualification: emptyQualification() })),
  settings: settingsSchema.parse(backup.settings),
}));
const currentBackupSchema = z.object({
  ...backupFields, schemaVersion: z.literal(2), companies: z.array(companySchema), settings: z.object(fullSettingsFields).strict(),
}).strict();
const campaignVersionSchema = currentBackupSchema.extend({schemaVersion:z.literal(3),campaignData:campaignBackupSchema}).strict();
const researchVersionSchema = campaignVersionSchema.extend({schemaVersion:z.literal(4)}).strict();
export const backupSchema = z.discriminatedUnion('schemaVersion', [legacyBackupSchema, currentBackupSchema, campaignVersionSchema, researchVersionSchema], { error: 'Cette sauvegarde doit utiliser le format Brine version 1, 2, 3 ou 4.' }).superRefine((backup, context) => {
  checkCampaignRelations(backup, message => context.addIssue({code:'custom',message}));
  if(backup.schemaVersion===4)backup.campaignData.candidates.forEach((candidate,index)=>{
    if(!/^(?:\d{9})?$/.test(candidate.company.siren)||!/^(?:\d{14})?$/.test(candidate.company.siret)||(candidate.company.siren&&candidate.company.siret&&!candidate.company.siret.startsWith(candidate.company.siren)))context.addIssue({code:'custom',path:['campaignData','candidates',index,'company'],message:'Une identité officielle doit être un vrai SIREN/SIRET cohérent ou rester vide.'});
  });
  const seen = new Set<string>();
  const registerId = (id: string, path: (string | number)[]) => {
    if (seen.has(id)) context.addIssue({ code: 'custom', path, message: 'Identifiant dupliqué dans la sauvegarde.' });
    seen.add(id);
  };
  const companies = new Set(backup.companies.map(company => company.id));
  backup.companies.forEach((company, index) => {
    registerId(company.id, ['companies', index, 'id']);
    if (company.nextAction) registerId(company.nextAction.id, ['companies', index, 'nextAction', 'id']);
  });
  for (const collection of ['activities', 'aiTests'] as const) {
    backup[collection].forEach((item, index) => {
      registerId(item.id, [collection, index, 'id']);
      if (!companies.has(item.companyId)) {
        context.addIssue({ code: 'custom', path: [collection, index, 'companyId'],
          message: 'Cette donnée fait référence à une entreprise absente de la sauvegarde.' });
      }
    });
  }
});

type QualificationInput = Pick<Company,
  'oppositionActive' | 'targetFit' | 'problemFound' | 'contactAvailable' | 'observation' | 'contact'>;
export type QualificationLabel = 'Ne plus contacter' | 'Hors cible' | 'Pas de besoin repéré' |
  'Bonne piste' | 'Contact à trouver' | 'À vérifier';

export function qualify(company: QualificationInput): { label: QualificationLabel; explanation: string } {
  if (company.oppositionActive) return { label: 'Ne plus contacter', explanation: 'Une opposition au contact est active.' };
  if (company.targetFit === 'no') return { label: 'Hors cible', explanation: 'Cette entreprise ne correspond pas à votre cible.' };
  if (company.problemFound === 'no') return { label: 'Pas de besoin repéré', explanation: 'Aucun problème concret à améliorer n’a été repéré.' };
  if (company.targetFit === 'yes' && company.problemFound === 'yes') {
    if (company.contactAvailable !== 'yes') {
      return { label: 'Contact à trouver', explanation: 'Il manque un moyen de contact professionnel confirmé.' };
    }
    if (company.observation.trim() && hasProfessionalContact(company.contact)) {
      return { label: 'Bonne piste', explanation: 'La cible, le constat concret et le moyen de contact sont renseignés.' };
    }
    if (!company.observation.trim()) {
      return { label: 'À vérifier', explanation: 'Il manque la description du problème concret.' };
    }
    return { label: 'À vérifier', explanation: 'Il manque un moyen de contact professionnel valide.' };
  }
  const missing: string[] = [];
  if (company.targetFit === 'unknown') missing.push('l’adéquation à votre cible');
  if (company.problemFound === 'unknown') missing.push('le problème concret à améliorer');
  if (company.contactAvailable === 'unknown') missing.push('le moyen de contact professionnel');
  return { label: 'À vérifier', explanation: missing.length
    ? `À vérifier : ${missing.join(', ')}.` : 'Complétez la qualification de cette entreprise.' };
}

export function parisToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function dueStatus(date: string, today = parisToday()): 'late' | 'today' | 'upcoming' | 'unplanned' {
  if (!isValidDate(date)) return 'unplanned';
  if (date < today) return 'late';
  if (date === today) return 'today';
  return 'upcoming';
}

export function formatDate(date: string): string {
  if (!date) return 'À planifier';
  if (!isValidDate(date)) return 'Date invalide';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris',
  }).format(new Date(`${date}T12:00:00Z`));
}

export function normalizedDomain(website: string): string {
  const value = normalizeWebsite(website);
  if (!safeHttpUrl(value)) return '';
  return new URL(value).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

export function normalizeText(value: string): string {
  return value.normalize('NFKD').replace(/\p{Mark}/gu, '').toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ').trim();
}

export function aiResults(test: Pick<AiTest, 'validResponses' | 'recommendations' | 'citations'>): {
  recommendations: string; citations: string;
} {
  const total = test.validResponses;
  if (total === 0) {
    return { recommendations: 'Non mesuré', citations: 'Non mesuré' };
  }
  if (total === null || !Number.isSafeInteger(total) || total < 0) {
    return { recommendations: 'Non renseigné', citations: 'Non renseigné' };
  }
  const measured = (count: number | null) => count !== null && Number.isSafeInteger(count) && count >= 0 && count <= total;
  const responses = (count: number) => `dans ${count} réponse${count === 1 ? '' : 's'} sur ${total}`;
  return {
    recommendations: measured(test.recommendations) ? `Recommandée ${responses(test.recommendations!)}` : 'Non renseigné',
    citations: measured(test.citations) ? `Site cité ${responses(test.citations!)}` : 'Non renseigné',
  };
}

export function isEligible(company: Pick<Company, 'archived' | 'oppositionActive' | 'stage'>): boolean {
  return !company.archived && !company.oppositionActive && company.stage !== 'Gagné' && company.stage !== 'Perdu';
}
