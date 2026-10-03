import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';
import { Store } from '../lib/db';
import { AsyncCloudStore } from '../lib/cloud-db';
import { cloudMigrations } from '../lib/cloud-schema';
import { backupSchema } from '../lib/domain';
import { captureTarget, emptyQualification, evaluateAfterExchange, evaluateQualification } from '../lib/qualification';
import type { Company, CompanyDetails, Settings } from '../lib/types';

const today = '2026-10-03';
const target: Settings = { targetCity: 'Montpellier', targetBusiness: 'Rénovation intérieure', targetCompanyType: 'Entreprise indépendante', targetOffer: 'Amélioration ciblée du site', targetExclusions: 'Réseaux nationaux' };
function fixture(kind: 'local' | 'cloud') {
  const directory = mkdtempSync(join(tmpdir(), `brine-qualification-${kind}-`));
  const path = join(directory, 'private.sqlite');
  let store: Store | AsyncCloudStore = kind === 'local' ? new Store(path) : new AsyncCloudStore(createClient({ url: `file:${path}` }));
  return { path, get store() { return store; }, reopen() { store.close(); store = kind === 'local' ? new Store(path) : new AsyncCloudStore(createClient({ url: `file:${path}` })); return store; }, dispose() { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
function details(company: Company, patch: Partial<CompanyDetails> = {}): CompanyDetails {
  const { id: _id, nextAction: _next, createdAt: _created, updatedAt: _updated, oppositionActive: _active, oppositionDate: _date, oppositionNote: _note, archived: _archived, qualification: _qualification, ...data } = company;
  return { ...data, ...patch };
}
function goodAnswers() {
  const answers = emptyQualification().answers;
  answers.fit.answer = 'exact';
  answers.problem = { ...answers.problem, answer: 'multiple_or_blocking', description: 'Deux défauts documentés : menu inaccessible et prestations non expliquées.', observedOn: today, majorReason: 'multiple', distinctProblems: ['Menu inaccessible sur mobile', 'Prestations réelles non expliquées'], observationKeys: ['mobile', 'services'] };
  answers.trigger = { ...answers.trigger, answer: 'recent_change', description: 'Nouvelle zone annoncée.', source: 'Annonce officielle vérifiée manuellement', verifiedOn: today, eventOn: '2026-09-28', relevance: 'Présenter la nouvelle zone dans le site.' };
  answers.references = { ...answers.references, answer: 'multiple', examples: ['Réalisation A', 'Réalisation B'], improvement: 'Rendre ces réalisations identifiables dans le site.' };
  answers.access.answer = 'generic';
  return answers;
}
function exchangeInput() {
  const { qualifiedAt: _qualifiedAt, ...exchange } = emptyQualification().afterExchange;
  return { ...exchange, need: 'confirmed', needNote: 'Le prospect souhaite mieux expliquer ses prestations.', solution: 'targeted_improvement', solutionNote: 'Clarifier les prestations répond au besoin exprimé.', solutionFit: 'confirmed', decision: 'identified', decisionNote: 'La dirigeante valide directement les interventions.', nextStep: { description: 'Examiner ensemble le périmètre proposé', date: '', accepted: true } };
}
const withoutExportDate = ({ exportedAt: _exported, ...backup }: Awaited<ReturnType<Store['exportBackup']>>) => backup;

test('qualification cloud migration is the additive local migration after the existing recovery version', () => {
  assert.equal(cloudMigrations[2].version, 3);
  assert.equal(cloudMigrations[2].sql.trim(), readFileSync(join(process.cwd(), 'migrations/002_qualification.sql'), 'utf8').trim());
});

for (const kind of ['local', 'cloud'] as const) {
  test(`${kind}: incomplete answers and observations persist independently without inventing score or changing stage`, async () => {
    const f = fixture(kind);
    try {
      await f.store.saveSettings(target);
      const company = await f.store.createCompany({ name: 'Qualification brouillon', website: '', city: '', business: '' });
      assert.equal(evaluateQualification(company, target, today).evaluated, false);
      const answers = emptyQualification().answers; answers.problem.answer = 'one';
      let current = await f.store.saveQualification(company.id, { answers }, false);
      assert.equal(current.qualification!.answers.problem.answer, 'one');
      assert.equal(evaluateQualification(current, target, today).confirmedPoints, 0);
      assert.equal(evaluateQualification(current, target, today).score, null);
      const observations = emptyQualification().observations;
      observations.items.mobile = { answer: 'yes', notes: 'Le menu masque le texte.', sourceUrl: 'https://example.invalid/mobile', observedOn: today };
      observations.items.mainAction.answer = 'no';
      observations.items.contact.answer = 'not_applicable';
      observations.googleReviewCount = 12; observations.googleRating = 4.2;
      observations.items.recentActivity = { answer: 'yes', notes: 'Annonce officielle datée.', sourceUrl: '', observedOn: today };
      observations.recentEventOn = '2026-09-28';
      current = await f.store.saveObservations(company.id, observations);
      assert.equal(current.qualification!.answers.problem.answer, 'one');
      assert.equal(current.qualification!.observations.items.mainAction.answer, 'no');
      assert.equal(evaluateQualification(current, target, today).confirmedPoints, 0);
      assert.equal(current.stage, 'À étudier');
      current = (await f.reopen().getCompany(company.id))!;
      assert.deepEqual(current.qualification!.observations, observations);
      await assert.rejects(async () => f.store.saveQualification(company.id, { answers, score: 100 }, true));
      await assert.rejects(async () => f.store.saveQualification(company.id, { answers: { ...answers, problem: { ...answers.problem, answer: 30 } } }, true));
      await assert.rejects(async () => f.store.saveObservations(company.id, { ...observations, googleRating: 6 }));
      await assert.rejects(async () => f.store.saveAfterExchange(company.id, { ...exchangeInput(), qualifiedAt: '2026-10-03T00:00:00.000Z' }));
    } finally { f.dispose(); }
  });

  test(`${kind}: server target confirmation and fresh contacts control completion while historical score survives target changes`, async () => {
    const f = fixture(kind);
    try {
      await f.store.saveSettings(target);
      let company = await f.store.createCompany({ name: 'Quatre-vingts points', website: '', city: '', business: '' });
      company = await f.store.updateCompany(company.id, details(company, { contact: { ...company.contact, email: 'contact@example.invalid' } }));
      const answers = goodAnswers();
      company = await f.store.saveQualification(company.id, { answers }, false);
      assert.equal(company.qualification!.targetSnapshot, null);
      assert.equal(evaluateQualification(company, target, today).score, null);
      await assert.rejects(async () => f.store.saveQualification(company.id, { answers, targetSnapshot: { ...target, targetOffer: 'Fausse cible client' } }, true));
      company = await f.store.saveQualification(company.id, { answers }, true, captureTarget(await f.store.getSettings()));
      assert.deepEqual(company.qualification!.targetSnapshot, target);
      assert.equal(evaluateQualification(company, target, today).score, 80);
      assert.equal(evaluateQualification(company, target, today).decision, 'Prêt à contacter');
      const original = structuredClone(company.qualification);
      await f.store.addActivity(company.id, { kind: 'note', type: '', date: '', text: 'Cette note ne change pas les critères.' });
      company = (await f.store.getCompany(company.id))!;
      assert.deepEqual(company.qualification, original);
      company = await f.store.updateCompany(company.id, details(company, { contact: { ...company.contact, email: '' } }));
      assert.equal(company.qualification!.answers.access.answer, 'generic');
      assert.equal(evaluateQualification(company, target, today).score, null);
      assert.equal(evaluateQualification(company, target, today).criteria.find(({ key }) => key === 'access')!.points, null);
      company = await f.store.updateCompany(company.id, details(company, { contact: { ...company.contact, email: 'contact@example.invalid' } }));
      assert.equal(evaluateQualification(company, target, today).score, 80);
      const changedTarget = { ...target, targetCity: 'Lyon' };
      await f.store.saveSettings(changedTarget);
      const historical = evaluateQualification(company, changedTarget, today);
      assert.equal(historical.score, 80); assert.equal(historical.targetNeedsRevalidation, true); assert.equal(historical.decision, 'À vérifier');
      assert.deepEqual(company.qualification!.targetSnapshot, target);
      company = await f.store.saveQualification(company.id, { answers }, true, captureTarget(await f.store.getSettings()));
      assert.deepEqual(company.qualification!.targetSnapshot, changedTarget);
      assert.equal(evaluateQualification(company, changedTarget, today).targetNeedsRevalidation, false);
      assert.equal(company.stage, 'À étudier');
    } finally { f.dispose(); }
  });

  test(`${kind}: target confirmation rejects every stale displayed field atomically and never trusts a client snapshot`, async () => {
    const f = fixture(kind);
    try {
      await f.store.saveSettings(target);
      let company = await f.store.createCompany({ name: 'Cible affichée périmée', website: '', city: '', business: '' });
      company = await f.store.updateCompany(company.id, details(company, { contact: { ...company.contact, email: 'contact@example.invalid' } }));
      const answers = goodAnswers();
      const displayedTarget = captureTarget(await f.store.getSettings());
      const untouched = withoutExportDate(await f.store.exportBackup());
      await assert.rejects(async () => f.store.saveQualification(company.id, { answers }, true), /La cible a changé/);
      assert.deepEqual(withoutExportDate(await f.store.exportBackup()), untouched);
      company = await f.store.saveQualification(company.id, { answers }, true, displayedTarget);
      assert.equal(evaluateQualification(company, target, today).decision, 'Prêt à contacter');
      for (const key of ['targetCity', 'targetBusiness', 'targetCompanyType', 'targetOffer', 'targetExclusions'] as const) {
        await f.store.saveSettings({ ...target, [key]: 'Nouvelle valeur de cible' });
        const beforeReject = withoutExportDate(await f.store.exportBackup());
        const changedAnswers = structuredClone(answers); changedAnswers.fit.note = 'Cette note ne doit pas être écrite en cas de refus.';
        await assert.rejects(async () => f.store.saveQualification(company.id, { answers: changedAnswers }, true, displayedTarget), /La cible a changé/);
        assert.deepEqual(withoutExportDate(await f.store.exportBackup()), beforeReject);
        company = (await f.store.getCompany(company.id))!;
        assert.deepEqual(company.qualification!.targetSnapshot, displayedTarget);
        assert.equal(evaluateQualification(company, await f.store.getSettings(), today).targetNeedsRevalidation, true);
        assert.equal(evaluateQualification(company, await f.store.getSettings(), today).decision, 'À vérifier');
        await f.store.saveSettings(target);
      }
      const changedTarget = { ...target, targetCity: 'Lyon' };
      await f.store.saveSettings(changedTarget);
      // An ordinary draft save ignores the expected target and preserves the historical snapshot.
      company = await f.store.saveQualification(company.id, { answers }, false, captureTarget(changedTarget));
      assert.deepEqual(company.qualification!.targetSnapshot, displayedTarget);
      company = await f.store.saveQualification(company.id, { answers }, true, captureTarget(await f.store.getSettings()));
      assert.deepEqual(company.qualification!.targetSnapshot, changedTarget);
      assert.equal(evaluateQualification(company, changedTarget, today).decision, 'Prêt à contacter');
    } finally { f.dispose(); }
  });

  test(`${kind}: opportunity requires explicit validated transition and contradictions retain stage, timestamp and history`, async () => {
    const f = fixture(kind);
    try {
      let company = await f.store.createCompany({ name: 'Après échange', website: '', city: '', business: '' });
      await assert.rejects(async () => f.store.qualifyOpportunity(company.id), /conditions après échange/);
      await assert.rejects(async () => f.store.updateCompany(company.id, details(company, { stage: 'Opportunité qualifiée' })), /conditions après échange/);
      company = await f.store.saveAfterExchange(company.id, exchangeInput());
      assert.equal(evaluateAfterExchange(company).possible, true);
      assert.equal(company.stage, 'À étudier'); assert.equal(company.qualification!.afterExchange.qualifiedAt, '');
      company = await f.store.qualifyOpportunity(company.id);
      assert.equal(company.stage, 'Opportunité qualifiée');
      const qualifiedAt = company.qualification!.afterExchange.qualifiedAt; assert.ok(qualifiedAt);
      assert.ok((await f.store.listActivities(company.id)).some(({ text }) => text.includes('Étape modifiée explicitement')));
      company = (await f.reopen().getCompany(company.id))!;
      assert.equal(company.stage, 'Opportunité qualifiée'); assert.equal(company.qualification!.afterExchange.qualifiedAt, qualifiedAt);
      company = await f.store.saveAfterExchange(company.id, { ...exchangeInput(), need: 'not_recognized', needNote: 'Le prospect contredit le besoin initial.' });
      assert.equal(company.stage, 'Opportunité qualifiée'); assert.equal(company.qualification!.afterExchange.qualifiedAt, qualifiedAt);
      assert.equal(evaluateAfterExchange(company).reevaluationRequired, true);
      await f.store.setOpposition(company.id, true, 'Demande explicite');
      await assert.rejects(async () => f.store.qualifyOpportunity(company.id), /conditions après échange/);
      assert.equal((await f.store.getCompany(company.id))!.stage, 'Opportunité qualifiée');
    } finally { f.dispose(); }
  });

  test(`${kind}: section saves use the latest record and preserve unrelated answers, observations and exchange data`, async () => {
    const f = fixture(kind);
    try {
      await f.store.saveSettings(target);
      const company = await f.store.createCompany({ name: 'Sections indépendantes', website: '', city: '', business: '' });
      const observations = emptyQualification().observations;
      observations.items.siteSatisfactory = { answer: 'yes', notes: 'Le site semble adapté à son usage.', sourceUrl: '', observedOn: today };
      const expectedTarget = captureTarget(await f.store.getSettings());
      await Promise.all([
        f.store.saveQualification(company.id, { answers: goodAnswers() }, true, expectedTarget),
        f.store.saveObservations(company.id, observations),
        f.store.saveAfterExchange(company.id, exchangeInput()),
      ]);
      let current = (await f.store.getCompany(company.id))!;
      assert.equal(current.qualification!.answers.problem.answer, 'multiple_or_blocking');
      assert.deepEqual(current.qualification!.targetSnapshot, target);
      assert.deepEqual(current.qualification!.observations, observations);
      assert.equal(current.qualification!.afterExchange.need, 'confirmed');
      assert.equal(current.stage, 'À étudier');
      current = (await f.reopen().getCompany(company.id))!;
      assert.equal(current.qualification!.answers.problem.answer, 'multiple_or_blocking');
      assert.equal(current.qualification!.observations.items.siteSatisfactory.answer, 'yes');
      assert.equal(current.qualification!.afterExchange.need, 'confirmed');
      // Basic details updates carry the displayed contact and never replace scoring sections.
      current = await f.store.updateCompany(company.id, details(current, { name: 'Sections conservées', contact: { ...current.contact, email: 'generic@example.invalid' } }));
      assert.equal(current.qualification!.afterExchange.need, 'confirmed');
      assert.equal(evaluateQualification(current, target, today).score, 80);
      const answers = structuredClone(current.qualification!.answers);
      answers.access = { ...answers.access, answer: 'decision_maker', channelAssociation: 'Le courriel nominatif est celui de la dirigeante.' };
      current = await f.store.updateCompany(company.id, details(current, { contact: { ...current.contact, name: 'Camille', role: 'Dirigeante' } }));
      current = await f.store.saveQualification(company.id, { answers }, false);
      assert.equal(evaluateQualification(current, target, today).score, 90);
      current = await f.store.updateCompany(company.id, details(current, { contact: { ...current.contact, name: '' } }));
      assert.equal(current.qualification!.answers.access.answer, 'decision_maker');
      assert.equal(evaluateQualification(current, target, today).score, null);
      assert.equal(current.qualification!.observations.items.siteSatisfactory.answer, 'yes');
    } finally { f.dispose(); }
  });

  test(`${kind}: restoration keeps qualification and complete history for absent opposed companies`, async () => {
    const f = fixture(kind);
    try {
      await f.store.saveSettings(target);
      const company = await f.store.createCompany({ name: 'Opposition qualifiée conservée', website: '', city: '', business: '' });
      await f.store.saveQualification(company.id, { answers: goodAnswers() }, true, captureTarget(await f.store.getSettings()));
      const observations = emptyQualification().observations;
      observations.items.inactivity = { answer: 'yes', notes: 'Information explicite vérifiée.', sourceUrl: '', observedOn: today };
      await f.store.saveObservations(company.id, observations);
      await f.store.saveAfterExchange(company.id, exchangeInput());
      await f.store.qualifyOpportunity(company.id);
      await f.store.addActivity(company.id, { kind: 'note', type: '', date: '', text: 'Historique explicite à conserver.' });
      await f.store.setOpposition(company.id, true, 'Opposition exprimée après échange.');
      const before = (await f.store.getCompany(company.id))!;
      const empty = { ...(await f.store.exportBackup()), companies: [], activities: [], aiTests: [] };
      const restored = await f.store.restoreBackup(empty, true);
      assert.equal(restored.preservedOppositions, 1);
      const current = (await f.store.getCompany(company.id))!;
      assert.equal(current.archived, true); assert.equal(current.oppositionActive, true);
      assert.equal(current.stage, 'Opportunité qualifiée');
      assert.deepEqual(current.qualification, before.qualification);
      assert.equal(evaluateQualification(current, target, today).decision, 'Ne plus contacter');
      assert.ok((await f.store.listActivities(company.id)).some(({ text }) => text === 'Historique explicite à conserver.'));
      assert.equal(backupSchema.safeParse(await f.store.exportBackup()).success, true);
    } finally { f.dispose(); }
  });

  test(`${kind}: v2 backups round-trip complete sections and v1 backups migrate legacy answers without inference`, async () => {
    const f = fixture(kind);
    try {
      await f.store.saveSettings(target);
      let company = await f.store.createCompany({ name: 'Sauvegarde qualification', website: '', city: '', business: '' });
      company = await f.store.updateCompany(company.id, details(company, { targetFit: 'yes', problemFound: 'yes', contactAvailable: 'yes', observation: 'Ancienne observation conservée.', contact: { ...company.contact, email: 'contact@example.invalid' } }));
      company = await f.store.saveQualification(company.id, { answers: goodAnswers() }, true, captureTarget(await f.store.getSettings()));
      await f.store.saveAfterExchange(company.id, exchangeInput()); await f.store.qualifyOpportunity(company.id);
      const saved = await f.store.exportBackup(); assert.equal(saved.schemaVersion, 2);
      await f.store.restoreBackup(saved, true);
      assert.deepEqual(withoutExportDate(await f.store.exportBackup()), withoutExportDate(saved));
      const malformed = structuredClone(saved); Reflect.deleteProperty(malformed.companies[0], 'qualification');
      await assert.rejects(async () => f.store.restoreBackup(malformed, true));
      const missingTarget = structuredClone(saved); Reflect.deleteProperty(missingTarget.settings, 'targetOffer');
      await assert.rejects(async () => f.store.restoreBackup(missingTarget, true));
      const legacy = structuredClone(saved);
      legacy.schemaVersion = 1;
      legacy.companies[0].stage = 'En échange'; Reflect.deleteProperty(legacy.companies[0], 'qualification');
      Reflect.deleteProperty(legacy.settings, 'targetCompanyType'); Reflect.deleteProperty(legacy.settings, 'targetOffer'); Reflect.deleteProperty(legacy.settings, 'targetExclusions');
      const parsed = backupSchema.parse(legacy); assert.equal(parsed.schemaVersion, 2);
      await f.store.restoreBackup(legacy, true);
      company = (await f.store.getCompany(company.id))!;
      assert.equal(company.targetFit, 'yes'); assert.equal(company.problemFound, 'yes'); assert.equal(company.contactAvailable, 'yes');
      assert.equal(company.observation, 'Ancienne observation conservée.');
      assert.deepEqual(company.qualification, emptyQualification());
      assert.equal(evaluateQualification(company, await f.store.getSettings(), today).evaluated, false);
      assert.equal((await f.store.exportBackup()).schemaVersion, 2);
    } finally { f.dispose(); }
  });
}

test('local migration preserves existing legacy company, contact, action and note records without inferring new answers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'brine-legacy-migrate-'));
  const path = join(directory, 'legacy.sqlite');
  let store: Store | undefined;
  try {
    const raw = new Database(path);
    raw.exec(readFileSync(join(process.cwd(), 'migrations/001_initial.sql'), 'utf8'));
    raw.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, filename TEXT NOT NULL, appliedAt TEXT NOT NULL)');
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(1, '001_initial.sql', '2026-10-01T00:00:00.000Z');
    raw.prepare('INSERT INTO companies(id, name, targetFit, problemFound, contactAvailable, observation, stage, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy', 'Ancienne fiche', 'yes', 'yes', 'yes', 'Ancien constat.', 'En échange', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
    raw.prepare('INSERT INTO contacts(companyId,email) VALUES (?,?)').run('legacy', 'contact@example.invalid');
    raw.prepare('INSERT INTO next_actions VALUES(?,?,?,?,?)').run('legacy-action', 'legacy', 'Action à conserver', '2026-10-10', '2026-10-01T00:00:00.000Z');
    raw.prepare('INSERT INTO activities VALUES(?,?,?,?,?,?,?)').run('legacy-note', 'legacy', 'note', '', '', 'Note à conserver', '2026-10-01T00:00:00.000Z');
    raw.close();
    store = new Store(path);
    const company = store.getCompany('legacy')!;
    assert.equal(company.stage, 'En échange'); assert.equal(company.targetFit, 'yes'); assert.equal(company.problemFound, 'yes'); assert.equal(company.contactAvailable, 'yes');
    assert.equal(company.observation, 'Ancien constat.'); assert.equal(company.contact.email, 'contact@example.invalid'); assert.equal(company.nextAction!.id, 'legacy-action');
    assert.ok(store.listActivities('legacy').some(({ text }) => text === 'Note à conserver'));
    assert.deepEqual(company.qualification, emptyQualification());
    assert.equal(evaluateQualification(company, store.getSettings(), today).evaluated, false);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
