import assert from 'node:assert/strict';
import test from 'node:test';
import {
  afterExchangeInputSchema, canQualifyOpportunity, captureTarget, emptyQualification,
  evaluateAfterExchange, evaluateQualification, isFirstContactCandidate, observationsSchema,
  qualificationDataSchema, qualificationInputSchema, QUALIFICATION_RULES,
  QUALIFICATION_RULESET_ID,
} from '../lib/qualification';
import { manualObservationKeys, type CriterionKey, type QualificationData, type QualificationSubject } from '../lib/qualification-types';

const today = '2026-10-03';
const target = { targetCity: 'Montpellier', targetBusiness: 'Rénovation intérieure', targetCompanyType: 'Indépendante', targetOffer: 'Diagnostic ou amélioration du site', targetExclusions: 'Franchises' };
function subject(data = emptyQualification()): QualificationSubject {
  return { qualification: data, oppositionActive: false, archived: false, stage: 'À étudier', contact: { name: 'Camille Exemple', role: 'Dirigeante', email: 'camille@example.fr', phone: '', formUrl: '', profileUrl: '' } };
}
function completeData(): QualificationData {
  const data = emptyQualification();
  data.targetSnapshot = captureTarget(target);
  data.answers.fit.answer = 'exact';
  data.answers.problem = { ...data.answers.problem, answer: 'multiple_or_blocking', description: 'Le lien de contact renvoie une erreur ; les prestations sont contradictoires.', observedOn: today, majorReason: 'multiple', distinctProblems: ['Page de contact inaccessible', 'Descriptions de prestations contradictoires'] };
  data.answers.trigger = { ...data.answers.trigger, answer: 'explicit', description: 'L’entreprise a annoncé rechercher un prestataire pour améliorer son site.', source: 'Déclaration vérifiée sur la page officielle', verifiedOn: today };
  data.answers.references = { ...data.answers.references, answer: 'multiple', examples: ['Rénovation de cuisine à Montpellier', 'Réhabilitation d’un appartement à Sète'], improvement: 'Les projets sont nommés mais leurs photos et résultats sont difficiles à trouver.' };
  data.answers.access = { ...data.answers.access, answer: 'decision_maker', channelAssociation: 'Adresse professionnelle publiée à côté du nom de la dirigeante.' };
  return data;
}
function positiveExchange(): QualificationData {
  const data = emptyQualification();
  data.afterExchange = { ...data.afterExchange, need: 'confirmed', needNote: 'L’interlocutrice veut clarifier les prestations sur son site.', solution: 'targeted_improvement', solutionNote: 'Réorganiser la page des prestations répond au besoin discuté.', solutionFit: 'confirmed', decision: 'identified', decisionNote: 'Camille Exemple décide de cette intervention.', nextStep: { description: 'Faire ensemble le point sur les pages à améliorer.', date: '', accepted: true } };
  return data;
}

test('the V1 weights total 100 and all unknown is distinct from five explicit zeros', () => {
  assert.equal(QUALIFICATION_RULESET_ID, 'pickles-v1');
  assert.equal(QUALIFICATION_RULES.id, 'pickles-v1');
  assert.equal(Object.values(QUALIFICATION_RULES.criteria).reduce((sum, criterion) => sum + criterion.maxPoints, 0), 100);
  const empty = evaluateQualification(subject(), target, today);
  assert.equal(empty.rulesetId, 'pickles-v1');
  assert.equal(empty.score, null);
  assert.equal(empty.confirmedPoints, 0);
  assert.equal(empty.completedCount, 0);
  assert.equal(empty.priority, null);
  assert.equal(empty.evaluated, false);
  assert.equal(empty.decision, 'À vérifier');
  const data = completeData();
  for (const key of Object.keys(data.answers) as CriterionKey[]) data.answers[key].answer = 'none';
  const evaluated = evaluateQualification(subject(data), target, today);
  assert.equal(evaluated.score, 0);
  assert.equal(evaluated.completedCount, 5);
  assert.equal(evaluated.priority, 'Priorité basse');
  assert.equal(evaluated.evaluated, true);
});

test('every fresh qualification and input parse owns its mutable nested defaults', () => {
  const first = emptyQualification();
  first.answers.fit.answer = 'exact';
  first.answers.fit.observationKeys.push('services');
  first.answers.problem.distinctProblems.push('Un défaut');
  first.answers.references.examples.push('Un exemple');
  first.observations.items.contact.notes = 'Une observation propre à cette fiche';
  first.afterExchange.nextStep.description = 'Une prochaine étape propre à cette fiche';
  const fresh = emptyQualification();
  assert.equal(fresh.answers.fit.answer, 'unknown');
  assert.deepEqual(fresh.answers.fit.observationKeys, []);
  assert.deepEqual(fresh.answers.problem.distinctProblems, []);
  assert.deepEqual(fresh.answers.references.examples, []);
  assert.equal(fresh.observations.items.contact.notes, '');
  assert.equal(fresh.afterExchange.nextStep.description, '');
  assert.equal(evaluateQualification(subject(fresh), target, today).evaluated, false);

  const answers = qualificationInputSchema.parse({}).answers;
  answers.fit.answer = 'exact';
  answers.access.observationKeys.push('contact');
  const otherAnswers = qualificationInputSchema.parse({}).answers;
  assert.equal(otherAnswers.fit.answer, 'unknown');
  assert.deepEqual(otherAnswers.access.observationKeys, []);
  const observations = observationsSchema.parse({});
  observations.items.mobile.notes = 'Un problème';
  assert.equal(observationsSchema.parse({}).items.mobile.notes, '');
  assert.equal(observations.items.contact.notes, '');
  const exchange = afterExchangeInputSchema.parse({});
  exchange.nextStep.accepted = true;
  assert.equal(afterExchangeInputSchema.parse({}).nextStep.accepted, false);
  const restored: QualificationData = qualificationDataSchema.parse(fresh);
  assert.equal(restored.afterExchange.qualifiedAt, '');
});

test('all 1024 answer combinations use the exact weights and operational order independently', () => {
  const criteria = QUALIFICATION_RULES.criteria;
  for (const fit of criteria.fit.options) for (const problem of criteria.problem.options) for (const trigger of criteria.trigger.options) for (const references of criteria.references.options) for (const access of criteria.access.options) {
    const data = completeData();
    data.answers.fit.answer = fit.value;
    data.answers.problem.answer = problem.value;
    data.answers.trigger.answer = trigger.value;
    data.answers.trigger.eventOn = '2026-09-20';
    data.answers.trigger.relevance = 'La nouvelle prestation nécessite une présentation plus claire.';
    data.answers.references.answer = references.value;
    data.answers.access.answer = access.value;
    const company = subject(data);
    const evaluation = evaluateQualification(company, target, today);
    const options = [fit, problem, trigger, references, access];
    const count = options.filter(option => option.points !== null).length;
    const points = options.reduce((sum, option) => sum + (option.points ?? 0), 0);
    assert.equal(evaluation.completedCount, count);
    assert.equal(evaluation.confirmedPoints, points);
    assert.equal(evaluation.score, count === 5 ? points : null);
    assert.equal(evaluation.priority, count < 5 ? null : points >= 70 ? 'Priorité haute' : points >= 50 ? 'Priorité intermédiaire' : 'Priorité basse');
    const expected = fit.value === 'none' ? 'Hors cible' : fit.value === 'partial' ? 'Cible à confirmer' : problem.value === 'none' ? 'Besoin non établi' : access.value === 'none' ? 'Contact à trouver' : count < 5 ? 'À vérifier' : 'Prêt à contacter';
    assert.equal(evaluation.decision, expected);
    assert.equal(evaluateQualification({ ...company, oppositionActive: true }, target, today).decision, 'Ne plus contacter');
    assert.equal(company.stage, 'À étudier');
  }
});

test('incomplete scoring confirms 65 points across four criteria without renormalization', () => {
  const data = completeData();
  data.answers.trigger.answer = 'recent_change';
  data.answers.trigger.eventOn = '2026-09-20';
  data.answers.trigger.relevance = 'La nouvelle zone doit être présentée sur le site.';
  data.answers.references.answer = 'one';
  data.answers.access.answer = 'unknown';
  const evaluated = evaluateQualification(subject(data), target, today);
  assert.equal(evaluated.confirmedPoints, 65);
  assert.equal(evaluated.completedCount, 4);
  assert.equal(evaluated.score, null);
  assert.equal(evaluated.priority, null);
  assert.deepEqual(evaluated.missingCriteria, ['access']);
});

test('85 points cannot hide a missing contact, while a ready 40-point prospect has no invented cutoff', () => {
  const high = completeData();
  high.answers.access.answer = 'none';
  assert.equal(evaluateQualification(subject(high), target, today).score, 85);
  assert.equal(evaluateQualification(subject(high), target, today).decision, 'Contact à trouver');
  const low = completeData();
  low.answers.problem.answer = 'one';
  low.answers.trigger.answer = 'none';
  low.answers.references.answer = 'none';
  low.answers.access.answer = 'generic';
  const evaluated = evaluateQualification(subject(low), target, today);
  assert.equal(evaluated.score, 40);
  assert.equal(evaluated.priority, 'Priorité basse');
  assert.equal(evaluated.decision, 'Prêt à contacter');
  assert.equal(isFirstContactCandidate(subject(low), target, today), true);
});

test('positive drafts persist without evidence but award no points until complete', () => {
  const draft = qualificationInputSchema.parse({ answers: { problem: { answer: 'one' }, references: { answer: 'multiple' }, access: { answer: 'decision_maker' } } });
  const data = emptyQualification();
  data.answers = draft.answers;
  const evaluated = evaluateQualification(subject(data), target, today);
  assert.equal(evaluated.confirmedPoints, 0);
  assert.equal(evaluated.criteria.find(criterion => criterion.key === 'problem')!.points, null);
  assert.ok(evaluated.criteria.find(criterion => criterion.key === 'problem')!.missing.some(message => message.includes('date')));
  assert.ok(evaluated.criteria.find(criterion => criterion.key === 'references')!.missing.some(message => message.includes('deux')));
  assert.ok(evaluated.criteria.find(criterion => criterion.key === 'access')!.missing.some(message => message.includes('lien')));
  assert.equal(qualificationDataSchema.safeParse(data).success, true);
});

test('30 problem points require two distinct entries or an explicit explanation of an important block', () => {
  const data = completeData();
  data.answers.problem.distinctProblems = ['Même défaut', '  même   défaut  '];
  assert.equal(evaluateQualification(subject(data), target, today).criteria[1].points, null);
  data.answers.problem.majorReason = 'unknown';
  assert.equal(evaluateQualification(subject(data), target, today).criteria[1].points, null);
  data.answers.problem.majorReason = 'blocking';
  assert.equal(evaluateQualification(subject(data), target, today).criteria[1].points, null);
  data.answers.problem.blockingExplanation = 'Le visiteur ne peut ouvrir aucune page de contact.';
  assert.equal(evaluateQualification(subject(data), target, today).criteria[1].points, 30);
  data.answers.problem.description = '';
  assert.equal(evaluateQualification(subject(data), target, today).criteria[1].points, null);
  data.answers.problem.description = 'Le lien de contact ne fonctionne pas.';
  data.answers.problem.observedOn = '2026-10-04';
  assert.equal(evaluateQualification(subject(data), target, today).criteria[1].points, null);
});

test('references identify concrete distinct examples and what can be better presented', () => {
  const data = completeData();
  data.answers.references.examples = ['Cuisine', ' cuisine '];
  assert.equal(evaluateQualification(subject(data), target, today).criteria[3].points, null);
  data.answers.references.answer = 'one';
  assert.equal(evaluateQualification(subject(data), target, today).criteria[3].points, 5);
  data.answers.references.improvement = '';
  assert.equal(evaluateQualification(subject(data), target, today).criteria[3].points, null);
});

test('access is re-evaluated when the last channel or decision-maker identity is removed', () => {
  const company = subject(completeData());
  company.contact.email = '';
  assert.equal(evaluateQualification(company, target, today).criteria[4].points, null);
  company.contact.formUrl = 'https://example.fr/contact';
  assert.equal(evaluateQualification(company, target, today).criteria[4].points, 15);
  company.contact.name = '';
  assert.equal(evaluateQualification(company, target, today).criteria[4].points, null);
  assert.equal(company.qualification!.answers.access.answer, 'decision_maker');
  company.contact.name = 'Camille Exemple';
  company.contact.role = '';
  assert.equal(evaluateQualification(company, target, today).criteria[4].points, null);
  company.qualification!.answers.access.answer = 'generic';
  assert.equal(evaluateQualification(company, target, today).criteria[4].points, 5);
});

test('a target change preserves the historical score but requires explicit revalidation for recommendations', () => {
  const company = subject(completeData());
  assert.equal(evaluateQualification(company, target, today).score, 100);
  const changed = { ...target, targetOffer: 'Refonte complète' };
  const evaluated = evaluateQualification(company, changed, today);
  assert.equal(evaluated.score, 100);
  assert.equal(evaluated.targetNeedsRevalidation, true);
  assert.equal(evaluated.decision, 'À vérifier');
  assert.equal(evaluated.nextInformation, 'Revalider l’adéquation à la cible actuelle.');
  assert.equal(isFirstContactCandidate(company, changed, today), false);
  assert.equal(company.qualification!.answers.fit.answer, 'exact');
  company.qualification!.targetSnapshot = null;
  assert.equal(evaluateQualification(company, target, today).criteria[0].points, null);
  company.qualification!.targetSnapshot = captureTarget(changed);
  assert.equal(evaluateQualification(company, changed, today).decision, 'Prêt à contacter');
});

test('a recent event requires explicit separate dates and the inclusive 90-day convention', () => {
  const data = completeData();
  data.answers.trigger.answer = 'recent_change';
  data.answers.trigger.relevance = 'La nouvelle prestation doit être expliquée sur le site.';
  data.answers.trigger.eventOn = '2026-07-05';
  assert.equal(evaluateQualification(subject(data), target, today).criteria[2].points, 10);
  data.answers.trigger.eventOn = '2026-07-04';
  assert.equal(evaluateQualification(subject(data), target, today).criteria[2].points, null);
  data.answers.trigger.eventOn = '2026-10-04';
  assert.equal(evaluateQualification(subject(data), target, today).criteria[2].points, null);
  data.answers.trigger.eventOn = '';
  assert.equal(evaluateQualification(subject(data), target, today).criteria[2].points, null);
  data.answers.trigger.eventOn = '2026-09-20';
  data.answers.trigger.verifiedOn = '2026-09-21';
  const later = evaluateQualification(subject(data), target, '2027-02-01');
  assert.equal(later.criteria[2].points, 10);
  assert.equal(later.triggerNeedsReverification, true);
  assert.equal(data.answers.trigger.verifiedOn, '2026-09-21');
  assert.equal(data.answers.trigger.eventOn, '2026-09-20');
  assert.throws(() => evaluateQualification(subject(data), target, ''), /date/);
});

test('manual observations, linked notes and AI measurements never add score points', () => {
  const data = emptyQualification();
  for (const key of manualObservationKeys) data.observations.items[key] = { answer: 'yes', notes: `Note réelle ${key}`, sourceUrl: 'https://example.fr/preuve', observedOn: today };
  data.observations.googleReviewCount = 1200;
  data.observations.googleRating = 4.9;
  data.observations.companySize = 'Une personne';
  data.answers.problem.observationKeys = ['mainAction', 'contact'];
  const company = { ...subject(data), aiTests: [{ recommendations: 0, validResponses: 10 }] };
  const evaluation = evaluateQualification(company, target, today);
  assert.equal(evaluation.confirmedPoints, 0);
  assert.equal(evaluation.score, null);
  assert.equal(evaluation.reasons.length, 0);
  assert.equal(evaluation.criteria[1].linkedObservations[0].observation.notes, 'Note réelle mainAction');
  assert.equal(evaluation.criteria[1].linkedObservations[1].observation.sourceUrl, 'https://example.fr/preuve');
  data.answers.problem.answer = 'multiple_or_blocking';
  assert.equal(evaluateQualification(company, target, today).criteria[1].points, null);
});

test('nine observation drafts distinguish applicability, visual impression, event dates and unknown Google counts', () => {
  const data = observationsSchema.parse({ items: { siteAge: { answer: 'yes', notes: 'Impression visuelle uniquement.' }, mobile: { answer: 'unknown' }, contact: { answer: 'not_applicable' } }, siteAgeBasis: 'visual_impression', recentEventOn: '2026-09-15' });
  assert.equal(data.siteDate, '');
  assert.equal(data.googleReviewCount, null);
  assert.equal(data.googleRating, null);
  assert.equal(data.items.recentActivity.observedOn, '');
  assert.equal(data.recentEventOn, '2026-09-15');
  assert.equal(Object.keys(data.items).length, 9);
  assert.equal(data.items.mainAction.answer, 'unknown');
  for (const count of [-1, 1.5, '12', Number.MAX_SAFE_INTEGER + 1]) assert.equal(observationsSchema.safeParse({ googleReviewCount: count }).success, false);
  for (const rating of [-0.1, 5.1, '4.5']) assert.equal(observationsSchema.safeParse({ googleRating: rating }).success, false);
  assert.equal(observationsSchema.safeParse({ googleReviewCount: 0, googleRating: 0 }).success, true);
});

test('structure errors reject forged scores, unexpected fields, invalid dates, URLs and duplicate links', () => {
  for (const input of [
    { score: 100 }, { answers: { problem: { points: 30 } } }, { answers: { fit: { answer: 20 } } },
    { answers: { problem: { proofUrl: 'javascript:alert(1)' } } },
    { answers: { trigger: { eventOn: '2026-02-30' } } },
    { answers: { problem: { observationKeys: ['contact', 'contact'] } } },
  ]) assert.equal(qualificationInputSchema.safeParse(input).success, false);
  assert.equal(observationsSchema.safeParse({ items: { contact: { sourceUrl: 'file:///tmp/proof' } } }).success, false);
  assert.equal(afterExchangeInputSchema.safeParse({ qualifiedAt: '2026-10-03T10:00:00.000Z' }).success, false);
  assert.equal(afterExchangeInputSchema.safeParse({ nextStep: { accepted: 'yes' } }).success, false);
  const complete = emptyQualification();
  assert.equal(qualificationDataSchema.safeParse(complete).success, true);
  const omitted = structuredClone(complete) as any;
  delete omitted.answers.problem.observedOn;
  assert.equal(qualificationDataSchema.safeParse(omitted).success, false);
  assert.equal(qualificationDataSchema.safeParse({ ...complete, version: 2 }).success, false);
});

test('closed, archived and previously contacted stages never re-enter first-contact suggestions', () => {
  const company = subject(completeData());
  assert.equal(isFirstContactCandidate(company, target, today), true);
  for (const stage of ['En échange', 'Proposition envoyée', 'Opportunité qualifiée', 'Gagné', 'Perdu']) {
    assert.equal(isFirstContactCandidate({ ...company, stage }, target, today), false);
    assert.equal(evaluateQualification({ ...company, stage }, target, today).score, 100);
  }
  assert.equal(isFirstContactCandidate({ ...company, archived: true }, target, today), false);
  assert.equal(isFirstContactCandidate({ ...company, oppositionActive: true }, target, today), false);
});

test('an agreed relevant opportunity can be qualified with an unknown budget or technical access', () => {
  const company = subject(positiveExchange());
  const evaluated = evaluateAfterExchange(company);
  assert.equal(evaluated.possible, true);
  assert.equal(evaluated.qualificationPossible, true);
  assert.equal(evaluated.label, 'Qualification possible');
  assert.equal(evaluated.toVerify.some(message => message.includes('budget')), true);
  assert.equal(evaluated.toVerify.some(message => message.includes('capacité')), true);
  assert.equal(canQualifyOpportunity(company), true);
  assert.equal(company.stage, 'À étudier');
  assert.equal(evaluateQualification(company, target, today).score, null);
});

test('a meeting alone is insufficient and accepted next step is separate from an internal task', () => {
  const data = emptyQualification();
  data.afterExchange.nextStep = { description: 'Rendez-vous réservé.', date: today, accepted: true };
  assert.equal(evaluateAfterExchange(subject(data)).possible, false);
  const valid = positiveExchange();
  valid.afterExchange.nextStep.accepted = false;
  assert.equal(evaluateAfterExchange(subject(valid)).possible, false);
  valid.afterExchange.nextStep.accepted = true;
  valid.afterExchange.nextStep.description = '';
  assert.equal(evaluateAfterExchange(subject(valid)).possible, false);
  valid.afterExchange.nextStep.description = 'Point convenu';
  valid.afterExchange.needNote = '';
  assert.equal(evaluateAfterExchange(subject(valid)).possible, false);
});

test('opposition, unsuitable solution, confirmed incompatible budget or explicit blocking obstacle prevent qualification', () => {
  assert.equal(evaluateAfterExchange({ ...subject(positiveExchange()), oppositionActive: true }).possible, false);
  for (const patch of [
    { need: 'not_recognized' as const }, { solutionFit: 'not_adapted' as const },
    { budget: 'incompatible' as const }, { ability: 'obstacle' as const, obstacleBlocking: true },
  ]) {
    const data = positiveExchange();
    data.afterExchange = { ...data.afterExchange, ...patch, qualifiedAt: '2026-10-02T10:00:00.000Z' };
    const evaluated = evaluateAfterExchange(subject(data));
    assert.equal(evaluated.possible, false);
    assert.equal(evaluated.blockers.length > 0, true);
    assert.equal(evaluated.reevaluationRequired, true);
    assert.equal(data.afterExchange.qualifiedAt, '2026-10-02T10:00:00.000Z');
  }
  const later = positiveExchange();
  later.afterExchange.timing = 'later';
  later.afterExchange.ability = 'obstacle';
  later.afterExchange.abilityNote = 'Accès technique à clarifier, pas de blocage confirmé.';
  assert.equal(evaluateAfterExchange(subject(later)).label, 'À revoir plus tard');
  assert.equal(evaluateAfterExchange(subject(later)).possible, true);
});

test('a restored qualified stage requires re-evaluation when its conditions are missing even without a historical timestamp', () => {
  const company = { ...subject(), stage: 'Opportunité qualifiée' };
  assert.equal(company.qualification!.afterExchange.qualifiedAt, '');
  const restored = evaluateAfterExchange(company);
  assert.equal(restored.possible, false);
  assert.equal(restored.reevaluationRequired, true);
  assert.equal(company.stage, 'Opportunité qualifiée');
  assert.equal(company.qualification!.afterExchange.qualifiedAt, '');
  assert.equal(evaluateAfterExchange({ ...company, qualification: positiveExchange() }).reevaluationRequired, false);
});
