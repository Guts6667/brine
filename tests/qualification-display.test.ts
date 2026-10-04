import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { QualificationScore, QualificationSummary, ScoreCell } from '../components/qualification-summary';
import { captureTarget, emptyQualification, evaluateQualification } from '../lib/qualification';
import { restoreQualificationAnswers } from '../components/qualification-draft';
import type { Company, Settings } from '../lib/types';

const today = '2026-10-05';
const settings: Settings = { targetCity: 'Montpellier', targetBusiness: 'Rénovation', targetOffer: 'Sites et refontes' };
function company(): Company {
  const qualification = emptyQualification();
  qualification.targetSnapshot = captureTarget(settings);
  qualification.answers.fit.answer = 'exact';
  qualification.answers.problem = { ...qualification.answers.problem, answer: 'multiple_or_blocking', description: 'Deux défauts vérifiés.', observedOn: today, majorReason: 'multiple', distinctProblems: ['Photos masquées par un bouton', 'Page de contact inaccessible'] };
  qualification.answers.trigger.answer = 'none';
  qualification.answers.references = { ...qualification.answers.references, answer: 'multiple', examples: ['Cuisine', 'Appartement'], improvement: 'Clarifier les photos avant et après.' };
  qualification.answers.access.answer = 'generic';
  return { id: 'qualification-display-fixture', name: 'Entreprise fictive', city: 'Montpellier', business: 'Rénovation', website: '', targetFit: 'unknown', problemFound: 'unknown', contactAvailable: 'unknown', observation: '', proofUrl: '', observedOn: '', trigger: '', stage: 'À contacter', archived: false, oppositionActive: false, oppositionDate: '', oppositionNote: '', contact: { name: '', role: '', email: 'demo@example.test', phone: '', formUrl: '', profileUrl: '' }, nextAction: null, createdAt: today, updatedAt: today, qualification, readiness: { target: true, reason: true, channel: true, evidenceIds: ['confirmed-finding'], channelKind: 'email', confirmedAt: today + 'T10:00:00Z', targetRevision: 1, reportId: 'fixture-report' } };
}
function visibleText(markup: string) {
  const visit = (node: DefaultTreeAdapterTypes.Node): string => node.nodeName === '#text' ? (node as DefaultTreeAdapterTypes.TextNode).value : ('childNodes' in node ? node.childNodes.map(visit).join('') : '');
  return visit(parseFragment(markup));
}

test('contact readiness supplements the qualification score in the list instead of hiding it', () => {
  const subject = company();
  const text = visibleText(renderToStaticMarkup(createElement(ScoreCell, { company: subject, settings, today, contactDecision: 'Prêt à contacter' })));
  assert.match(text, /70\/100/);
  assert.match(text, /Priorité haute/);
  assert.match(text, /5\/5 critères validés/);
  assert.match(text, /Contact : Prêt à contacter/);
});

test('the preparation view retains its complete score and direct access to all five criteria', () => {
  const subject = company(), before = structuredClone(subject);
  const markup = renderToStaticMarkup(createElement(QualificationSummary, { company: subject, settings, today, contactDecision: 'Prêt à contacter' }));
  assert.match(visibleText(markup), /70\/100/);
  for (const criterion of ['fit', 'problem', 'trigger', 'references', 'access']) assert.ok(markup.includes(`href="#qualification-criterion-${criterion}"`));
  assert.deepEqual(subject, before);
});

test('partial qualification shows confirmed points on 100 without a final priority or zero for unknown criteria', () => {
  const subject = company();
  subject.qualification = emptyQualification();
  subject.qualification.targetSnapshot = captureTarget(settings);
  subject.qualification.answers.fit.answer = 'exact';
  const evaluation = evaluateQualification(subject, settings, today);
  const text = visibleText(renderToStaticMarkup(createElement(QualificationScore, { evaluation })));
  assert.equal(evaluation.score, null);
  assert.match(text, /20\/100/);
  assert.match(text, /Qualification en cours · 1\/5 critères validés/);
  assert.doesNotMatch(text, /Priorité/);
  assert.equal(subject.qualification.answers.problem.answer, 'unknown');
});

test('a partially typed proof URL does not discard the rest of the unsaved browser draft', () => {
  const answers = emptyQualification().answers;
  answers.problem.answer = 'one';
  answers.problem.proofUrl = 'htt';
  answers.problem.description = 'Une justification encore en cours de saisie.';
  assert.deepEqual(restoreQualificationAnswers(answers), answers);
});

test('an incompatible or unbounded browser draft is ignored', () => {
  assert.equal(restoreQualificationAnswers({ problem: { proofUrl: 'htt' } }), null);
  const answers = emptyQualification().answers;
  answers.problem.description = 'a'.repeat(5001);
  assert.equal(restoreQualificationAnswers(answers), null);
});
