import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';
import { Store } from '../lib/db';
import { AsyncCloudStore } from '../lib/cloud-db';
import { applySiteSuggestions, importCompanyCandidate } from '../lib/automation-storage';
import { parisToday } from '../lib/domain';
import { captureTarget, emptyQualification, evaluateQualification } from '../lib/qualification';
import type { CompanyCandidate } from '../lib/company-search';
import type { SiteAnalysis } from '../lib/site-analysis';
import type { Backup, Company, CompanyDetails, Settings } from '../lib/types';

const today = parisToday();
const target: Settings = { targetCity: 'Montpellier', targetBusiness: 'Rénovation', targetCompanyType: 'Indépendante', targetOffer: 'Améliorer le site', targetExclusions: '' };
const candidate: CompanyCandidate = {
  siren: '123456789', siret: '12345678900012', name: 'Atelier Exemple', city: 'Montpellier', business: 'Rénovation',
  activityCode: '43.39Z', address: '1 rue Exemple, Montpellier',
  sourceUrl: 'https://annuaire-entreprises.data.gouv.fr/entreprise/123456789',
};
const analysis: SiteAnalysis = {
  website: 'https://atelier.invalid/', analyzedOn: today,
  pages: [{ url: 'https://atelier.invalid/', title: 'Atelier' }, { url: 'https://atelier.invalid/contact', title: 'Contact' }],
  contacts: [
    { kind: 'email', value: 'proposition@atelier.invalid', sourceUrl: 'https://atelier.invalid/contact' },
    { kind: 'phone', value: '04 67 00 00 00', sourceUrl: 'https://atelier.invalid/contact' },
    { kind: 'formUrl', value: 'https://atelier.invalid/contact', sourceUrl: 'https://atelier.invalid/contact' },
  ],
  findings: [
    { id: 'mobile', key: 'mobile', note: 'Une balise viewport est présente ; le rendu reste à vérifier.', sourceUrl: 'https://atelier.invalid/' },
    { id: 'services', key: 'services', note: 'Une page décrit les prestations.', sourceUrl: 'https://atelier.invalid/' },
    { id: 'link-contact', key: 'technical', note: 'Le lien de contact renvoie HTTP 404.', sourceUrl: 'https://atelier.invalid/contact', approach: 'Présenter le lien de contact vérifié et proposer de le corriger.' },
    { id: 'dated-footer', key: 'siteAge', note: 'Une date est affichée dans le pied de page.', sourceUrl: 'https://atelier.invalid/' },
  ],
  warnings: ['Le rendu mobile demande une vérification visuelle.'],
};

function fixture(kind: 'local' | 'cloud') {
  const directory = mkdtempSync(join(tmpdir(), `brine-automation-${kind}-`));
  const path = join(directory, 'private.sqlite');
  const store = kind === 'local' ? new Store(path) : new AsyncCloudStore(createClient({ url: `file:${path}` }));
  return { path, store, dispose() { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
function details(company: Company, patch: Partial<CompanyDetails> = {}): CompanyDetails {
  return {
    name: company.name, website: company.website, city: company.city, business: company.business,
    targetFit: company.targetFit, problemFound: company.problemFound, contactAvailable: company.contactAvailable,
    observation: company.observation, proofUrl: company.proofUrl, observedOn: company.observedOn,
    trigger: company.trigger, stage: company.stage, contact: { ...company.contact }, ...patch,
  };
}
const data = ({ exportedAt: _date, ...backup }: Backup) => backup;

for (const kind of ['local', 'cloud'] as const) {
  test(`${kind}: imports are dated, start unknown and retain renamed duplicate opposition and archive`, async () => {
    const f = fixture(kind);
    try {
      const first = await importCompanyCandidate(f.store, candidate);
      assert.equal(first.duplicate, false);
      let company = (await f.store.getCompany(first.id))!;
      assert.equal(company.website, '');
      assert.equal(company.targetFit, 'unknown'); assert.equal(company.problemFound, 'unknown'); assert.equal(company.contactAvailable, 'unknown');
      assert.equal(company.stage, 'À étudier'); assert.equal(company.nextAction, null);
      assert.deepEqual(company.qualification, emptyQualification());
      const source = (await f.store.listActivities(company.id)).find(activity => activity.type === 'Import Annuaire des entreprises')!;
      assert.equal(source.kind, 'note'); assert.equal(source.date, today);
      assert.ok(source.text.includes(candidate.siren)); assert.ok(source.text.includes(candidate.siret));
      assert.ok(source.text.includes(candidate.sourceUrl)); assert.ok(source.text.includes(candidate.address));
      company = await f.store.updateCompany(company.id, details(company, { name: 'Nom corrigé', city: 'Nîmes' }));
      await f.store.setOpposition(company.id, true, 'Demande explicite à préserver');
      await f.store.setArchived(company.id, true);
      const before = data(await f.store.exportBackup());
      const duplicate = await importCompanyCandidate(f.store, { ...candidate, siret: '12345678900020' });
      assert.deepEqual(duplicate, { id: company.id, name: 'Nom corrigé', duplicate: true });
      assert.deepEqual(data(await f.store.exportBackup()), before);
      assert.equal((await f.store.listCompanies()).length, 1);
    } finally { f.dispose(); }
  });

  test(`${kind}: normalized manual duplicates and concurrent import retries do not create extra records`, async () => {
    const f = fixture(kind);
    try {
      const existing = await f.store.createCompany({ name: 'ATELIER EXEMPLE', website: '', city: 'Montpellier', business: 'Autre activité conservée' });
      await f.store.setAction(existing.id, { text: 'Suivi manuel', date: '' });
      const before = data(await f.store.exportBackup());
      assert.deepEqual(await importCompanyCandidate(f.store, candidate), { id: existing.id, name: existing.name, duplicate: true });
      assert.deepEqual(data(await f.store.exportBackup()), before);
      const other = { ...candidate, name: 'Nouvel atelier', siren: '987654321', siret: '98765432100012' };
      const results = await Promise.all([importCompanyCandidate(f.store, other), importCompanyCandidate(f.store, other), importCompanyCandidate(f.store, other)]);
      assert.equal(results.filter(result => !result.duplicate).length, 1);
      assert.equal(new Set(results.map(result => result.id)).size, 1);
      assert.equal((await f.store.listCompanies()).length, 2);
    } finally { f.dispose(); }
  });

  test(`${kind}: selected enrichment preserves contacts, evidence, score, qualified stage and next action`, async () => {
    const f = fixture(kind);
    try {
      await f.store.saveSettings(target);
      let company = await f.store.createCompany({ name: 'Site qualifié', website: 'https://www.atelier.invalid/', city: target.targetCity, business: target.targetBusiness });
      company = await f.store.updateCompany(company.id, details(company, {
        targetFit: 'yes', problemFound: 'yes', contactAvailable: 'yes', observation: 'Constat manuel précédent.', proofUrl: 'https://atelier.invalid/preuve', observedOn: today, trigger: 'Déclencheur manuel',
        contact: { ...company.contact, email: 'manuel@atelier.invalid', name: 'Camille', role: 'Dirigeante', profileUrl: 'https://atelier.invalid/equipe' },
      }));
      const answers = emptyQualification().answers;
      answers.fit.answer = 'exact';
      answers.problem = { ...answers.problem, answer: 'multiple_or_blocking', description: 'Deux problèmes confirmés manuellement.', observedOn: today, majorReason: 'multiple', distinctProblems: ['Menu masqué', 'Prestations imprécises'], observationKeys: ['mobile', 'services'] };
      answers.trigger = { ...answers.trigger, answer: 'explicit', description: 'Demande reçue.', source: 'Appel avec le prospect.', verifiedOn: today };
      answers.references = { ...answers.references, answer: 'multiple', examples: ['Chantier A', 'Chantier B'], improvement: 'Présenter les réalisations.' };
      answers.access.answer = 'generic';
      company = await f.store.saveQualification(company.id, { answers }, true, captureTarget(target));
      const observations = emptyQualification().observations;
      observations.items.mobile = { answer: 'yes', notes: 'Le menu a été testé manuellement.', sourceUrl: 'https://atelier.invalid/preuve-mobile', observedOn: today };
      observations.items.services = { answer: 'no', notes: 'La page existante convient.', sourceUrl: 'https://atelier.invalid/prestations', observedOn: today };
      observations.googleReviewCount = 20; observations.googleRating = 4.5;
      company = await f.store.saveObservations(company.id, observations);
      const { qualifiedAt: _qualifiedAt, ...exchange } = emptyQualification().afterExchange;
      company = await f.store.saveAfterExchange(company.id, { ...exchange, need: 'confirmed', needNote: 'Besoin exprimé.', solution: 'targeted_improvement', solutionNote: 'Correction utile.', solutionFit: 'confirmed', decision: 'identified', decisionNote: 'La dirigeante décide.', nextStep: { description: 'Définir le périmètre', date: '', accepted: true } });
      company = await f.store.qualifyOpportunity(company.id);
      company = await f.store.setAction(company.id, { text: 'Préparer une proposition', date: '' });
      await f.store.addActivity(company.id, { kind: 'note', type: '', text: 'Une ancienne note à conserver.', date: today });
      company = (await f.store.getCompany(company.id))!;
      const before = structuredClone(company);
      const scoreBefore = evaluateQualification(before, target, today).score;
      assert.ok(scoreBefore !== null);
      const result = await applySiteSuggestions(f.store, company.id, analysis, { contactIndexes: [0, 1], findingIds: ['mobile', 'link-contact'] }, company.updatedAt);
      assert.deepEqual(result, { contactCount: 1, findingCount: 2 });
      const current = (await f.store.getCompany(company.id))!;
      assert.equal(current.contact.email, before.contact.email);
      assert.equal(current.contact.phone, analysis.contacts[1].value);
      assert.equal(current.contact.formUrl, '');
      assert.deepEqual(current.qualification, before.qualification);
      assert.equal(evaluateQualification(current, target, today).score, scoreBefore);
      assert.deepEqual(current.nextAction, before.nextAction);
      assert.equal(current.stage, 'Opportunité qualifiée');
      assert.equal(current.observation, before.observation); assert.equal(current.proofUrl, before.proofUrl); assert.equal(current.observedOn, before.observedOn);
      assert.equal(current.targetFit, before.targetFit); assert.equal(current.problemFound, before.problemFound); assert.equal(current.contactAvailable, before.contactAvailable); assert.equal(current.trigger, before.trigger);
      const notes = await f.store.listActivities(company.id);
      assert.ok(notes.some(activity => activity.text === 'Une ancienne note à conserver.'));
      const note = notes.find(activity => activity.type === 'Analyse automatique du site')!;
      assert.equal(note.date, today); assert.ok(note.text.length <= 10_000);
      assert.ok(note.text.includes(analysis.findings[0].note)); assert.ok(note.text.includes(analysis.findings[2].note));
      assert.ok(note.text.includes(analysis.contacts[1].sourceUrl)); assert.ok(note.text.includes(analysis.findings[2].approach!));
      assert.ok(!note.text.includes(analysis.findings[1].note)); assert.ok(!note.text.includes(analysis.contacts[0].value));
      const backup = data(await f.store.exportBackup());
      assert.deepEqual(await applySiteSuggestions(f.store, company.id, analysis, { contactIndexes: [0, 1], findingIds: ['mobile', 'link-contact'] }, current.updatedAt), { contactCount: 0, findingCount: 0 });
      assert.deepEqual(data(await f.store.exportBackup()), backup);
    } finally { f.dispose(); }
  });

  test(`${kind}: enrichment leaves unknown qualification unknown and keeps opposition and archives`, async () => {
    const f = fixture(kind);
    try {
      const company = await f.store.createCompany({ name: 'Brouillon', website: analysis.website, city: '', business: '' });
      await f.store.setOpposition(company.id, true, 'Ne plus contacter');
      await f.store.setArchived(company.id, true);
      const before = (await f.store.getCompany(company.id))!;
      assert.deepEqual(await applySiteSuggestions(f.store, company.id, analysis, { contactIndexes: [0, 2], findingIds: ['dated-footer'] }, before.updatedAt), { contactCount: 2, findingCount: 1 });
      const current = (await f.store.getCompany(company.id))!;
      assert.deepEqual(current.qualification, before.qualification);
      assert.equal(evaluateQualification(current, target, today).score, null);
      assert.equal(current.contactAvailable, 'unknown'); assert.equal(current.targetFit, 'unknown'); assert.equal(current.problemFound, 'unknown');
      assert.equal(current.oppositionActive, true); assert.equal(current.oppositionDate, before.oppositionDate); assert.equal(current.oppositionNote, before.oppositionNote);
      assert.equal(current.archived, true); assert.equal(current.nextAction, null); assert.equal(current.stage, 'À étudier');
    } finally { f.dispose(); }
  });

  test(`${kind}: stale versions and mismatched sites reject before changing contacts or history`, async () => {
    const f = fixture(kind);
    try {
      let company = await f.store.createCompany({ name: 'Versions', website: analysis.website, city: '', business: '' });
      const staleVersion = company.updatedAt;
      // Storage timestamps have millisecond resolution; ensure the manual edit
      // used in this version test occurs in a distinct millisecond.
      await new Promise(resolve => setTimeout(resolve, 5));
      company = await f.store.updateCompany(company.id, details(company, { city: 'Lyon' }));
      const before = data(await f.store.exportBackup());
      await assert.rejects(applySiteSuggestions(f.store, company.id, analysis, { contactIndexes: [0], findingIds: ['mobile'] }, staleVersion), /fiche a changé/);
      assert.deepEqual(data(await f.store.exportBackup()), before);
      company = await f.store.updateCompany(company.id, details(company, { website: 'https://autre.invalid/' }));
      const changedSite = data(await f.store.exportBackup());
      await assert.rejects(applySiteSuggestions(f.store, company.id, analysis, { contactIndexes: [0], findingIds: ['mobile'] }, company.updatedAt), /site analysé ne correspond/);
      assert.deepEqual(data(await f.store.exportBackup()), changedSite);
    } finally { f.dispose(); }
  });

  test(`${kind}: forged candidates, contacts, sources and selection are rejected without writes`, async () => {
    const f = fixture(kind);
    try {
      const company = await f.store.createCompany({ name: 'Validation', website: analysis.website, city: '', business: '' });
      const before = data(await f.store.exportBackup());
      for (const input of [
        { ...candidate, qualification: { score: 100 }, stage: 'Gagné' },
        { ...candidate, siret: '99999999900001' },
        { ...candidate, sourceUrl: 'javascript:alert(1)' },
      ]) await assert.rejects(importCompanyCandidate(f.store, input as CompanyCandidate));
      const selected = { contactIndexes: [0], findingIds: ['mobile'] };
      for (const input of [
        { ...analysis, contacts: [{ ...analysis.contacts[0], value: 'email invalide' }] },
        { ...analysis, contacts: [{ ...analysis.contacts[0], kind: 'phone', value: 'abc' }] },
        { ...analysis, findings: [{ ...analysis.findings[0], sourceUrl: 'https://unrelated.invalid/' }] },
        { ...analysis, findings: [analysis.findings[0], analysis.findings[0]] },
        { ...analysis, score: 100, stage: 'Gagné' },
        { ...analysis, analyzedOn: '9999-12-31' },
      ]) await assert.rejects(applySiteSuggestions(f.store, company.id, input as SiteAnalysis, selected, company.updatedAt));
      for (const selection of [
        { contactIndexes: [0, 100], findingIds: [] },
        { contactIndexes: [0], findingIds: ['inexistant'] },
        { contactIndexes: [0, 0], findingIds: [] },
        { contactIndexes: [], findingIds: ['mobile', 'mobile'] },
      ]) await assert.rejects(applySiteSuggestions(f.store, company.id, analysis, selection, company.updatedAt));
      assert.deepEqual(data(await f.store.exportBackup()), before);
    } finally { f.dispose(); }
  });

  test(`${kind}: empty selections are inert and oversized evidence is rejected before filling contacts`, async () => {
    const f = fixture(kind);
    try {
      const company = await f.store.createCompany({ name: 'Sélection explicite', website: analysis.website, city: '', business: '' });
      const before = data(await f.store.exportBackup());
      assert.deepEqual(await applySiteSuggestions(f.store, company.id, analysis, { contactIndexes: [], findingIds: [] }, company.updatedAt), { contactCount: 0, findingCount: 0 });
      const largeAnalysis = { ...analysis, findings: Array.from({ length: 6 }, (_, index) => ({ ...analysis.findings[0], id: `large-${index}`, note: String(index) + 'a'.repeat(1900) })) };
      await assert.rejects(applySiteSuggestions(f.store, company.id, largeAnalysis, { contactIndexes: [0], findingIds: largeAnalysis.findings.map(finding => finding.id) }, company.updatedAt), /10 000 caractères/);
      assert.deepEqual(data(await f.store.exportBackup()), before);
    } finally { f.dispose(); }
  });

  test(`${kind}: PageSpeed evidence retains its per-finding approach and rejects reports for another site`, async () => {
    const f = fixture(kind);
    try {
      const company = await f.store.createCompany({ name: 'Rapport', website: analysis.website, city: '', business: '' });
      const sourceUrl = 'https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fatelier.invalid%2F&form_factor=mobile';
      const report: SiteAnalysis = { ...analysis, contacts: [], findings: [{ id: 'pagespeed', key: 'technical', note: 'Audit de performance mobile à vérifier.', sourceUrl, approach: 'Partager le rapport pour proposer une vérification.' }] };
      const before = data(await f.store.exportBackup());
      for (const invalidSource of [
        'https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fautre.invalid%2F',
        'https://pagespeed.web.dev/unrelated?url=https%3A%2F%2Fatelier.invalid%2F',
        'http://pagespeed.web.dev/analysis?url=https%3A%2F%2Fatelier.invalid%2F',
        'https://pagespeed.web.dev.evil.invalid/analysis?url=https%3A%2F%2Fatelier.invalid%2F',
      ]) await assert.rejects(applySiteSuggestions(f.store, company.id, { ...report, findings: [{ ...report.findings[0], sourceUrl: invalidSource }] }, { contactIndexes: [], findingIds: ['pagespeed'] }, company.updatedAt));
      assert.deepEqual(data(await f.store.exportBackup()), before);
      assert.deepEqual(await applySiteSuggestions(f.store, company.id, report, { contactIndexes: [], findingIds: ['pagespeed'] }, company.updatedAt), { contactCount: 0, findingCount: 1 });
      const note = (await f.store.listActivities(company.id)).find(activity => activity.type === 'Analyse automatique du site')!;
      assert.ok(note.text.includes(sourceUrl)); assert.ok(note.text.includes(report.findings[0].approach!));
    } finally { f.dispose(); }
  });

  test(`${kind}: research transaction rejects protected fields, channel replacements and concurrent stale saves`, async () => {
    const f = fixture(kind);
    let second: Store | AsyncCloudStore | undefined;
    try {
      const company = await f.store.createCompany({ name: 'Écriture atomique', website: analysis.website, city: '', business: '' });
      const note = { kind: 'note' as const, type: 'Analyse automatique du site', date: today, text: 'Source : https://atelier.invalid/contact' };
      const before = data(await f.store.exportBackup());
      await assert.rejects(async () => f.store.saveResearch(company.id, details(company, { stage: 'Gagné' }), note, company.updatedAt), /contacts vides/);
      await assert.rejects(async () => f.store.saveResearch(company.id, details(company, { contact: { ...company.contact, name: 'Fausse identité' } }), note, company.updatedAt), /contact existant/);
      assert.deepEqual(data(await f.store.exportBackup()), before);
      second = kind === 'local' ? new Store(f.path) : new AsyncCloudStore(createClient({ url: `file:${f.path}` }));
      // Initialize the second backend before competing write transactions.
      await second.getCompany(company.id);
      const operations = await Promise.allSettled([
        (async () => f.store.saveResearch(company.id, details(company, { contact: { ...company.contact, email: 'premier@atelier.invalid' } }), note, company.updatedAt))(),
        (async () => second!.saveResearch(company.id, details(company, { contact: { ...company.contact, phone: '04 67 00 00 00' } }), note, company.updatedAt))(),
      ]);
      assert.equal(operations.filter(operation => operation.status === 'fulfilled').length, 1);
      const rejection = operations.find(operation => operation.status === 'rejected') as PromiseRejectedResult;
      assert.match(rejection.reason.message, /fiche a changé/);
      const current = (await f.store.getCompany(company.id))!;
      assert.notEqual(current.updatedAt, company.updatedAt);
      assert.equal(Boolean(current.contact.email) !== Boolean(current.contact.phone), true);
      assert.equal((await f.store.listActivities(company.id)).filter(activity => activity.type === note.type).length, 1);
      if (current.contact.email) await assert.rejects(async () => f.store.saveResearch(company.id, details(current, { contact: { ...current.contact, email: 'remplacement@atelier.invalid' } }), note, current.updatedAt), /contact existant/);
      else await assert.rejects(async () => f.store.saveResearch(company.id, details(current, { contact: { ...current.contact, phone: '01 23 45 67 89' } }), note, current.updatedAt), /contact existant/);
    } finally { second?.close(); f.dispose(); }
  });

  test(`${kind}: failed evidence inserts roll back enrichment and imported companies with their source`, async () => {
    const f = fixture(kind);
    let triggerDb: Database.Database | undefined;
    try {
      const company = await f.store.createCompany({ name: 'Rollback', website: analysis.website, city: '', business: '' });
      triggerDb = new Database(f.path);
      triggerDb.exec(`CREATE TRIGGER reject_research BEFORE INSERT ON activities
        WHEN NEW.type IN ('Analyse automatique du site', 'Import Annuaire des entreprises')
        BEGIN SELECT RAISE(ABORT, 'research insert rejected'); END;`);
      const before = data(await f.store.exportBackup());
      await assert.rejects(applySiteSuggestions(f.store, company.id, analysis, { contactIndexes: [0], findingIds: ['mobile'] }, company.updatedAt), /research insert rejected/);
      assert.deepEqual(data(await f.store.exportBackup()), before);
      await assert.rejects(importCompanyCandidate(f.store, candidate), /research insert rejected/);
      assert.deepEqual(data(await f.store.exportBackup()), before);
      triggerDb.exec('DROP TRIGGER reject_research');
      const imported = await importCompanyCandidate(f.store, candidate);
      assert.equal(imported.duplicate, false);
      assert.equal((await f.store.listCompanies()).length, 2);
      assert.equal((await f.store.listActivities(imported.id)).filter(activity => activity.type === 'Import Annuaire des entreprises').length, 1);
    } finally { triggerDb?.close(); f.dispose(); }
  });
}
