import test from 'node:test';
import assert from 'node:assert/strict';
import { CRITERION_EXPECTED, EMAIL_CHECKS, EMAIL_QUESTION, EXCHANGE_QUESTION, FOLLOWUP_QUESTIONS, OCCASION_QUESTIONS, TEACHING_EMAIL, TARGET_QUESTION, emailWordCount, exerciseReady, teachingCompany, teachingExchange, teachingQualification, teachingSequence } from '../lib/learning-exercises';
import { LEARNING_MODULES, learningCampaignHref } from '../lib/learning-curriculum';

test('teaching company is rebuilt independently with no real URL, contact or identifier', () => {
  const first = teachingCompany();
  assert.ok(first.id.startsWith('learning-only-'));
  assert.match(first.contact.email, /\.example$/);
  assert.equal(first.website, '');
  first.qualification!.answers.fit.answer = 'exact';
  assert.equal(teachingCompany().qualification!.answers.fit.answer, 'unknown');
});

test('confirming a teaching observation does not accept a criterion or award points', () => {
  const { company, evaluation } = teachingQualification({ proof: 'confirmed', proposal_problem: 'one' });
  assert.equal(company.qualification!.observations.items.mobile.answer, 'yes');
  assert.equal(company.qualification!.answers.problem.answer, 'unknown');
  assert.equal(evaluation.completedCount, 0);
  assert.equal(evaluation.confirmedPoints, 0);
  assert.equal(evaluation.score, null);
});

test('explicit partial acceptance uses the real evaluator and leaves unknowns incomplete', () => {
  const { evaluation } = teachingQualification({ proof: 'confirmed', fit: 'exact', problem: 'one' });
  assert.equal(evaluation.confirmedPoints, 35);
  assert.equal(evaluation.completedCount, 2);
  assert.equal(evaluation.score, null);
  assert.equal(evaluation.priority, null);
  assert.equal(evaluation.criteria.find(criterion => criterion.key === 'trigger')!.points, null);
});

test('complete teaching qualification is 55/100 and does not inflate one defect', () => {
  const { evaluation } = teachingQualification(CRITERION_EXPECTED);
  assert.equal(evaluation.score, 55);
  assert.equal(evaluation.completedCount, 5);
  assert.equal(evaluation.priority, 'Priorité intermédiaire');
  assert.equal(evaluation.criteria.find(criterion => criterion.key === 'trigger')!.points, 0);
  const exaggerated = teachingQualification({ ...CRITERION_EXPECTED, problem: 'multiple_or_blocking' });
  assert.equal(exaggerated.evaluation.completedCount, 4);
  assert.equal(exaggerated.evaluation.score, null);
});

test('qualification completion requires both the proof and an independent human decision', () => {
  assert.equal(exerciseReady('qualification', CRITERION_EXPECTED), false);
  assert.equal(exerciseReady('qualification', { ...CRITERION_EXPECTED, proof: 'confirmed' }), false);
  for (const decision of ['keep', 'later', 'reject']) assert.equal(exerciseReady('qualification', { ...CRITERION_EXPECTED, proof: 'confirmed', decision }), true);
});

test('rechecking a proof preserves answers already explicitly accepted', () => {
  assert.equal(teachingQualification({ ...CRITERION_EXPECTED, proof: 'rejected' }).evaluation.score, 55);
});

test('practice accepts an observed defect, an incomplete control and a positive site without inventing facts', () => {
  const answers = Object.fromEntries(OCCASION_QUESTIONS.map(question => [question.key, question.correct]));
  assert.equal(exerciseReady('occasion', answers), true);
  assert.equal(exerciseReady('occasion', { ...answers, limited: 'absent' }), false);
  assert.equal(exerciseReady('cible', { target: TARGET_QUESTION.correct }), true);
  assert.equal(exerciseReady('cible', { target: 'assumption' }), false);
});

test('email completion checks length and human checklist without evaluating free text quality', () => {
  const checks = Object.fromEntries(EMAIL_CHECKS.map(check => [check.key, true]));
  const answers = { ...checks, emailChoice: EMAIL_QUESTION.correct, emailText: TEACHING_EMAIL };
  assert.equal(exerciseReady('email', answers), true);
  assert.equal(exerciseReady('email', { ...answers, evidence: false }), false);
  assert.equal(exerciseReady('email', { ...answers, emailText: 'mot '.repeat(121) }), false);
  assert.equal(exerciseReady('email', { ...answers, emailText: '' }), false);
  assert.equal(emailWordCount(' \nBonjour\n\nPickles Studio  '), 3);
});

test('copying a draft cannot start a contact sequence', () => {
  assert.equal(teachingSequence('not_sent').state, 'not_started');
  assert.deepEqual(teachingSequence('not_sent').steps, []);
});

test('actual sequence evaluator proposes J0/J+5/J+12 after the fictional contact only', () => {
  const sequence = teachingSequence('no_response');
  assert.equal(sequence.state, 'active');
  assert.deepEqual(sequence.steps.map(step => step.date), ['2026-10-05', '2026-10-10', '2026-10-17']);
  for (const outcome of ['conversation', 'not_interested', 'opposition'] as const) {
    assert.equal(teachingSequence(outcome).state, 'stopped');
    assert.equal(teachingSequence(outcome).next, null);
  }
});

test('follow-up exercise requires correct handling of copied mail, response, refusal and opposition', () => {
  const answers = Object.fromEntries(FOLLOWUP_QUESTIONS.map(question => [question.key, question.correct]));
  assert.equal(exerciseReady('suivi', answers), true);
  assert.equal(exerciseReady('suivi', { ...answers, opposition: 'otherChannel' }), false);
  assert.equal(exerciseReady('suivi', { ...answers, reply: 'sequence' }), false);
});

test('exchange evaluator accepts documented need and next step while leaving budget unknown', () => {
  const accepted = { need: true, solution: true, decision: true, nextStep: true };
  const evaluation = teachingExchange(accepted);
  assert.equal(evaluation.possible, true);
  assert.ok(evaluation.toVerify.some(item => item.includes('budget')));
  assert.equal(teachingExchange({ ...accepted, nextStep: false }).possible, false);
  const answers = { ...accepted, openQuestion: EXCHANGE_QUESTION.correct, budgetUnknown: true, reformulation: 'Améliorer la galerie. Envoyer deux pistes à lire vendredi.', reformulationReviewed: true };
  assert.equal(exerciseReady('echange', answers), true);
  assert.equal(exerciseReady('echange', { ...answers, budgetUnknown: false }), false);
});

test('all six modules apply to the appropriate existing screen with their contextual guide', () => {
  assert.equal(LEARNING_MODULES.length, 6);
  assert.equal(learningCampaignHref('cible', 'initial'), '/campagnes/initial?etape=rechercher&guide=cible');
  assert.equal(learningCampaignHref('qualification', 'initial'), '/campagnes/initial/qualification?guide=qualification');
  assert.equal(learningCampaignHref('email', 'initial'), '/campagnes/initial?etape=preparer&guide=email');
  assert.equal(learningCampaignHref('suivi', 'initial'), '/campagnes/initial?etape=suivre&guide=suivi');
  assert.equal(learningCampaignHref('echange', 'initial'), '/campagnes/initial?etape=suivre&guide=echange');
});
