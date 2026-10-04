import test from 'node:test';
import assert from 'node:assert/strict';
import { aiApproach, aiResearchQuestions } from '../lib/approach';
import type { AiTest } from '../lib/types';

const measured: AiTest = { id: 'test', companyId: 'company', panel: 'Recherche locale', period: '4 octobre 2026', tool: 'Claude', interface: 'Application web avec recherche', mode: 'web', model: '', questions: 'Qui recommandes-tu à Montpellier ?', validResponses: 3, recommendations: 0, citations: 0, notes: 'Trois réponses conservées.', proofUrl: 'https://example.com/proof', createdAt: '2026-10-04T12:00:00Z' };
test('AI approach only describes measured absence with proof and identifies exact interface', () => {
  const approach = aiApproach({ name: 'Atelier' }, measured)!;
  assert.match(approach, /3 réponses/); assert.match(approach, /Claude/); assert.match(approach, /ce panel précis/);
  for (const patch of [{ validResponses: null }, { validResponses: 0 }, { recommendations: null }, { recommendations: 1 }, { proofUrl: '' }, { mode: 'unknown' as const }, { questions: '' }, { interface: '' }]) {
    assert.equal(aiApproach({ name: 'Atelier' }, { ...measured, ...patch }), null);
  }
});
test('discovery prompts avoid naming the prospect and preserve missing targeting information', () => {
  const questions = aiResearchQuestions({ business: 'Peinture', city: 'Montpellier' });
  assert.equal(questions.length, 3); assert.ok(questions.every(question => question.includes('Montpellier')));
  assert.match(aiResearchQuestions({ business: '', city: '' })[0], /à préciser/);
});
