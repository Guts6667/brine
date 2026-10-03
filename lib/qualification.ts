import { z } from 'zod';
import type { Contact } from './types';
import { manualObservationKeys, type AfterExchangeData, type AfterExchangeEvaluation, type CriterionEvaluation, type CriterionKey, type DetailedObservations, type ManualObservationKey, type QualificationData, type QualificationEvaluation, type QualificationSubject, type QualificationTarget, type TargetSnapshot } from './qualification-types';

z.config(z.locales.fr());

export const QUALIFICATION_RULESET_ID = 'pickles-v1' as const;
export const QUALIFICATION_RULES = {
  id: QUALIFICATION_RULESET_ID,
  version: 1,
  recentDays: 90,
  criteria: {
    fit: { label: 'Cette entreprise correspond-elle à ma cible ?', maxPoints: 20, options: [
      { value: 'exact', label: 'Exactement', points: 20 }, { value: 'partial', label: 'Partiellement', points: 10 }, { value: 'none', label: 'Non', points: 0 }, { value: 'unknown', label: 'À vérifier', points: null },
    ] },
    problem: { label: 'Ai-je identifié un problème concret que je peux améliorer ?', maxPoints: 30, options: [
      { value: 'multiple_or_blocking', label: 'Plusieurs problèmes distincts ou un blocage important', points: 30 }, { value: 'one', label: 'Un problème concret vérifié', points: 15 }, { value: 'none', label: 'Aucun problème identifié après examen', points: 0 }, { value: 'unknown', label: 'À vérifier', points: null },
    ] },
    trigger: { label: 'Y a-t-il une raison pertinente de la contacter maintenant ?', maxPoints: 20, options: [
      { value: 'explicit', label: 'Besoin explicitement exprimé par l’entreprise', points: 20 }, { value: 'recent_change', label: 'Changement récent pertinent', points: 10 }, { value: 'none', label: 'Aucun déclencheur repéré après recherche', points: 0 }, { value: 'unknown', label: 'À vérifier', points: null },
    ] },
    references: { label: 'Cette entreprise possède-t-elle des preuves de son savoir-faire à mieux valoriser ?', maxPoints: 15, options: [
      { value: 'multiple', label: 'Plusieurs réalisations ou références', points: 15 }, { value: 'one', label: 'Une réalisation ou référence', points: 5 }, { value: 'none', label: 'Aucune trouvée après vérification', points: 0 }, { value: 'unknown', label: 'À vérifier', points: null },
    ] },
    access: { label: 'Ai-je un moyen professionnel de joindre le bon interlocuteur ?', maxPoints: 15, options: [
      { value: 'decision_maker', label: 'Décideur identifié avec un canal professionnel associé', points: 15 }, { value: 'generic', label: 'Canal professionnel générique de l’entreprise', points: 5 }, { value: 'none', label: 'Aucun canal trouvé après recherche', points: 0 }, { value: 'unknown', label: 'À vérifier', points: null },
    ] },
  },
} as const;

export const OBSERVATION_LABELS: Record<ManualObservationKey, string> = {
  siteAge: 'Le site paraît-il ancien ou peu actualisé ?',
  mobile: 'L’utilisation sur mobile présente-t-elle un problème ?',
  mainAction: 'Comprend-on facilement comment appeler, demander un devis ou prendre contact ?',
  services: 'Comprend-on précisément ce que l’entreprise propose, pour qui et dans quelle zone ?',
  contact: 'Le parcours de prise de contact est-il simple et fonctionnel ?',
  googleReviews: 'Ai-je consulté les avis affichés sur la fiche Google ?',
  recentActivity: 'Ai-je trouvé des signes vérifiables d’activité récente ?',
  siteSatisfactory: 'Après examen, le site répond-il déjà correctement aux besoins que j’ai vérifiés ?',
  inactivity: 'Une cessation ou une inactivité a-t-elle été vérifiée ?',
};
export const OBSERVATION_HELP: Record<ManualObservationKey, string> = {
  siteAge: 'Distinguez une date connue d’une impression visuelle. Un aspect ancien ne prouve pas un problème ni une fermeture.',
  mobile: 'Décrivez le défaut observé : texte illisible, débordement, menu inutilisable ou bouton inaccessible.',
  mainAction: 'L’action principale (CTA) indique comment appeler, demander un devis ou prendre contact. Oui signifie qu’elle est claire.',
  services: 'Oui signifie que l’offre est claire. Si Non, précisez l’information ou la prestation manquante.',
  contact: 'Oui signifie que le parcours fonctionne. Un téléphone ou un formulaire peut suffire ; ne faites pas de fausse demande pour le tester.',
  googleReviews: 'Les nombres sont facultatifs. Ils ne prouvent ni un budget, ni une activité, ni une capacité d’achat.',
  recentActivity: 'Conservez un exemple vérifiable et sa date d’événement, distincte de la date du relevé. Une absence de publication ne prouve pas une inactivité.',
  siteSatisfactory: 'Notez ce qui fonctionne pour les besoins réellement vérifiés. Cette observation n’applique aucune pénalité.',
  inactivity: 'Conservez la preuve et la date d’une cessation ou d’une inactivité vérifiée. La petite taille et un site ancien ne prouvent pas une fermeture.',
};
export const OBSERVATION_OPTIONS = [{ value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }, { value: 'unknown', label: 'À vérifier' }, { value: 'not_applicable', label: 'Non pertinent' }] as const;
export const AFTER_EXCHANGE_OPTIONS = {
  need: [{ value: 'unknown', label: 'À clarifier' }, { value: 'confirmed', label: 'Confirmé' }, { value: 'not_recognized', label: 'Non reconnu' }],
  timing: [{ value: 'unknown', label: 'À clarifier' }, { value: 'now', label: 'À traiter maintenant' }, { value: 'later', label: 'Plus tard' }, { value: 'not_priority', label: 'Pas une priorité' }],
  budget: [{ value: 'not_discussed', label: 'Non abordé' }, { value: 'unknown', label: 'À clarifier' }, { value: 'feasible', label: 'Envisageable pour la solution discutée' }, { value: 'incompatible', label: 'Incompatible confirmé pour cette solution' }],
  decision: [{ value: 'unknown', label: 'Processus à clarifier' }, { value: 'identified', label: 'Personne ou chemin de décision identifié' }],
  ability: [{ value: 'unknown', label: 'À clarifier' }, { value: 'confirmed', label: 'Possibilité d’avancer confirmée' }, { value: 'obstacle', label: 'Obstacle identifié' }],
  solution: [{ value: 'unknown', label: 'À définir' }, { value: 'audit', label: 'Audit' }, { value: 'targeted_improvement', label: 'Amélioration ciblée' }, { value: 'redesign', label: 'Refonte' }],
  solutionFit: [{ value: 'unknown', label: 'À confirmer' }, { value: 'confirmed', label: 'Confirmée' }, { value: 'not_adapted', label: 'Non adaptée' }],
} as const;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
const text = (limit = 5000) => z.string().trim().max(limit, `Maximum ${limit} caractères.`);
const date = text(10).refine(value => !value || validDate(value), 'Renseignez une date réelle au format AAAA-MM-JJ.');
const url = text(2000).refine(value => {
  if (!value) return true;
  try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) && !!parsed.hostname && !parsed.username && !parsed.password; } catch { return false; }
}, 'Utilisez un lien complet commençant par https:// ou http://.');
const keys = z.array(z.enum(manualObservationKeys)).max(manualObservationKeys.length).refine(value => new Set(value).size === value.length, 'Choisissez chaque observation une seule fois.');
const entries = z.array(text(2000)).max(20, 'Conservez au maximum 20 exemples courts.');
const answer = <const T extends readonly [string, ...string[]]>(values: T) => z.enum(values, { error: 'Choisissez une réponse proposée.' });
const defaults = <T extends z.ZodType>(schema: T, fallback: z.util.NoUndefined<z.output<T>>, input: boolean): T | z.ZodDefault<T> => input ? schema.default(() => structuredClone(fallback)) : schema;

function answersSchema(input: boolean) {
  const d = <T extends z.ZodType>(schema: T, value: z.util.NoUndefined<z.output<T>>) => defaults(schema, value, input);
  const fit = z.object({ answer: d(answer(['exact', 'partial', 'none', 'unknown']), 'unknown'), note: d(text(), ''), observationKeys: d(keys, []) }).strict();
  const problem = z.object({ answer: d(answer(['multiple_or_blocking', 'one', 'none', 'unknown']), 'unknown'), description: d(text(), ''), observedOn: d(date, ''), proofUrl: d(url, ''), majorReason: d(answer(['unknown', 'multiple', 'blocking']), 'unknown'), distinctProblems: d(entries, []), blockingExplanation: d(text(), ''), observationKeys: d(keys, []) }).strict();
  const trigger = z.object({ answer: d(answer(['explicit', 'recent_change', 'none', 'unknown']), 'unknown'), description: d(text(), ''), source: d(text(2000), ''), verifiedOn: d(date, ''), eventOn: d(date, ''), relevance: d(text(), ''), observationKeys: d(keys, []) }).strict();
  const references = z.object({ answer: d(answer(['multiple', 'one', 'none', 'unknown']), 'unknown'), examples: d(entries, []), improvement: d(text(), ''), sourceUrl: d(url, ''), observationKeys: d(keys, []) }).strict();
  const access = z.object({ answer: d(answer(['decision_maker', 'generic', 'none', 'unknown']), 'unknown'), channelAssociation: d(text(), ''), observationKeys: d(keys, []) }).strict();
  return z.object({ fit: d(fit, fit.parse(input ? {} : { answer: 'unknown', note: '', observationKeys: [] })), problem: input ? problem.default(() => problem.parse({})) : problem, trigger: input ? trigger.default(() => trigger.parse({})) : trigger, references: input ? references.default(() => references.parse({})) : references, access: input ? access.default(() => access.parse({})) : access }).strict();
}

function observationDataSchema(input: boolean) {
  const d = <T extends z.ZodType>(schema: T, value: z.util.NoUndefined<z.output<T>>) => defaults(schema, value, input);
  const observation = z.object({ answer: d(answer(['yes', 'no', 'unknown', 'not_applicable']), 'unknown'), notes: d(text(), ''), sourceUrl: d(url, ''), observedOn: d(date, '') }).strict();
  const itemFields = Object.fromEntries(manualObservationKeys.map(key => [key, input ? observation.default(() => observation.parse({})) : observation])) as Record<ManualObservationKey, typeof observation>;
  const items = z.object(itemFields).strict();
  return z.object({ items: input ? items.default(() => items.parse({})) : items, siteAgeBasis: d(answer(['unknown', 'dated_evidence', 'visual_impression']), 'unknown'), siteDate: d(date, ''), googleReviewCount: d(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(), null), googleRating: d(z.number().min(0).max(5).nullable(), null), companySize: d(text(300), ''), recentEventOn: d(date, '') }).strict();
}

function exchangeDataSchema(input: boolean) {
  const d = <T extends z.ZodType>(schema: T, value: z.util.NoUndefined<z.output<T>>) => defaults(schema, value, input);
  const nextStep = z.object({ description: d(text(), ''), date: d(date, ''), accepted: d(z.boolean(), false) }).strict();
  const fields = {
    need: d(answer(['unknown', 'confirmed', 'not_recognized']), 'unknown'), needNote: d(text(), ''),
    timing: d(answer(['unknown', 'now', 'later', 'not_priority']), 'unknown'), timingNote: d(text(), ''), timingDate: d(date, ''),
    budget: d(answer(['not_discussed', 'unknown', 'feasible', 'incompatible']), 'not_discussed'), budgetNote: d(text(), ''), budgetScope: d(text(500), ''),
    decision: d(answer(['unknown', 'identified']), 'unknown'), decisionNote: d(text(), ''),
    ability: d(answer(['unknown', 'confirmed', 'obstacle']), 'unknown'), abilityNote: d(text(), ''), obstacleBlocking: d(z.boolean(), false),
    solution: d(answer(['unknown', 'audit', 'targeted_improvement', 'redesign']), 'unknown'), solutionNote: d(text(), ''), solutionFit: d(answer(['unknown', 'confirmed', 'not_adapted']), 'unknown'),
    nextStep: input ? nextStep.default(() => nextStep.parse({})) : nextStep,
  };
  const qualifiedAt = text(40).refine(value => !value || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value)), 'Date de qualification invalide.');
  return z.object({ ...fields, qualifiedAt: input ? qualifiedAt.default('') : qualifiedAt }).strict();
}

export const targetSnapshotSchema = z.object({ targetCity: text(180), targetBusiness: text(300), targetCompanyType: text(300), targetOffer: text(1000), targetExclusions: text(2000) }).strict();
export const qualificationInputSchema = z.object({ answers: answersSchema(true).default(() => answersSchema(true).parse({})) }).strict();
export const observationsSchema = observationDataSchema(true);
export const afterExchangeInputSchema = exchangeDataSchema(true).omit({ qualifiedAt: true });
export const qualificationDataSchema = z.object({ version: z.literal(1), answers: answersSchema(false), targetSnapshot: targetSnapshotSchema.nullable(), observations: observationDataSchema(false), afterExchange: exchangeDataSchema(false) }).strict();

export function captureTarget(settings: QualificationTarget): TargetSnapshot {
  return targetSnapshotSchema.parse({ targetCity: settings.targetCity, targetBusiness: settings.targetBusiness, targetCompanyType: settings.targetCompanyType || '', targetOffer: settings.targetOffer || '', targetExclusions: settings.targetExclusions || '' });
}
export function emptyQualification(): QualificationData {
  return structuredClone({
    version: 1, answers: qualificationInputSchema.parse({}).answers as QualificationData['answers'], targetSnapshot: null,
    observations: observationsSchema.parse({}) as DetailedObservations,
    afterExchange: { ...afterExchangeInputSchema.parse({}), qualifiedAt: '' } as AfterExchangeData,
  });
}
function dataFor(company: QualificationSubject): QualificationData {
  return company.qualification ? qualificationDataSchema.parse(company.qualification) as QualificationData : emptyQualification();
}
function sameTarget(snapshot: TargetSnapshot | null, settings: QualificationTarget): boolean {
  const current = captureTarget(settings);
  return !!snapshot && (Object.keys(current) as (keyof TargetSnapshot)[]).every(key => snapshot[key] === current[key]);
}
function ageInDays(earlier: string, later: string): number {
  // ISO calendar dates compare consistently without timezone or DST arithmetic.
  return (Date.parse(`${later}T12:00:00Z`) - Date.parse(`${earlier}T12:00:00Z`)) / 86_400_000;
}
function professionalChannel(contact: Contact): boolean {
  const phone = contact.phone.trim();
  const digits = phone.replace(/\D/g, '');
  return !!(contact.email && z.email().safeParse(contact.email).success) || (!!phone && /^\+?[\d(][\d\s()./-]*$/.test(phone) && digits.length >= 7 && digits.length <= 15) || !!(contact.formUrl && url.safeParse(contact.formUrl).success) || !!(contact.profileUrl && url.safeParse(contact.profileUrl).success);
}
function distinct(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim().toLocaleLowerCase('fr').replace(/\s+/g, ' ')).filter(Boolean))];
}

/** A score is derived only from manually selected criteria with sufficient evidence. */
export function evaluateQualification(company: QualificationSubject, settings: QualificationTarget, today: string): QualificationEvaluation {
  if (!validDate(today)) throw new Error('La date d’évaluation doit être explicite et valide.');
  const data = dataFor(company);
  const a = data.answers;
  const targetNeedsRevalidation = a.fit.answer !== 'unknown' && !sameTarget(data.targetSnapshot, settings);
  const missingByKey: Record<CriterionKey, string[]> = { fit: [], problem: [], trigger: [], references: [], access: [] };
  const reasonsByKey: Record<CriterionKey, string[]> = { fit: [], problem: [], trigger: [], references: [], access: [] };
  for (const key of Object.keys(missingByKey) as CriterionKey[]) if (a[key].answer === 'unknown') missingByKey[key].push('Choisir une réponse après vérification.');
  if (a.fit.answer !== 'unknown' && !data.targetSnapshot) missingByKey.fit.push('Valider explicitement l’adéquation à la cible utilisée.');
  if (a.fit.answer === 'exact') reasonsByKey.fit.push('Adéquation exacte à la cible validée manuellement.');
  if (a.fit.note) reasonsByKey.fit.push(a.fit.note);

  if (['one', 'multiple_or_blocking'].includes(a.problem.answer)) {
    if (!a.problem.description) missingByKey.problem.push('Décrire le problème concret observé.');
    if (!a.problem.observedOn) missingByKey.problem.push('Renseigner sa date d’observation.');
    else if (a.problem.observedOn > today) missingByKey.problem.push('La date d’observation ne peut pas être future.');
    if (a.problem.answer === 'multiple_or_blocking') {
      if (a.problem.majorReason === 'unknown') missingByKey.problem.push('Préciser plusieurs problèmes distincts ou un blocage important.');
      if (a.problem.majorReason === 'multiple' && distinct(a.problem.distinctProblems).length < 2) missingByKey.problem.push('Identifier au moins deux problèmes distincts.');
      if (a.problem.majorReason === 'blocking' && !a.problem.blockingExplanation) missingByKey.problem.push('Expliquer en quoi le blocage est important.');
    }
    if (a.problem.description) reasonsByKey.problem.push(a.problem.description);
  }
  if (['explicit', 'recent_change'].includes(a.trigger.answer)) {
    if (!a.trigger.description) missingByKey.trigger.push('Décrire le déclencheur vérifié.');
    if (!a.trigger.source) missingByKey.trigger.push('Renseigner l’origine de l’information ou l’échange réel.');
    if (!a.trigger.verifiedOn) missingByKey.trigger.push('Renseigner la date de vérification.');
    else if (a.trigger.verifiedOn > today) missingByKey.trigger.push('La vérification ne peut pas être future.');
    if (a.trigger.answer === 'recent_change') {
      if (!a.trigger.eventOn) missingByKey.trigger.push('Renseigner la date de l’événement ou de l’annonce.');
      if (!a.trigger.relevance) missingByKey.trigger.push('Expliquer le lien avec l’intervention proposée.');
      if (a.trigger.eventOn && a.trigger.verifiedOn) {
        const elapsed = ageInDays(a.trigger.eventOn, a.trigger.verifiedOn);
        if (elapsed < 0 || elapsed > QUALIFICATION_RULES.recentDays) missingByKey.trigger.push('L’événement doit précéder sa vérification de 0 à 90 jours.');
      }
    }
    if (a.trigger.description) reasonsByKey.trigger.push(a.trigger.description);
  }
  if (['one', 'multiple'].includes(a.references.answer)) {
    const minimum = a.references.answer === 'multiple' ? 2 : 1;
    if (distinct(a.references.examples).length < minimum) missingByKey.references.push(minimum === 2 ? 'Identifier au moins deux réalisations ou références distinctes.' : 'Identifier une réalisation ou une référence concrète.');
    if (!a.references.improvement) missingByKey.references.push('Préciser ce qui pourrait être mieux présenté.');
    if (a.references.improvement) reasonsByKey.references.push(a.references.improvement);
  }
  if (['generic', 'decision_maker'].includes(a.access.answer)) {
    if (!professionalChannel(company.contact)) missingByKey.access.push('Renseigner au moins un canal professionnel valide.');
    if (a.access.answer === 'decision_maker') {
      if (!company.contact.name.trim()) missingByKey.access.push('Renseigner l’identité du décideur.');
      if (!company.contact.role.trim()) missingByKey.access.push('Renseigner sa fonction ou son rôle dans la décision.');
      if (!a.access.channelAssociation) missingByKey.access.push('Préciser le lien entre cet interlocuteur et son canal.');
    }
    reasonsByKey.access.push(a.access.answer === 'generic' ? 'Canal professionnel générique renseigné.' : `Interlocuteur identifié : ${company.contact.name}.`);
  }
  const criteria: CriterionEvaluation[] = (Object.keys(QUALIFICATION_RULES.criteria) as CriterionKey[]).map(key => {
    const rule = QUALIFICATION_RULES.criteria[key];
    const option = rule.options.find(item => item.value === a[key].answer)!;
    const complete = missingByKey[key].length === 0;
    return { key, label: rule.label, maxPoints: rule.maxPoints, answerLabel: option.label, complete, points: complete ? option.points : null, missing: missingByKey[key], reasons: complete ? reasonsByKey[key] : [], linkedObservations: a[key].observationKeys.map(observationKey => ({ key: observationKey, label: OBSERVATION_LABELS[observationKey], observation: { ...data.observations.items[observationKey] } })) };
  });
  const completedCount = criteria.filter(item => item.complete).length;
  const confirmedPoints = criteria.reduce((total, item) => total + (item.points ?? 0), 0);
  const complete = completedCount === 5;
  const score = complete ? confirmedPoints : null;
  const blockers: string[] = [];
  if (company.oppositionActive) blockers.push('Une opposition à être contacté est active.');
  if (a.fit.answer === 'none') blockers.push('L’entreprise a été évaluée hors cible.');
  if (a.fit.answer === 'partial') blockers.push('L’adéquation partielle à la cible doit être confirmée.');
  if (a.problem.answer === 'none') blockers.push('Aucun problème concret n’a été établi après examen.');
  if (a.access.answer === 'none') blockers.push('Aucun canal professionnel n’a été trouvé après recherche.');
  const decision = company.oppositionActive ? 'Ne plus contacter' : a.fit.answer === 'none' ? 'Hors cible' : a.fit.answer === 'partial' ? 'Cible à confirmer' : a.problem.answer === 'none' ? 'Besoin non établi' : a.access.answer === 'none' ? 'Contact à trouver' : !complete || targetNeedsRevalidation ? 'À vérifier' : 'Prêt à contacter';
  const triggerNeedsReverification = (a.trigger.answer === 'recent_change' && !!a.trigger.eventOn && ageInDays(a.trigger.eventOn, today) > QUALIFICATION_RULES.recentDays) || (a.trigger.answer === 'explicit' && !!a.trigger.verifiedOn && ageInDays(a.trigger.verifiedOn, today) > QUALIFICATION_RULES.recentDays);
  const warnings: string[] = [];
  if (targetNeedsRevalidation) warnings.push('Adéquation à revérifier : la cible utilisée n’est pas la cible actuelle.');
  if (triggerNeedsReverification) warnings.push('Ce déclencheur est ancien : revérifiez sa pertinence. Les dates et points vérifiés sont conservés.');
  const missing = criteria.flatMap(item => item.missing.map(message => `${item.label} — ${message}`));
  return {
    version: 1, rulesetId: QUALIFICATION_RULESET_ID, score, confirmedPoints, completedCount, complete, evaluated: (Object.keys(a) as CriterionKey[]).some(key => a[key].answer !== 'unknown'),
    priority: score === null ? null : score >= 70 ? 'Priorité haute' : score >= 50 ? 'Priorité intermédiaire' : 'Priorité basse',
    decision, criteria, missingCriteria: criteria.filter(item => !item.complete).map(item => item.key), missing,
    reasons: criteria.flatMap(item => item.reasons).slice(0, 3), blockers, nextInformation: targetNeedsRevalidation ? 'Revalider l’adéquation à la cible actuelle.' : missing[0] || (decision === 'Prêt à contacter' ? 'Préparer le message avant de choisir une action.' : blockers[0] || ''),
    targetNeedsRevalidation, triggerNeedsReverification, warnings,
  };
}

/** First-contact suggestions exclude every stage beyond the first two. */
export function isFirstContactCandidate(company: QualificationSubject, settings: QualificationTarget, today: string): boolean {
  return !company.archived && ['À étudier', 'À contacter'].includes(company.stage || 'À étudier') && evaluateQualification(company, settings, today).decision === 'Prêt à contacter';
}

export function evaluateAfterExchange(company: QualificationSubject): AfterExchangeEvaluation {
  const exchange = dataFor(company).afterExchange;
  const missing: string[] = [];
  const blockers: string[] = [];
  const toVerify: string[] = [];
  if (company.oppositionActive) blockers.push('Une opposition à être contacté est active.');
  if (exchange.need === 'not_recognized') blockers.push('Le besoin n’est pas reconnu par l’interlocuteur.');
  if (exchange.need !== 'confirmed') missing.push('Confirmer le besoin avec l’interlocuteur.');
  if (exchange.need === 'confirmed' && !exchange.needNote) missing.push('Reformuler les propos confirmant le besoin.');
  if (exchange.solution === 'unknown') missing.push('Identifier une intervention pertinente.');
  if (!exchange.solutionNote) missing.push('Justifier la solution envisagée par rapport au besoin.');
  if (exchange.solutionFit === 'not_adapted') blockers.push('La solution envisagée n’est pas adaptée au besoin.');
  if (exchange.solutionFit !== 'confirmed') missing.push('Confirmer l’adéquation de la solution au besoin.');
  if (exchange.decision !== 'identified' || !exchange.decisionNote) missing.push('Identifier et décrire la personne ou le chemin de décision.');
  if (!exchange.nextStep.description || !exchange.nextStep.accepted) missing.push('Décrire une prochaine étape explicitement acceptée par l’interlocuteur.');
  if (exchange.budget === 'incompatible') blockers.push('Le budget a été confirmé incompatible avec la solution discutée.');
  if (exchange.budget === 'incompatible' || exchange.budget === 'feasible') {
    if (!exchange.budgetScope) toVerify.push('Préciser le périmètre auquel le budget discuté se rapporte.');
    if (!exchange.budgetNote) toVerify.push('Documenter les informations de budget réellement discutées.');
  } else toVerify.push('Le budget de la solution discutée reste à vérifier.');
  if (exchange.ability === 'obstacle' && exchange.obstacleBlocking) blockers.push('Un obstacle explicitement bloquant empêche cette solution à ce stade.');
  if (exchange.ability === 'obstacle' && !exchange.abilityNote) toVerify.push('Préciser l’obstacle identifié.');
  if (exchange.ability === 'unknown') toVerify.push('La capacité pratique à avancer reste à clarifier.');
  if (exchange.timing === 'unknown') toVerify.push('La priorité et le calendrier restent à clarifier.');
  const possible = missing.length === 0 && blockers.length === 0;
  const label = blockers.length ? 'Qualification bloquée' : ['later', 'not_priority'].includes(exchange.timing) ? 'À revoir plus tard' : possible ? 'Qualification possible' : 'À clarifier';
  return { possible, qualificationPossible: possible, label, missing, blockers, toVerify, reevaluationRequired: (!!exchange.qualifiedAt || company.stage === 'Opportunité qualifiée') && !possible };
}
export function canQualifyOpportunity(company: QualificationSubject): boolean { return evaluateAfterExchange(company).possible; }
