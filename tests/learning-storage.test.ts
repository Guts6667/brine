import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { PDFDocument } from 'pdf-lib';
import { Store } from '../lib/db';
import { AsyncCloudStore } from '../lib/cloud-db';
import { CampaignRepository } from '../lib/campaign-repository';
import { cloudMigrations } from '../lib/cloud-schema';
import { backupSchema } from '../lib/domain';
import { learningSql, learningMutationSchema, learningProgressSchema, emptyLearningProgress } from '../lib/learning-schema';
import { learningExampleBrief, loadLearningExampleAsset, LEARNING_EXAMPLE_ASSET_ID } from '../lib/learning-example-brief';
import { renderClientBriefPdf } from '../lib/client-brief-pdf';
import { TEACHING_EMAIL } from '../lib/learning-exercises';
import type { Backup } from '../lib/types';
import type { LearningModuleId, LearningAnswers } from '../lib/learning-types';

const answers: Record<LearningModuleId, LearningAnswers> = {
  cible: { target: 'precise' },
  occasion: { defect: 'observed', limited: 'incomplete', satisfactory: 'positive' },
  qualification: { proof: 'confirmed', fit: 'exact', problem: 'one', trigger: 'none', references: 'multiple', access: 'generic', decision: 'later' },
  email: { emailChoice: 'useful', emailText: TEACHING_EMAIL, introduces: true, evidence: true, help: true, question: true, claims: true },
  suivi: { copied: 'nothing', noReply: 'review', refusal: 'stop', opposition: 'oppose', reply: 'agreed' },
  echange: { openQuestion: 'open', need: true, solution: true, decision: true, nextStep: true, budgetUnknown: true, reformulation: 'La galerie mobile est difficile à lire. Vous souhaitez deux pistes ciblées à lire vendredi.', reformulationReviewed: true },
};
async function fixture(kind: 'local' | 'cloud') {
  const dir = mkdtempSync(join(tmpdir(), 'brine-learning-')), url = `file:${join(dir, 'data.sqlite')}`;
  const base = kind === 'local' ? new Store(join(dir, 'data.sqlite')) : new AsyncCloudStore(createClient({ url }));
  await base.listCompanies(); const repo = new CampaignRepository(createClient({ url })); await repo.bootstrap();
  const campaign = (await repo.listCampaigns())[0];
  const company = await base.createCompany({ name: 'Prospect préexistant', website: '', city: 'Montpellier', business: 'Rénovation' }); await repo.attach(campaign.id, company.id);
  await repo.client.execute("INSERT INTO research_operations(operationKey,provider,month,createdAt,updatedAt,status,reservedUsdMicros,actualUsdMicros,quotaUnits) VALUES('already-spent','openrouter','2026-10','2026-10-05','2026-10-05','completed',500,400,1)");
  await repo.client.execute("INSERT INTO research_credit_purchases(id,date,amountEuroCents,createdAt) VALUES('payment','2026-10-05',500,'2026-10-05')");
  const financial = async () => [(await repo.client.execute('SELECT * FROM research_operations')).rows, (await repo.client.execute('SELECT * FROM research_credit_purchases')).rows];
  return { base, repo, campaign, financial, url, close() { repo.close(); base.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function business(backup: Backup) {
  const { exportedAt: _time, campaignData, ...rest } = backup;
  const { learningProgress: _progress, ...campaigns } = campaignData!;
  return { ...rest, campaignData: campaigns };
}
test('learning migrations agree, and untrusted exercise payloads are bounded and strict', () => {
  assert.equal(learningSql.trim(), readFileSync('migrations/006_learning.sql', 'utf8').trim());
  assert.equal(cloudMigrations.find(m => m.version === 7)?.sql, learningSql);
  assert.equal(learningProgressSchema.safeParse(emptyLearningProgress()).success, true);
  for (const input of [
    { operation: 'answers', revision: 0, moduleId: 'cible', answers: { text: 'x'.repeat(12001) } },
    { operation: 'answers', revision: 0, moduleId: 'cible', answers: JSON.parse('{"__proto__":true}') },
    { operation: 'guide', revision: -1, guideOpen: true },
    { operation: 'complete', revision: 0, moduleId: 'unknown' },
    { operation: 'card', revision: 0, showTodayCard: false, companyId: 'learning-only' },
  ]) assert.equal(learningMutationSchema.safeParse(input).success, false);
});
for (const kind of ['local', 'cloud'] as const) {
  test(`${kind}: exercise progression survives a fresh client without mutating prospects, histories, quotas or payments`, async () => {
    const f = await fixture(kind);
    try {
      const before = business(await f.base.exportBackup()), costs = await f.financial();
      let p = await f.repo.getLearningProgress(); assert.deepEqual(p, emptyLearningProgress());
      assert.equal((await f.repo.client.execute('SELECT COUNT(*) n FROM learning_progress')).rows[0].n, 0, 'Reading training does not create state.');
      await assert.rejects(f.repo.saveLearningProgress({ operation: 'complete', revision: 0, moduleId: 'cible' }), /Complétez/);
      for (const moduleId of Object.keys(answers) as LearningModuleId[]) {
        p = await f.repo.saveLearningProgress({ operation: 'answers', revision: p.revision, moduleId, answers: answers[moduleId] });
        p = await f.repo.saveLearningProgress({ operation: 'complete', revision: p.revision, moduleId });
      }
      assert.equal(p.completedModules.length, 6); assert.equal(p.mission.recordedContact, false);
      p = await f.repo.saveLearningProgress({ operation: 'campaign', revision: p.revision, campaignId: f.campaign.id });
      p = await f.repo.saveLearningProgress({ operation: 'guide', revision: p.revision, guideOpen: true });
      p = await f.repo.saveLearningProgress({ operation: 'card', revision: p.revision, showTodayCard: false });
      const other = new CampaignRepository(createClient({ url: f.url }));
      try { assert.deepEqual(await other.getLearningProgress(), p); } finally { other.close(); }
      assert.deepEqual(business(await f.base.exportBackup()), before); assert.deepEqual(await f.financial(), costs);
    } finally { f.close(); }
  });
  test(`${kind}: simultaneous devices reject stale answers and incomplete exercises cannot be marked complete`, async () => {
    const f = await fixture(kind);
    try {
      const p = await f.repo.saveLearningProgress({ operation: 'answers', revision: 0, moduleId: 'cible', answers: { target: 'all', freeText: 'Mon texte conservé' } });
      await assert.rejects(f.repo.saveLearningProgress({ operation: 'complete', revision: p.revision, moduleId: 'cible' }), /Complétez/);
      const results = await Promise.allSettled([
        f.repo.saveLearningProgress({ operation: 'guide', revision: p.revision, guideOpen: true }),
        f.repo.saveLearningProgress({ operation: 'card', revision: p.revision, showTodayCard: false }),
      ]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter(r => r.status === 'rejected').length, 1);
      assert.equal((await f.repo.getLearningProgress()).answers.cible?.freeText, 'Mon texte conservé');
      await assert.rejects(f.repo.saveLearningProgress({ operation: 'answers', revision: p.revision, moduleId: 'cible', answers: answers.cible }), /autre écran/);
      await assert.rejects(f.repo.saveLearningProgress({ operation: 'campaign', revision: p.revision + 1, campaignId: 'unknown' }), /introuvable/);
    } finally { f.close(); }
  });
  test(`${kind}: v6 restores answers, old v1-v5 imports preserve current learning, and restoration never rewinds spending`, async () => {
    const f = await fixture(kind);
    try {
      let p = await f.repo.saveLearningProgress({ operation: 'answers', revision: 0, moduleId: 'email', answers: { emailText: 'Mon brouillon, à reprendre.' } });
      p = await f.repo.saveLearningProgress({ operation: 'campaign', revision: p.revision, campaignId: f.campaign.id });
      const backup = await f.base.exportBackup(), costs = await f.financial(); assert.equal(backup.schemaVersion, 7); assert.ok(backupSchema.safeParse(backup).success);
      await f.base.restoreBackup(backup, true); p = await f.repo.getLearningProgress(); assert.equal(p.answers.email?.emailText, 'Mon brouillon, à reprendre.'); assert.ok(p.revision > backup.campaignData!.learningProgress!.revision);
      for (const schemaVersion of [1, 2, 3, 4, 5]) {
        const legacy: Record<string, unknown> = { ...backup, schemaVersion };
        const { learningProgress: _learning, ...data } = backup.campaignData!;
        if (schemaVersion <= 2) delete legacy.campaignData; else legacy.campaignData = data;
        if (schemaVersion === 1) legacy.companies = backup.companies.map(({qualification: _qualification, ...company}) => company);
        const oldRevision = p.revision; await f.base.restoreBackup(legacy, true); p = await f.repo.getLearningProgress();
        assert.equal(p.answers.email?.emailText, 'Mon brouillon, à reprendre.'); assert.ok(p.revision > oldRevision); assert.deepEqual(await f.financial(), costs);
        if (schemaVersion <= 2) assert.equal(p.campaignId, null, 'Only the removed campaign selection is cleared.');
      }
    } finally { f.close(); }
  });
}
test('the teaching PDF is explicitly fictional, two pages and deterministic, using only its fixed local illustration', async () => {
  const brief = learningExampleBrief(); assert.match(brief.companyName, /FICTIF/); assert.match(brief.actions[0], /Ne pas envoyer/);
  let loads = 0; const bytes = await renderClientBriefPdf(brief, async id => { loads++; assert.equal(id, LEARNING_EXAMPLE_ASSET_ID); return loadLearningExampleAsset(id); }, {pedagogical:true});
  assert.equal(loads, 1); assert.equal(await loadLearningExampleAsset('unknown'), null); assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
  assert.deepEqual(await renderClientBriefPdf(learningExampleBrief(), loadLearningExampleAsset, {pedagogical:true}), bytes);
});
