import type { Campaign } from './campaign-types';
import type { Company } from './types';
import type { ApproachPlan, ContactDraft, ContactEvent, ProspectReport, ProviderProfile, ResearchFact } from './research-types';
import { evaluateQualification } from './qualification';
import { approachPlanSchema, contactDraftSchema, researchUrlSchema } from './research-schemas';

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const stableId = (prefix: string, value: unknown) => {
  const input = JSON.stringify(value); let hash = 2166136261;
  for (let index = 0; index < input.length; index++) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `${prefix}-${(hash >>> 0).toString(16)}`;
};
export function emptyProviderProfile(): ProviderProfile {
  return { name: '', activity: '', skills: '', services: '', website: '', references: '', terms: '', prices: '', signature: '', revision: 0 };
}

function validEvidence(report: ProspectReport, ids: string[]): ResearchFact[] {
  const sourceIds = new Set(report.sources.map(source => source.id));
  const facts = ids.map(id => report.facts.find(fact => fact.id === id));
  if (!ids.length || new Set(ids).size !== ids.length || facts.some(fact => !fact || fact.corrected || fact.kind === 'hypothesis' || !fact.sourceIds.length || fact.sourceIds.some(id => !sourceIds.has(id)))) {
    throw new Error('Choisissez un constat sourcé, non corrigé et distinct d’une hypothèse.');
  }
  return facts as ResearchFact[];
}
function documentedChange(fact: ResearchFact): boolean {
  const text = normalize(fact.text);
  // A consultation date is not the date of an event. The public declaration must name both.
  const event = /\b(?:ouverture|reouverture|nouvelle activite|nouveau service|nouvelle prestation|recrut(?:e|ent|ement)|demenagement|changement (?:d['’]adresse|de locaux|d['’]activite|de services?))\b/.test(text);
  const date = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{4}\b|\b(?:\d{1,2}(?:er)?\s+)?(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+\d{4}\b/.test(text);
  return event && date && !/\b(?:aucune?|pas de|sans) (?:nouvelle activite|ouverture|reouverture|recrutement|demenagement|changement)\b/.test(text);
}
function rank(fact: ResearchFact): number {
  const text = normalize(fact.text);
  return /(?:a exprime|demande explicite|besoin exprime|besoin declare)/.test(text) ? 0
    : fact.sentiment === 'issue' && fact.kind === 'observed' ? 1
      : documentedChange(fact) ? 2
        : ['presentation', 'presence'].includes(fact.section) ? 3 : 4;
}

function angleFor(fact: ResearchFact, offer: string): Pick<ApproachPlan, 'hypothesis' | 'help' | 'question' | 'nextStep'> | null {
  const text = normalize(fact.text), services = normalize(offer);
  // A source is not a reason to offer an unrelated service. This deliberately stays conservative.
  const webOffer = /site|web|developp|application|refonte|mobile|interface|numerique|digital|seo|devis|contact|vitrine|presentation|prestations|chargement|performance|accessib|conversion|visibilite/.test(services);
  if (!webOffer) return null;
  const nextStep = 'Selon votre réponse, préciser le fonctionnement et le résultat souhaité, puis convenir d’une prochaine étape seulement si elle vous est utile.';
  if (fact.section === 'fit' && /besoin (?:declare|exprime)|demande explicite/.test(text) && !/besoin non reconnu|pas de besoin/.test(text)) return {
    hypothesis: 'Le besoin exprimé donne un point de départ ; son périmètre, ses contraintes et la solution adaptée restent à préciser.',
    help: 'Préciser avec vous ce besoin et définir une intervention adaptée à votre fonctionnement, dans le cadre de mon offre.',
    question: 'Quel résultat aimeriez-vous obtenir en priorité et comment faites-vous aujourd’hui ?', nextStep,
  };
  if (['fit', 'presentation'].includes(fact.section) && documentedChange(fact)) return {
    hypothesis: 'Ce changement documenté peut faire évoluer les informations à présenter ; aucune difficulté ni intention d’achat n’est déduite.',
    help: 'Examiner avec vous si vos supports de présentation et de contact doivent évoluer avec ce changement.',
    question: 'Qu’aimeriez-vous que les personnes qui découvrent cette évolution comprennent en priorité ?', nextStep,
  };
  if (fact.sentiment === 'issue' && /(?:404|410|5\d\d|lien|contact|devis)/.test(text) && ['site', 'contact'].includes(fact.section)) return {
    hypothesis: 'Cet accès peut compliquer une demande si le défaut se reproduit pour les visiteurs ; son impact réel reste à confirmer.',
    help: 'Vérifier cet accès avec vous et envisager une correction ciblée si le problème se confirme.',
    question: 'Quel canal souhaitez-vous privilégier pour recevoir les demandes de nouveaux projets ?', nextStep,
  };
  if (fact.sentiment === 'issue' && /lcp|chargement|lenteur|performance/.test(text)) return {
    hypothesis: 'Le chargement peut gêner certains usages si la mesure se reproduit sur des téléphones et connexions représentatifs.',
    help: 'Vérifier le chargement en conditions représentatives et définir les corrections utiles si la lenteur se confirme.',
    question: 'Quels usages du site sont les plus importants pour les personnes qui vous découvrent ?', nextStep,
  };
  if (fact.sentiment === 'issue' && /viewport|zoom|mobile|accessib/.test(text)) return {
    hypothesis: 'Cette configuration peut gêner certains usages sur téléphone ; le rendu et le besoin restent à vérifier.',
    help: 'Examiner ce point sur téléphone avec vous et envisager une correction ciblée si le défaut est confirmé.',
    question: 'Comment souhaitez-vous que les visiteurs vous découvrent et vous contactent depuis leur téléphone ?', nextStep,
  };
  if (fact.sentiment === 'issue' && /indexation|exploration|robots/.test(text)) return {
    hypothesis: 'Le blocage relevé peut être volontaire ; l’objectif de visibilité de cette page reste à confirmer.',
    help: 'Vérifier avec vous si cette page doit être indexable avant de proposer un réglage.',
    question: 'Quelles informations souhaitez-vous rendre accessibles aux personnes qui recherchent votre activité ?', nextStep,
  };
  if (fact.section === 'visibility') return {
    hypothesis: 'Ce relevé décrit les recherches enregistrées ; il ne permet pas de conclure à une absence générale ni à une perte de clients.',
    help: 'Partager le relevé et examiner avec vous les informations publiques utiles pour présenter votre activité.',
    question: 'Comment les personnes qui ne vous connaissent pas encore trouvent-elles les informations sur vos prestations ?', nextStep,
  };
  if (fact.section === 'presence' && /instagram|facebook|profil/.test(text)) return {
    hypothesis: 'Ce profil peut servir à présenter l’activité ; les autres supports et la façon de recevoir les demandes restent à découvrir.',
    help: 'Examiner avec vous la présentation de vos prestations et le parcours de contact, selon vos besoins.',
    question: 'Comment présentez-vous l’ensemble de vos prestations aux personnes qui vous découvrent sur ce profil ?', nextStep,
  };
  if (fact.section === 'presentation' || fact.section === 'fit' && /presentation|prestations|realisations|interventions|services/.test(text)) return {
    hypothesis: 'Les prestations ou réalisations documentées peuvent servir de point de départ pour discuter de leur présentation ; aucun défaut n’est déduit.',
    help: 'Examiner avec vous la façon de présenter ces prestations ou réalisations, si vous souhaitez la faire évoluer.',
    question: 'Qu’aimeriez-vous que les personnes qui découvrent votre activité comprennent en priorité ?', nextStep,
  };
  if (['contact', 'presence'].includes(fact.section) && fact.sentiment !== 'issue') return {
    hypothesis: 'Les informations publiées constituent un point de départ ; elles ne prouvent pas une difficulté de contact ou un besoin de refonte.',
    help: 'Comprendre votre parcours de présentation et de contact avant d’envisager une amélioration.',
    question: 'Comment recevez-vous et traitez-vous les demandes de nouveaux projets aujourd’hui ?', nextStep,
  };
  // A satisfactory viewport, score, or metric alone is not an invented reason to redesign.
  return null;
}

function offeredServices(campaign: Campaign, profile: ProviderProfile): string {
  return [campaign.targetOffer?.trim(), profile.services.trim(), profile.skills.trim()].filter(Boolean).join(' · ');
}
function orderEvidence(facts: ResearchFact[]): ResearchFact[] {
  return facts.map((fact, index) => ({ fact, index })).sort((a, b) => rank(a.fact) - rank(b.fact) || a.index - b.index).map(item => item.fact);
}
/** The chooser and preparation use the same offer and provenance checks; no new collection occurs. */
export function getEligibleApproachEvidence(report: ProspectReport, campaign: Campaign, profile: ProviderProfile): ResearchFact[] {
  const offer = offeredServices(campaign, profile);
  if (!offer) return [];
  return orderEvidence(report.facts.filter(fact => {
    try { validEvidence(report, [fact.id]); } catch { return false; }
    return !!angleFor(fact, offer);
  }));
}

export function createApproachPlan(report: ProspectReport, campaign: Campaign, profile: ProviderProfile, evidenceIds: string[], now = new Date()): ApproachPlan {
  const facts = orderEvidence(validEvidence(report, evidenceIds));
  const offer = offeredServices(campaign, profile);
  if (!offer) throw new Error('Précisez votre offre réelle avant de préparer une approche.');
  const fact = facts.find(item => angleFor(item, offer));
  if (!fact) throw new Error('Aucun motif pertinent documenté pour votre offre. Complétez le dossier, gardez pour plus tard ou écartez.');
  const refutation = report.facts.find(item => item.refutesFactId === fact.id && !item.corrected);
  const angle = refutation ? {
    hypothesis: `La conséquence précédemment supposée a été réfutée : ${refutation.text}. Le fait observé reste conservé ; aucun impact commercial n’est déduit.`,
    help: 'Comprendre le fonctionnement et le résultat souhaité avant de proposer une intervention, si elle vous est utile.',
    question: 'Y a-t-il un aspect de votre présentation ou de votre parcours de contact que vous aimeriez faire évoluer ?',
    nextStep: 'Si aucun besoin n’est exprimé, clôturer ou conserver pour plus tard. Sinon, préciser les attentes avant de définir une aide.',
  } : angleFor(fact, offer)!;
  const alternatives = getEligibleApproachEvidence(report, campaign, profile).filter(item => item.id !== fact.id)
    .slice(0, 2).map(item => ({ motive: item.text, evidenceIds: [item.id], rationale: 'Alternative sourcée à examiner selon votre offre ; ne pas cumuler les motifs dans le premier contact.' }));
  const plan: ApproachPlan = {
    version: 1, method: 'conversation-v1', id: stableId('plan', [report.id, fact.id, campaign.targetOffer, profile.revision, angle]), reportId: report.id,
    evidenceIds: [fact.id], motive: fact.text,
    rationale: `${fact.kind === 'observed' ? 'Observation directe' : 'Information rapportée par une source'} liée à votre offre. ${fact.scope} Le premier contact cherche à comprendre le fonctionnement, sans prédire un achat.`,
    ...angle, offer: campaign.targetOffer?.trim() || profile.services || profile.skills, createdAt: now.toISOString(), alternatives,
  };
  return approachPlanSchema.parse(plan) as ApproachPlan;
}

function assertPlan(plan: ApproachPlan, report: ProspectReport): void {
  if (plan.reportId !== report.id || plan.revalidateReason) throw new Error('Le dossier ou le motif a changé : revalidez le plan avant de préparer un contact.');
  validEvidence(report, plan.evidenceIds);
}
function introduction(profile: ProviderProfile): string {
  if (profile.name && profile.activity) return `Je suis ${profile.name}, ${profile.activity}.`;
  if (profile.name) return `Je suis ${profile.name}.`;
  if (profile.activity) return `J’exerce comme ${profile.activity}.`;
  return 'Je vous contacte au sujet de votre activité.';
}
function signature(profile: ProviderProfile): string {
  return profile.signature || [profile.name, profile.activity, profile.website].filter(Boolean).join('\n');
}
function draft(plan: ApproachPlan, profile: ProviderProfile, channel: ContactDraft['channel'], subject: string, blocks: ContactDraft['blocks'], now = new Date()): ContactDraft {
  const result: ContactDraft = { id: stableId('draft', [plan.id, profile.revision, channel, blocks]), version: 1, channel, planId: plan.id, reportId: plan.reportId,
    profileRevision: profile.revision, subject, text: blocks.map(block => block.text).filter(Boolean).join('\n\n'), blocks, createdAt: now.toISOString(), origin: 'template' };
  return contactDraftSchema.parse(result) as ContactDraft;
}
export const conversationQuestions = [
  { label: 'Fonctionnement', text: 'Comment recevez-vous les demandes aujourd’hui ?', purpose: 'Comprendre le fonctionnement actuel sans supposer une difficulté.' },
  { label: 'Difficulté éventuelle', text: 'Qu’est-ce qui vous complique le traitement de ces demandes, s’il y a quelque chose ?', purpose: 'Vérifier si une difficulté est réellement reconnue.' },
  { label: 'Conséquence vécue', text: 'Quand cela arrive, qu’est-ce que cela change concrètement pour vous ?', purpose: 'Comprendre une conséquence exprimée, après reconnaissance d’une difficulté.' },
  { label: 'Résultat souhaité', text: 'Qu’aimeriez-vous simplifier en priorité ?', purpose: 'Identifier le résultat recherché avant de définir une solution.' },
] as const;
export const conversationBranches = [
  { label: 'Pas disponible', text: 'Demander un moment approprié, ou terminer si la personne ne souhaite pas poursuivre.' },
  { label: 'Déjà pris en charge', text: 'Vérifier s’il reste une difficulté uniquement si la personne souhaite en parler ; sinon clôturer.' },
  { label: 'Pas une priorité', text: 'Enregistrer cette information. Proposer un suivi uniquement si la personne le souhaite.' },
  { label: 'Intéressé', text: 'Préciser le fonctionnement, le résultat souhaité et les contraintes, puis convenir d’une prochaine étape explicite.' },
  { label: 'Demande un prix', text: 'Utiliser uniquement les tarifs renseignés, ou préciser le périmètre avant de chiffrer.' },
  { label: 'Refus', text: 'Clôturer courtoisement. Une demande de ne plus contacter active l’opposition commune.' },
] as const;

export interface DraftContext { event?: ContactEvent; followup?: boolean; now?: Date }
function observationExcerpt(value: string, maximum = 260): { text: string; shortened: boolean } {
  if (value.length <= maximum) return { text: value, shortened: false };
  const prefix = value.slice(0, maximum);
  const sentenceEnds = [...prefix.matchAll(/[.!?](?:\s|$)/g)].map(match => match.index + 1);
  const sentenceEnd = sentenceEnds.at(-1);
  const boundary = sentenceEnd && sentenceEnd >= 80 ? sentenceEnd : prefix.lastIndexOf(' ');
  return { text: value.slice(0, boundary && boundary > 0 ? boundary : maximum).trimEnd() + '…', shortened: true };
}
function helpSentence(value: string): string {
  const text = value.trim();
  if (!text) return '';
  // Keep a personal sentence intact; only infinitive-style instructions need an introduction.
  if (/^(?:je\b|j['’]|nous\b)/i.test(text)) return text;
  const help = text.charAt(0).toLowerCase() + text.slice(1);
  const introduction = /^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(help) ? 'd’' : 'de ';
  return `Je peux vous proposer ${introduction}${help}`;
}
export function buildContactDrafts(plan: ApproachPlan, report: ProspectReport, profile: ProviderProfile, context: DraftContext = {}): ContactDraft[] {
  assertPlan(plan, report);
  const now = context.now || new Date(), fact = report.facts.find(item => item.id === plan.evidenceIds[0])!;
  const excerpt = observationExcerpt(plan.motive);
  const observation = `${fact.kind === 'observed' ? 'Lors de ma vérification' : 'Dans les informations publiques consultées'}${fact.observedOn ? ` du ${fact.observedOn.slice(0, 10)}` : ''}, j’ai relevé ${excerpt.shortened ? 'cet extrait' : 'ce point'} : ${excerpt.text}`;
  const subject = fact.section === 'presentation' ? 'La présentation de vos prestations' : fact.section === 'presence' ? 'Vos prestations et votre présence en ligne' : fact.section === 'visibility' ? 'Les informations sur votre activité' : 'Votre parcours de contact en ligne';
  const email = draft(plan, profile, 'email', subject, [
    { label: 'Salutation', text: 'Bonjour,' }, { label: 'Présentation', text: introduction(profile) },
    { label: 'Observation sourcée', text: observation }, { label: 'Aide proportionnée', text: helpSentence(plan.help) },
    { label: 'Question principale', text: plan.question }, { label: 'Signature', text: signature(profile) },
  ], now);
  const call = draft(plan, profile, 'call', 'Trame pour ouvrir une conversation', [
    { label: 'Ouverture', text: `Bonjour, ${introduction(profile)} Est-ce que je peux vous expliquer brièvement la raison de mon appel ?` },
    { label: 'Bon interlocuteur', text: 'Si nécessaire : qui s’occupe de la présentation de vos prestations et des demandes reçues ?' },
    { label: 'Motif et périmètre', text: observation }, { label: 'Question de départ', text: plan.question },
    { label: 'Écouter et reformuler', text: 'Laisser la personne répondre, puis reformuler ses mots avant d’aborder une aide possible.' },
    ...conversationQuestions.map(question => ({ label: question.label, text: `${question.text}\nBut : ${question.purpose}` })),
    { label: 'Aide, après confirmation', text: plan.help },
    ...conversationBranches.map(branch => ({ ...branch, text: branch.label === 'Demande un prix' && profile.prices ? `${branch.text}\nTarifs déclarés : ${profile.prices}` : branch.text })),
    { label: 'Prochaine étape', text: plan.nextStep },
  ], now);
  const results = [email, call];
  if (context.event?.outcome === 'conversation' || context.event?.outcome === 'callback') results.push(buildReplyDraft(plan, report, profile, context.event, now));
  if (context.followup && context.event?.outcome === 'no_response') results.push(buildFollowupDraft(plan, report, profile, context.event, now));
  return results;
}
export function buildReplyDraft(plan: ApproachPlan, report: ProspectReport, profile: ProviderProfile, event: ContactEvent, now = new Date()): ContactDraft {
  assertPlan(plan, report);
  if (!['conversation', 'callback'].includes(event.outcome) || !event.note.trim()) throw new Error('Enregistrez les propos de l’échange avant de préparer une réponse.');
  return draft(plan, profile, 'reply', 'Suite à notre échange', [
    { label: 'Salutation', text: 'Bonjour,' },
    { label: 'Propos enregistrés, à reformuler', text: `J’ai noté ce point lors de notre échange du ${event.date} : « ${event.note} ».` },
    { label: 'Question de clarification', text: 'Quel résultat aimeriez-vous obtenir en priorité sur ce point ?' },
    { label: 'Suite', text: event.nextAction ? `Prochaine étape enregistrée : ${event.nextAction.text}, le ${event.nextAction.date}. Cette étape vous convient-elle ?` : 'Quelle prochaine étape vous serait utile pour préciser ce besoin ?' },
    { label: 'Signature', text: signature(profile) },
  ], now);
}
export function buildFollowupDraft(plan: ApproachPlan, report: ProspectReport, profile: ProviderProfile, event: ContactEvent, now = new Date()): ContactDraft {
  assertPlan(plan, report);
  if (event.outcome !== 'no_response') throw new Error('La relance sans réponse nécessite un contact enregistré sans réponse.');
  return draft(plan, profile, 'followup', 'Suite à mon message', [
    { label: 'Salutation', text: 'Bonjour,' },
    { label: 'Contact précédent', text: `Je reviens vers vous après ${event.channel === 'email' ? 'mon message' : 'ma tentative d’appel'} du ${event.date}.` },
    { label: 'Motif initial', text: `Le point que je souhaitais examiner avec vous : ${plan.motive}` },
    { label: 'Question principale', text: plan.question }, { label: 'Signature', text: signature(profile) },
  ], now);
}

export interface ReadinessEvaluation { ready: boolean; firstContact: boolean; decision: string; missing: string[]; legacy: boolean; stale: boolean }
export function evaluateContactReadiness(company: Company, campaign: Campaign, report: ProspectReport | null, today = new Date().toISOString().slice(0, 10)): ReadinessEvaluation {
  const missing: string[] = [], readiness = company.readiness;
  const firstContact = !company.archived && ['À étudier', 'À contacter'].includes(company.stage) && !(company.contactEvents?.length);
  if (company.oppositionActive) missing.push('Une opposition à être contacté est active.');
  if (company.archived) missing.push('Cette entreprise est archivée.');
  let stale = false, legacy = false;
  if (readiness) {
    if (!readiness.target) missing.push('Confirmer que l’entreprise correspond à la cible.');
    if (!readiness.reason) missing.push('Choisir et confirmer un motif documenté.');
    if (!readiness.channel) missing.push('Confirmer un email ou téléphone professionnel.');
    stale = readiness.targetRevision !== campaign.revision || !report || readiness.reportId !== report.id || !!company.plan?.revalidateReason;
    if (stale) missing.push('La cible, le dossier ou le motif a changé : revalider la préparation.');
    if (report) {
      try { validEvidence(report, readiness.evidenceIds); } catch { missing.push('Le motif doit renvoyer à un constat sourcé encore valable.'); }
    }
    const channel = company.contact[readiness.channelKind];
    if (!validProfessionalChannel(readiness.channelKind, channel)) missing.push('Le canal professionnel choisi est absent ou invalide.');
  } else {
    const evaluation = evaluateQualification(company, campaign, today);
    legacy = evaluation.decision === 'Prêt à contacter' && !evaluation.targetNeedsRevalidation;
    if (!legacy) missing.push('Valider la cible, un motif documenté et un canal professionnel dans la préparation.');
    if (!validProfessionalChannel('email', company.contact.email) && !validProfessionalChannel('phone', company.contact.phone)) missing.push('Email ou téléphone professionnel à trouver.');
    stale = evaluation.targetNeedsRevalidation;
  }
  const ready = !missing.length;
  return { ready, firstContact, decision: company.oppositionActive ? 'Ne plus contacter' : ready ? firstContact ? 'Prêt à contacter' : 'Suivre le contact' : stale ? 'À revalider' : 'À préparer', missing, legacy, stale };
}
export function validProfessionalChannel(kind: 'email' | 'phone', value: string): boolean {
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/[<>\r\n]/.test(value) && value.length <= 320;
  const digits = value.replace(/\D/g, '');
  return /^\+?[\d(][\d\s()./-]*$/.test(value) && digits.length >= 7 && digits.length <= 15;
}

/** These conservative checks supplement schemas; human preview remains required. */
export function validateReportNarrative(value: string, report: ProspectReport): boolean {
  return validateGroundedText(value, report);
}
function validateGroundedText(value: string, report: ProspectReport, profile?: ProviderProfile): boolean {
  const corpus = [report.companyName, ...report.facts.filter(fact => !fact.corrected).map(fact => fact.text), ...report.sources.map(source => `${source.url} ${source.excerpt} ${source.collectedAt}`), ...report.contacts.map(contact => contact.value), profile ? JSON.stringify(profile) : ''].join('\n');
  if (!value.trim() || value.length > 50000 || /\b(?:garanti[es]?|assur[ée]s?|chiffre d’affaires|perte de clients|retour sur investissement|ROI|audit gratuit|maquette gratuite)\b/i.test(value)) return false;
  if (/vous perdez|perdre des clients|augmenter (?:vos|les) ventes|doubler (?:vos|les)|attirer plus de clients|accro[iî]tre (?:vos|les) ventes/i.test(value)) return false;
  if (profile) {
    const credentialClaims = normalize(value).match(/\b(?:j['’]ai(?: deja)? (?:realise|accompagne|travaille)[^.!?\n]*|(?:mes|nos) (?:clients|references)[^.!?\n]*)/g) || [];
    if (credentialClaims.some(claim => !normalize(profile.references).includes(claim.trim()))) return false;
  }
  if (profile && !profile.terms.trim() && /(?:sous|en|d’ici) (?:\d+|deux|trois|quatre|cinq|une) (?:jours?|semaines?|heures?)/i.test(value)) return false;
  const numbers = value.match(/\d+(?:[.,]\d+)?/g) || [];
  const knownNumbers = new Set(corpus.match(/\d+(?:[.,]\d+)?/g) || []);
  if (numbers.some(number => !knownNumbers.has(number))) return false;
  // Numeric equality does not turn an HTTP status or a date into a declared price.
  const money = (text: string) => (text.match(/(?:[€$]\s*\d[\d\s.,]*|\d[\d\s.,]*\s*(?:€|\$|EUR\b|euros?\b|USD\b|dollars?\b))/gi) || [])
    .map(item => item.replace(/euros?|EUR/gi, '€').replace(/dollars?|USD/gi, '$').replace(/\s/g, '').replace(/,/g, '.'));
  const allowedMoney = new Set(money(profile ? `${profile.prices}\n${profile.terms}` : corpus));
  if (money(value).some(price => !allowedMoney.has(price))) return false;
  const links = value.match(/https?:\/\/[^\s<>"')]+/g) || [];
  if (links.some(link => !researchUrlSchema.safeParse(link).success || !corpus.includes(link.replace(/[.,;]+$/, '')))) return false;
  const emails = value.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) || [];
  if (emails.some(email => !corpus.toLowerCase().includes(email.toLowerCase()))) return false;
  return true;
}
export function validateGeneratedPreparation(plan: ApproachPlan, drafts: ContactDraft[], report: ProspectReport, profile: ProviderProfile): boolean {
  if (!approachPlanSchema.safeParse(plan).success) return false;
  try { assertPlan(plan, report); } catch { return false; }
  // Motive remains a recorded fact, not a new free-form claim from the model.
  if (!plan.evidenceIds.some(id => report.facts.find(fact => fact.id === id)?.text === plan.motive)) return false;
  if (!validateGroundedText([plan.motive, plan.rationale, plan.hypothesis, plan.help, plan.question, plan.nextStep].join('\n'), report, profile)) return false;
  return drafts.every(item => contactDraftSchema.safeParse(item).success && item.reportId === report.id && item.planId === plan.id && item.profileRevision === profile.revision
    && validateGroundedText(`${item.subject}\n${item.text}`, report, profile)
    && (item.channel !== 'email' || ((item.text.match(/\?/g) || []).length === 1 && !/\b(?:nous avons|notre échange|suite à notre conversation)\b/i.test(item.text))));
}
