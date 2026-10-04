import test from 'node:test';
import assert from 'node:assert/strict';
import { readAnalysisPreview, sealAnalysisPreview } from '../lib/automation-preview';
import type { SiteAnalysis } from '../lib/site-analysis';

const analysis: SiteAnalysis = { website: 'https://example.com/', analyzedOn: '2026-10-04', pages: [], contacts: [], findings: [], warnings: [] };
test('analysis previews are bound to the company and reject altered facts', () => {
  const token = sealAnalysisPreview('company-a', '2026-10-04T12:00:00Z', analysis);
  assert.deepEqual(readAnalysisPreview(token, 'company-a').analysis, analysis);
  assert.throws(() => readAnalysisPreview(token, 'company-b'), /expiré/);
  const [payload, signature] = token.split('.');
  const changed = JSON.parse(Buffer.from(payload, 'base64url').toString()); changed.analysis.website = 'https://forged.example';
  assert.throws(() => readAnalysisPreview(`${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`, 'company-a'), /expiré/);
  assert.throws(() => readAnalysisPreview('x'.repeat(130 * 1024), 'company-a'), /expiré/);
});
