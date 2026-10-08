/** Pure teaching fixtures. No repository, provider or commercial action imports. */
import { captureTarget, emptyQualification, evaluateAfterExchange, evaluateQualification } from './qualification';
import { suggestedContactSequence } from './contact-sequence';
import type { CriterionKey } from './qualification-types';
import type { LearningModuleId } from './learning-types';
import type { Company, Settings } from './types';

export type ExerciseAnswers = Record<string, unknown>;
export const TEACHING_DATE = '2026-10-05';
export const TEACHING_TARGET: Settings = { targetCity: 'Montpellier', targetBusiness: 'Rénovation', targetCompanyType: 'Entreprise locale', targetOffer: 'Pickles Studio : sites, refontes, améliorations UX/UI et applications', targetExclusions: '' };
export const TEACHING_EMAIL = 'Bonjour,\n\nJe suis Rayan, de Pickles Studio. Sur votre page Réalisations, j’ai remarqué que le bouton masque une photo avant/après sur mobile.\n\nJe peux vous partager deux pistes pour rendre cette galerie plus lisible, tout en conservant votre site actuel.\n\nEst-ce vous qui vous occupez du site ?\n\nBonne journée,\nRayan — Pickles Studio';

export interface TeachingChoice { value: string; label: string; explanation: string }
export interface TeachingQuestion { key: string; title: string; context?: string; choices: TeachingChoice[]; correct: string }
export const TARGET_QUESTION: TeachingQuestion = {
  key: 'target', title: 'Quelle cible vous donne une recherche exploitable ?',
  choices: [
    { value: 'all', label: 'Toutes les entreprises qui ont besoin d’un meilleur site', explanation: 'La recherche est trop large et le besoin est présumé. Ajoutez une activité, une zone et un point à vérifier.' },
    { value: 'precise', label: 'Les entreprises de rénovation à Montpellier, pour vérifier la présentation de leurs réalisations sur mobile', explanation: 'Vous savez qui chercher, où, et quoi vérifier. Le défaut reste une hypothèse, à confirmer pour chaque entreprise.' },
    { value: 'assumption', label: 'Les petites entreprises de Montpellier, car elles n’ont sûrement pas de budget ni de bon site', explanation: 'La taille ne permet pas de déduire le budget ou la qualité du site. Choisissez une activité et une aide possible sans présumer leur situation.' },
  ], correct: 'precise',
};

export const OCCASION_QUESTIONS: TeachingQuestion[] = [
  {
    key: 'defect', title: 'Atelier Sillage : que pouvez-vous confirmer ?', context: 'Capture pédagogique · page Réalisations · mobile 390 px · 5 octobre 2026. Le bouton « Contact » recouvre le bas d’une photo avant/après.',
    choices: [
      { value: 'observed', label: 'Constat : le bouton masque une photo sur mobile', explanation: 'La capture documente ce défaut précis, dans ce contexte. Vous pouvez confirmer le constat ; cela ne valide pas encore les points.' },
      { value: 'loss', label: 'Mesure : ce défaut lui fait perdre 30 % de clients', explanation: 'Aucune donnée ne permet de mesurer des clients perdus. Confirmez uniquement ce qui est visible dans la preuve.' },
      { value: 'old', label: 'Fait : le site n’a pas été modifié depuis dix ans', explanation: 'Une capture ne donne pas la date de création ou de mise à jour du site. Une impression visuelle doit rester une appréciation argumentée.' },
    ], correct: 'observed',
  },
  {
    key: 'limited', title: 'Studio Lichen : comment traiter une présence limitée ?', context: 'Source pédagogique : une fiche annuaire a été trouvée. L’outil n’a pas pu ouvrir le site indiqué ; le constat est indisponible.',
    choices: [
      { value: 'absent', label: 'Confirmer que l’entreprise n’a pas de site', explanation: 'Le constat n’a pas pu être établi. Une page non accessible par l’outil ne démontre pas une absence de site.' },
      { value: 'incomplete', label: 'Conserver « Site à vérifier · constat incomplet »', explanation: 'Vous conservez l’information disponible et son incertitude. La prochaine action est une vérification, pas une vente de site présumée nécessaire.' },
      { value: 'inactive', label: 'Conclure que l’entreprise est inactive', explanation: 'Une présence limitée ne prouve pas une inactivité. Il faudrait une information datée et fiable pour l’affirmer.' },
    ], correct: 'incomplete',
  },
  {
    key: 'satisfactory', title: 'Maison Orme : que faire d’un site satisfaisant ?', context: 'Preuve pédagogique : à 390 px, les services et les réalisations sont lisibles ; un contact professionnel est visible. Aucun défaut concret n’a été établi dans les constats réalisés.',
    choices: [
      { value: 'force', label: 'Proposer une refonte parce que Pickles en réalise', explanation: 'Votre offre ne prouve pas leur besoin. Gardez le point positif et évitez d’inventer un défaut pour justifier le contact.' },
      { value: 'positive', label: 'Garder le point positif et ne pas inventer de problème', explanation: 'Vous pouvez reconnaître ce qui fonctionne. L’absence de problème établi peut conduire à écarter ou reporter l’entreprise, sans juger toute sa présence.' },
      { value: 'zero', label: 'Mettre tous les critères à zéro', explanation: 'Un site satisfaisant n’annule pas les autres critères. Chaque réponse doit être renseignée à partir de sa propre vérification.' },
    ], correct: 'positive',
  },
];

export const EMAIL_QUESTION: TeachingQuestion = {
  key: 'emailChoice', title: 'Quel message ouvre une conversation utile ?',
  choices: [
    { value: 'generic', label: 'Nous créons des sites exceptionnels. Profitez de notre offre et réservez une démonstration.', explanation: 'Le message ne montre pas pourquoi vous contactez cette entreprise. Commencez par un constat confirmé qui lui est propre.' },
    { value: 'useful', label: 'Sur votre galerie mobile, un bouton masque une photo. Puis-je vous partager deux pistes pour la rendre plus lisible ?', explanation: 'Le constat est précis, l’aide proportionnée et la question simple. Ajoutez une courte présentation et relisez la source avant l’envoi.' },
    { value: 'pressure', label: 'Votre site vous fait perdre des clients. Il faut absolument tout refaire au plus vite.', explanation: 'Vous n’avez pas de preuve de clients perdus ni de besoin de refonte. Retirez ces affirmations et proposez une aide ciblée.' },
  ], correct: 'useful',
};

export const FOLLOWUP_QUESTIONS: TeachingQuestion[] = [
  { key: 'copied', title: 'Vous venez de copier l’email. Que devez-vous enregistrer ?', context: 'Le texte est dans votre presse-papiers. Vous ne l’avez pas encore envoyé.', correct: 'nothing', choices: [
    { value: 'sent', label: 'Un email envoyé à J0', explanation: 'Copier ne signifie pas envoyer. Le journal doit décrire un contact réellement effectué.' },
    { value: 'nothing', label: 'Aucun contact pour le moment', explanation: 'Vous enregistrez le contact seulement après l’envoi manuel, avec sa vraie date et son résultat.' },
  ] },
  { key: 'noReply', title: 'L’email est envoyé et vous n’avez aucune réponse.', context: 'Premier contact pédagogique enregistré le 5 octobre 2026.', correct: 'review', choices: [
    { value: 'review', label: 'Enregistrer l’envoi et vérifier les suggestions du 10 et du 17 octobre', explanation: 'La séquence est J0/J+5/J+12. Vérifiez les réponses avant chaque relance ; les dates sont des suggestions que vous pouvez adapter.' },
    { value: 'daily', label: 'Renvoyer le même email chaque jour', explanation: 'Une absence de réponse ne vaut pas accord. Prévoyez une suite mesurée et utile, puis arrêtez après la dernière relance.' },
  ] },
  { key: 'refusal', title: 'La réponse est : « Merci, ce n’est pas une priorité. »', correct: 'stop', choices: [
    { value: 'continue', label: 'Garder la relance J+5 pour convaincre', explanation: 'Le refus interrompt la séquence. Respectez la réponse ; ne présumez pas une date de reprise.' },
    { value: 'stop', label: 'Enregistrer le refus et interrompre la séquence', explanation: 'La séquence s’arrête. Une reprise éventuelle ne se prévoit que sur la base d’une suite acceptée.' },
  ] },
  { key: 'opposition', title: 'La réponse est : « Ne me contactez plus. »', correct: 'oppose', choices: [
    { value: 'oppose', label: 'Enregistrer l’opposition, arrêter le suivi et ne plus contacter', explanation: 'L’opposition est une instruction explicite. Elle bloque la poursuite des contacts et des relances.' },
    { value: 'otherChannel', label: 'Essayer le téléphone à la place de l’email', explanation: 'Changer de canal ne contourne pas une opposition. Enregistrez-la et arrêtez les contacts.' },
  ] },
  { key: 'reply', title: 'La réponse est : « Oui, envoyez-moi vos deux pistes. »', correct: 'agreed', choices: [
    { value: 'agreed', label: 'Enregistrer la réponse, arrêter la séquence et noter la suite acceptée', explanation: 'Une réponse lance un échange. La suite consiste ici à partager les deux pistes, pas à envoyer une relance de premier contact.' },
    { value: 'sequence', label: 'Envoyer aussi la relance J+5', explanation: 'La séquence de premier contact s’arrête après une réponse. Choisissez la suite dans le contexte de l’échange.' },
  ] },
];

export const EXCHANGE_QUESTION: TeachingQuestion = {
  key: 'openQuestion', title: 'Quelle question vous aide à comprendre le besoin ?', correct: 'open', choices: [
    { value: 'leading', label: 'Vous voulez bien refaire tout le site, n’est-ce pas ?', explanation: 'Cette question suggère la réponse et présume la solution. Invitez l’interlocuteur à expliquer ce qui lui pose problème.' },
    { value: 'open', label: 'Comment vos clients utilisent-ils la galerie, et qu’est-ce qui leur pose problème ?', explanation: 'La question est ouverte et liée au constat. Écoutez les usages avant de proposer une intervention.' },
    { value: 'closing', label: 'Quel budget pouvez-vous signer aujourd’hui ?', explanation: 'Le besoin n’est pas encore clarifié. Comprenez d’abord le problème et le chemin de décision.' },
  ],
};

export const CRITERION_NAMES: Record<CriterionKey, string> = { fit: 'Adéquation à la cible', problem: 'Problème concret', trigger: 'Déclencheur pertinent', references: 'Réalisations à valoriser', access: 'Bon interlocuteur' };
export const CRITERION_ORDER: CriterionKey[] = ['fit', 'problem', 'trigger', 'references', 'access'];
export const CRITERION_EXPECTED: Record<CriterionKey, string> = { fit: 'exact', problem: 'one', trigger: 'none', references: 'multiple', access: 'generic' };
export const CRITERION_EVIDENCE: Record<CriterionKey, string> = {
  fit: 'Atelier Sillage est une entreprise de rénovation située à Montpellier : activité et zone correspondent à la cible de cette simulation.',
  problem: 'Sur la page Réalisations à 390 px, le bouton Contact masque une photo avant/après. Un seul défaut est documenté. Source : capture pédagogique du 5 octobre 2026.',
  trigger: 'Dans ce dossier fictif, la recherche de déclencheurs a été effectuée : aucun besoin exprimé ni changement récent pertinent n’a été trouvé. Cela ne signifie pas que l’entreprise n’a aucun besoin.',
  references: 'Deux réalisations sont documentées : une cuisine et une salle de bain. Elles pourraient être mieux regroupées et présentées dans une galerie lisible. Source : page Réalisations pédagogique.',
  access: 'Une adresse générique contact@atelier-sillage.example est indiquée dans le dossier fictif. Aucun décideur n’est identifié. Cette adresse de démonstration ne doit pas être contactée.',
};

export function teachingCompany(): Company {
  return { id: 'learning-only-sillage', name: 'Atelier Sillage · fictif', website: '', city: 'Montpellier', business: 'Rénovation', targetFit: 'unknown', problemFound: 'unknown', contactAvailable: 'unknown', observation: '', proofUrl: '', observedOn: '', trigger: '', stage: 'À étudier', archived: false, oppositionActive: false, oppositionDate: '', oppositionNote: '', contact: { name: '', role: '', email: 'contact@atelier-sillage.example', phone: '', formUrl: '', profileUrl: '' }, nextAction: null, createdAt: `${TEACHING_DATE}T12:00:00Z`, updatedAt: `${TEACHING_DATE}T12:00:00Z`, qualification: emptyQualification(), contactEvents: [] };
}

export function teachingQualification(answers: ExerciseAnswers) {
  const company = teachingCompany();
  const q = company.qualification!;
  if (answers.proof === 'confirmed') q.observations.items.mobile = { answer: 'yes', notes: CRITERION_EVIDENCE.problem, sourceUrl: '', observedOn: TEACHING_DATE };
  for (const key of CRITERION_ORDER) {
    const value = answers[key];
    // Only explicit criterion acceptance changes the score. A proposed choice or proof does not.
    if (value !== CRITERION_EXPECTED[key]) continue;
    if (key === 'fit') { q.answers.fit = { answer: 'exact', note: CRITERION_EVIDENCE.fit, observationKeys: [] }; q.targetSnapshot = captureTarget(TEACHING_TARGET); }
    if (key === 'problem') q.answers.problem = { ...q.answers.problem, answer: 'one', description: CRITERION_EVIDENCE.problem, observedOn: TEACHING_DATE, observationKeys: answers.proof === 'confirmed' ? ['mobile'] : [] };
    if (key === 'trigger') q.answers.trigger = { ...q.answers.trigger, answer: 'none' };
    if (key === 'references') q.answers.references = { ...q.answers.references, answer: 'multiple', examples: ['Rénovation d’une cuisine · cas pédagogique', 'Rénovation d’une salle de bain · cas pédagogique'], improvement: 'Regrouper et mieux présenter les réalisations dans une galerie lisible.' };
    if (key === 'access') q.answers.access = { ...q.answers.access, answer: 'generic', channelAssociation: 'Adresse générique dans le dossier pédagogique.' };
  }
  return { company, evaluation: evaluateQualification(company, TEACHING_TARGET, TEACHING_DATE) };
}

export function teachingSequence(outcome: 'not_sent' | 'no_response' | 'conversation' | 'not_interested' | 'opposition') {
  const company = teachingCompany();
  if (outcome !== 'not_sent') company.contactEvents = [{ id: 'learning-only-contact', submittedKey: 'learning-only', date: TEACHING_DATE, channel: 'email', outcome, note: 'Contact simulé. Aucun envoi.', nextAction: null }];
  company.oppositionActive = outcome === 'opposition';
  return suggestedContactSequence(company);
}

export function teachingExchange(answers: ExerciseAnswers) {
  const company = teachingCompany();
  const e = company.qualification!.afterExchange;
  if (answers.need === true) { e.need = 'confirmed'; e.needNote = 'Les clients disent que la galerie est difficile à lire sur téléphone.'; }
  if (answers.solution === true) { e.solution = 'targeted_improvement'; e.solutionFit = 'confirmed'; e.solutionNote = 'Deux pistes pour améliorer la lecture de la galerie, conformément à la demande.'; }
  if (answers.decision === true) { e.decision = 'identified'; e.decisionNote = 'L’interlocutrice dit gérer le site.'; }
  if (answers.nextStep === true) e.nextStep = { description: 'Envoyer deux pistes, à lire vendredi.', accepted: true, date: '' };
  return evaluateAfterExchange(company);
}

export function emailWordCount(text: string) { return text.trim() ? text.trim().split(/\s+/u).length : 0; }
export const EMAIL_CHECKS = [
  { key: 'introduces', label: 'Je me présente et j’indique Pickles Studio.' },
  { key: 'evidence', label: 'Le constat est précis, confirmé et traçable.' },
  { key: 'help', label: 'L’aide proposée reste proportionnée au constat.' },
  { key: 'question', label: 'La question finale est simple à traiter.' },
  { key: 'claims', label: 'Je ne promets aucun résultat et n’invente aucune perte de clients.' },
] as const;

export function questionFeedback(question: TeachingQuestion, answer: unknown) {
  const choice = question.choices.find(choice => choice.value === answer);
  return choice ? { correct: answer === question.correct, text: choice.explanation } : null;
}

export function exerciseReady(moduleId: LearningModuleId, answers: ExerciseAnswers): boolean {
  if (moduleId === 'cible') return answers.target === TARGET_QUESTION.correct;
  if (moduleId === 'occasion') return OCCASION_QUESTIONS.every(question => answers[question.key] === question.correct);
  if (moduleId === 'qualification') return answers.proof === 'confirmed' && teachingQualification(answers).evaluation.complete && ['keep', 'later', 'reject'].includes(String(answers.decision || ''));
  if (moduleId === 'email') return answers.emailChoice === EMAIL_QUESTION.correct && typeof answers.emailText === 'string' && emailWordCount(answers.emailText) > 0 && emailWordCount(answers.emailText) <= 120 && EMAIL_CHECKS.every(check => answers[check.key] === true);
  if (moduleId === 'suivi') return FOLLOWUP_QUESTIONS.every(question => answers[question.key] === question.correct);
  return answers.openQuestion === EXCHANGE_QUESTION.correct && teachingExchange(answers).possible && answers.budgetUnknown === true && typeof answers.reformulation === 'string' && answers.reformulation.trim().length > 0 && answers.reformulationReviewed === true;
}
