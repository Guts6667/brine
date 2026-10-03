import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/db';
import Database from 'better-sqlite3';
import type { AiTestInput, Backup, Company, CompanyDetails } from '../lib/types';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'brine-storage-'));
  const path = join(directory, 'brine.sqlite');
  let store = new Store(path);
  return {
    directory, path, get store() { return store; },
    reopen() { store.close(); store = new Store(path); return store; },
    dispose() { store.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}
const details = (company: Company, patch: Partial<CompanyDetails> = {}): CompanyDetails => ({
  name: company.name, website: company.website, city: company.city, business: company.business,
  targetFit: company.targetFit, problemFound: company.problemFound, contactAvailable: company.contactAvailable,
  observation: company.observation, proofUrl: company.proofUrl, observedOn: company.observedOn,
  trigger: company.trigger, stage: company.stage, contact: { ...company.contact }, ...patch,
});
const sampleTest = (patch: Partial<AiTestInput> = {}): AiTestInput => ({ panel: 'Rénovation', period: '2026-10-03', tool: 'ChatGPT', interface: 'Application web', mode: 'web', model: '', questions: 'Quels artisans à Montpellier ?', validResponses: 10, recommendations: 2, citations: 1, notes: '', proofUrl: '', ...patch });
const create = (store: Store, name = 'Entreprise de test') => store.createCompany({ name, website: '', city: '', business: '' });

function withoutExportDate(backup: Backup) { const { exportedAt: _date, ...data } = backup; return data; }

test('name-only company persists empty facts and default settings after reopening', () => {
  const f = fixture();
  try {
    const company = create(f.store, "L'atelier de Rayan");
    assert.equal(company.name, "L'atelier de Rayan");
    assert.equal(company.city, '');
    assert.equal(company.business, '');
    assert.equal(company.targetFit, 'unknown');
    assert.equal(company.contactAvailable, 'unknown');
    assert.equal(company.stage, 'À étudier');
    assert.equal(company.nextAction, null);
    assert.deepEqual(f.store.getSettings(), { targetCity: 'Montpellier', targetBusiness: 'Rénovation intérieure' });
    f.store.saveSettings({ targetCity: 'Lyon', targetBusiness: 'Menuiserie' });
    f.reopen();
    assert.deepEqual(f.store.getCompany(company.id), company);
    assert.deepEqual(f.store.getSettings(), { targetCity: 'Lyon', targetBusiness: 'Menuiserie' });
    assert.equal(statSync(f.path).mode & 0o777, 0o600);
  } finally { f.dispose(); }
});

test('qualification, primary contact, one action and meaningful history stay coherent', () => {
  const f = fixture();
  try {
    let company = create(f.store);
    assert.throws(() => f.store.updateCompany(company.id, details(company, { contactAvailable: 'yes' })));
    company = f.store.updateCompany(company.id, details(company, {
      targetFit: 'yes', problemFound: 'yes', contactAvailable: 'yes', observation: 'Le formulaire de contact ne fonctionne pas.',
      contact: { ...company.contact, email: 'contact@example.com' },
    }));
    assert.equal(company.contact.email, 'contact@example.com');
    assert.equal(company.contactAvailable, 'yes');
    company = f.store.setAction(company.id, { text: 'Appeler', date: '2026-10-03' });
    const actionId = company.nextAction!.id;
    company = f.store.setAction(company.id, { text: 'Présenter le constat', date: '2026-10-04' });
    assert.notEqual(company.nextAction!.id, actionId);
    f.store.postponeAction(company.id, '2026-10-05');
    assert.equal(f.store.getCompany(company.id)!.nextAction!.date, '2026-10-05');
    f.store.completeAction(company.id);
    assert.equal(f.store.getCompany(company.id)!.nextAction, null);
    assert.ok(f.store.listActivities(company.id).some(({ kind, text }) => kind === 'action_done' && text.includes('Présenter le constat')));
    assert.ok(f.store.listActivities(company.id).some(({ kind }) => kind === 'action_rescheduled'));
    company = f.store.getCompany(company.id)!;
    company = f.store.updateCompany(company.id, details(company, { contact: { ...company.contact, email: '' } }));
    assert.equal(company.contactAvailable, 'unknown');
    assert.equal(company.targetFit, 'yes');
    f.reopen();
    assert.equal(f.store.getCompany(company.id)!.contactAvailable, 'unknown');
    assert.ok(f.store.listActivities(company.id).some(({ kind }) => kind === 'action_done'));
  } finally { f.dispose(); }
});

test('archive is reversible, stages stay manual, opposition cancels and blocks actions until confirmed', () => {
  const f = fixture();
  try {
    const company = create(f.store);
    f.store.addActivity(company.id, { kind: 'note', type: '', date: '', text: '<script>alert("x")</script>' });
    f.store.addActivity(company.id, { kind: 'exchange', type: 'Appel', date: '2026-10-03', text: 'Échange initial.' });
    f.store.addAiTest(company.id, sampleTest());
    assert.equal(f.store.getCompany(company.id)!.stage, 'À étudier');
    f.store.setArchived(company.id, true);
    f.store.setArchived(company.id, false);
    assert.equal(f.store.getCompany(company.id)!.archived, false);
    assert.ok(f.store.listActivities(company.id).some(({ text }) => text === '<script>alert("x")</script>'));
    f.store.setAction(company.id, { text: 'Relancer', date: '2026-10-10' });
    f.store.setOpposition(company.id, true, 'Demande reçue par téléphone');
    assert.equal(f.store.getCompany(company.id)!.nextAction, null);
    assert.ok(f.store.getCompany(company.id)!.oppositionDate);
    assert.throws(() => f.store.setAction(company.id, { text: 'Relancer', date: '2026-10-11' }), /opposition/i);
    assert.throws(() => f.store.setOpposition(company.id, false), /Confirmez/);
    f.store.setArchived(company.id, true);
    f.store.setArchived(company.id, false);
    f.store.updateCompany(company.id, details(f.store.getCompany(company.id)!, { stage: 'En échange' }));
    assert.equal(f.store.getCompany(company.id)!.oppositionActive, true);
    f.store.setOpposition(company.id, false, '', true);
    assert.equal(f.store.getCompany(company.id)!.oppositionActive, false);
    f.store.setAction(company.id, { text: 'Nouvelle action', date: '' });
    assert.equal(f.store.getCompany(company.id)!.nextAction!.date, '');
  } finally { f.dispose(); }
});

test('server AI validation refuses 12/10, negative, fractional and invalid citations; incomplete remains unknown', () => {
  const f = fixture();
  try {
    const company = create(f.store);
    f.store.addAiTest(company.id, sampleTest());
    assert.equal(f.store.listAiTests(company.id)[0].recommendations, 2);
    for (const patch of [{ recommendations: 12 }, { citations: 11 }, { validResponses: -1 }, { validResponses: 2.5 }, { recommendations: -1 }]) {
      assert.throws(() => f.store.addAiTest(company.id, sampleTest(patch)));
    }
    f.store.addAiTest(company.id, sampleTest({ validResponses: 0, recommendations: 0, citations: 0 }));
    f.store.addAiTest(company.id, sampleTest({ validResponses: null, recommendations: null, citations: null, mode: 'unknown' }));
    assert.equal(f.store.listAiTests(company.id).length, 3);
    f.reopen();
    assert.equal(f.store.listAiTests(company.id).length, 3);
  } finally { f.dispose(); }
});

test('duplicate warnings normalize domains or name and city but never merge records', () => {
  const f = fixture();
  try {
    const company = f.store.createCompany({ name: 'Société Élan', website: 'https://www.example.com/page', city: 'Montpellier', business: '' });
    assert.deepEqual(f.store.findDuplicates({ name: 'Autre', website: 'https://example.com/other', city: '', business: '' }), [{ id: company.id, name: company.name }]);
    assert.deepEqual(f.store.findDuplicates({ name: 'societe elan', website: '', city: ' MONTPELLIER ', business: '' }), [{ id: company.id, name: company.name }]);
    assert.equal(f.store.findDuplicates({ name: company.name, website: company.website, city: company.city, business: '' }, company.id).length, 0);
    create(f.store, company.name);
    assert.equal(f.store.listCompanies().length, 2);
  } finally { f.dispose(); }
});

test('backup preview and restore retain contacts, action, notes, tests and settings; pre-backup private', () => {
  const f = fixture();
  try {
    let company = create(f.store, 'Sauvegardée');
    company = f.store.updateCompany(company.id, details(company, { contact: { ...company.contact, phone: '04 67 00 00 00' }, contactAvailable: 'yes', stage: 'En échange' }));
    f.store.setAction(company.id, { text: 'Appeler', date: '2026-10-08' });
    f.store.addActivity(company.id, { kind: 'exchange', type: 'Appel', date: '2026-10-03', text: 'Disponible jeudi.' });
    f.store.addAiTest(company.id, sampleTest());
    f.store.saveSettings({ targetCity: 'Bordeaux', targetBusiness: 'Artisanat' });
    const snapshot = f.store.exportBackup();
    assert.deepEqual(f.store.previewBackup(snapshot), { companies: 1, activities: snapshot.activities.length, aiTests: 1, oppositions: 0 });
    create(f.store, 'À remplacer');
    const beforeRestore = withoutExportDate(f.store.exportBackup());
    const result = f.store.restoreBackup(snapshot, true);
    assert.equal(result.preservedOppositions, 0);
    assert.deepEqual(withoutExportDate(f.store.exportBackup()), withoutExportDate(snapshot));
    assert.deepEqual(withoutExportDate(JSON.parse(readFileSync(result.backupPath, 'utf8')) as Backup), beforeRestore);
    assert.equal(statSync(result.backupPath).mode & 0o777, 0o600);
    f.reopen();
    assert.deepEqual(withoutExportDate(f.store.exportBackup()), withoutExportDate(snapshot));
  } finally { f.dispose(); }
});

test('invalid restore and missing confirmation leave all data unchanged before any snapshot', () => {
  const f = fixture();
  try {
    const company = create(f.store);
    f.store.setAction(company.id, { text: 'Appeler', date: '2026-10-10' });
    const snapshot = f.store.exportBackup();
    const invalids = [
      { ...snapshot, schemaVersion: 999 },
      { ...snapshot, companies: [...snapshot.companies, snapshot.companies[0]] },
      { ...snapshot, activities: [{ ...snapshot.activities[0], companyId: 'absent' }] },
      { ...snapshot, companies: [{ ...snapshot.companies[0], website: 'javascript:alert(1)' }] },
      { ...snapshot, aiTests: [{ ...sampleTest({ recommendations: 12 }), id: 'invalid', companyId: company.id, createdAt: new Date().toISOString() }] },
    ];
    for (const invalid of invalids) {
      assert.throws(() => f.store.previewBackup(invalid));
      assert.throws(() => f.store.restoreBackup(invalid, true));
      assert.deepEqual(withoutExportDate(f.store.exportBackup()), withoutExportDate(snapshot));
    }
    assert.throws(() => f.store.restoreBackup(snapshot, false), /Confirmez/);
    assert.equal(readdirSync(f.directory).includes('backups'), false);
  } finally { f.dispose(); }
});

test('restoration preserves opposition by ID and blocks an older backup action', () => {
  const f = fixture();
  try {
    const company = create(f.store);
    f.store.setAction(company.id, { text: 'Ancienne relance', date: '2026-10-10' });
    const snapshot = f.store.exportBackup();
    f.store.setOpposition(company.id, true, 'Opposition récente');
    const result = f.store.restoreBackup(snapshot, true);
    const restored = f.store.getCompany(company.id)!;
    assert.equal(result.preservedOppositions, 1);
    assert.equal(restored.oppositionActive, true);
    assert.equal(restored.oppositionNote, 'Opposition récente');
    assert.equal(restored.nextAction, null);
    assert.throws(() => f.store.setAction(company.id, { text: 'Relance', date: '2026-10-10' }));
    assert.ok(f.store.listActivities(company.id).some(({ text }) => text.includes('Opposition déjà enregistrée')));
    assert.doesNotThrow(() => f.store.previewBackup(f.store.exportBackup()));
  } finally { f.dispose(); }
});

test('restoration preserves matching domain/name-city oppositions and absent companies with complete history', () => {
  const f = fixture();
  try {
    const first = f.store.createCompany({ name: 'Opposée', website: 'https://www.partage.example/fr', city: 'Montpellier', business: '' });
    f.store.addActivity(first.id, { kind: 'note', type: '', date: '', text: 'Historique à préserver.' });
    f.store.addAiTest(first.id, sampleTest());
    f.store.setOpposition(first.id, true, 'Ne plus relancer');
    const empty: Backup = { schemaVersion: 1, exportedAt: new Date().toISOString(), companies: [], activities: [], aiTests: [], settings: f.store.getSettings() };
    f.store.restoreBackup(empty, true);
    assert.equal(f.store.getCompany(first.id)!.archived, true);
    assert.equal(f.store.getCompany(first.id)!.oppositionActive, true);
    assert.ok(f.store.listActivities(first.id).some(({ text }) => text === 'Historique à préserver.'));
    assert.equal(f.store.listAiTests(first.id).length, 1);
    const replacement = { ...first, id: 'replacement', website: 'https://partage.example/contact', oppositionActive: false, oppositionDate: '', oppositionNote: '', archived: false };
    const incoming = { ...empty, companies: [replacement] };
    const result = f.store.restoreBackup(incoming, true);
    assert.equal(f.store.getCompany('replacement')!.oppositionActive, true);
    assert.equal(f.store.getCompany(first.id)!.oppositionActive, true);
    assert.equal(result.preservedOppositions, 2);
    assert.ok(f.store.listActivities(first.id).some(({ text }) => text === 'Historique à préserver.'));
    assert.doesNotThrow(() => f.store.previewBackup(f.store.exportBackup()));
    const sameName = { ...replacement, id: 'new-name-match', website: '', name: ' opposée ', city: ' MONTPELLIER ' };
    f.store.restoreBackup({ ...empty, companies: [sameName] }, true);
    assert.equal(f.store.getCompany('new-name-match')!.oppositionActive, true);
  } finally { f.dispose(); }
});


test('a SQLite failure during replacement rolls back all relations and keeps the pre-restore snapshot', () => {
  const f = fixture();
  try {
    const company = create(f.store);
    f.store.setAction(company.id, { text: 'Action préservée', date: '2026-10-10' });
    f.store.addActivity(company.id, { kind: 'note', type: '', date: '', text: 'Note préservée' });
    f.store.addAiTest(company.id, sampleTest());
    const before = f.store.exportBackup();
    const raw = new Database(f.path);
    raw.exec("CREATE TRIGGER simulate_disk_failure BEFORE INSERT ON companies WHEN NEW.name = '__FAIL__' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END");
    raw.close();
    const failing = { ...before, companies: [{ ...before.companies[0], name: '__FAIL__' }] };
    assert.throws(() => f.store.restoreBackup(failing, true), /simulated write failure/);
    assert.deepEqual(withoutExportDate(f.store.exportBackup()), withoutExportDate(before));
    const backups = readdirSync(join(f.directory, 'backups'));
    assert.equal(backups.length, 1);
    assert.deepEqual(withoutExportDate(JSON.parse(readFileSync(join(f.directory, 'backups', backups[0]), 'utf8')) as Backup), withoutExportDate(before));
    f.reopen();
    assert.deepEqual(withoutExportDate(f.store.exportBackup()), withoutExportDate(before));
  } finally { f.dispose(); }
});


test('database refuses paths or file symlinks exposing data inside public', () => {
  const directory = mkdtempSync(join(tmpdir(), 'brine-private-'));
  try {
    const publicDirectory = join(directory, 'public');
    mkdirSync(publicDirectory);
    const exposedPath = join(publicDirectory, 'exposed.sqlite');
    writeFileSync(exposedPath, '');
    assert.throws(() => new Store(exposedPath), /hors du dossier public/);
    const fileAlias = join(directory, 'alias.sqlite');
    symlinkSync(exposedPath, fileAlias);
    assert.throws(() => new Store(fileAlias), /hors du dossier public/);
    const directoryAlias = join(directory, 'data');
    symlinkSync(publicDirectory, directoryAlias);
    assert.throws(() => new Store(join(directoryAlias, 'new.sqlite')), /hors du dossier public/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('stale action buttons cannot complete, postpone or replace a newer action', () => {
  const f = fixture();
  try {
    const company = create(f.store);
    const first = f.store.setAction(company.id, { text: 'Appeler', date: '2026-10-03' }, null).nextAction!;
    const second = f.store.setAction(company.id, { text: 'Envoyer la proposition', date: '2026-10-05' }, first.id).nextAction!;
    assert.notEqual(second.id, first.id);
    assert.throws(() => f.store.completeAction(company.id, first.id), /action a changé/);
    assert.throws(() => f.store.postponeAction(company.id, '2026-10-10', first.id), /action a changé/);
    assert.throws(() => f.store.setAction(company.id, { text: 'Ancienne modification', date: '' }, first.id), /action a changé/);
    assert.throws(() => f.store.setAction(company.id, { text: 'Action créée depuis une vieille page vide', date: '' }, null), /action a changé/);
    assert.deepEqual(f.store.getCompany(company.id)!.nextAction, second);
    f.store.postponeAction(company.id, '2026-10-10', second.id);
    const postponed = f.store.getCompany(company.id)!.nextAction!;
    assert.notEqual(postponed.id, second.id);
    assert.throws(() => f.store.completeAction(company.id, second.id), /action a changé/);
    f.store.completeAction(company.id, postponed.id);
    assert.equal(f.store.getCompany(company.id)!.nextAction, null);
    assert.throws(() => f.store.postponeAction(company.id, '2026-10-11', postponed.id), /action a changé/);
    assert.equal(f.store.listActivities(company.id).filter(({ kind }) => kind === 'action_done').length, 1);
    assert.ok(f.store.listActivities(company.id).find(({ kind, text }) => kind === 'action_done' && text.includes('Envoyer la proposition')));
  } finally { f.dispose(); }
});


test('a backups symlink into public cannot expose the pre-restore snapshot', () => {
  const f = fixture();
  try {
    create(f.store);
    const before = f.store.exportBackup();
    const publicDirectory = join(f.directory, 'public');
    mkdirSync(publicDirectory);
    symlinkSync(publicDirectory, join(f.directory, 'backups'));
    assert.throws(() => f.store.restoreBackup({ ...before, companies: [], activities: [], aiTests: [] }, true), /hors du dossier public/);
    assert.deepEqual(withoutExportDate(f.store.exportBackup()), withoutExportDate(before));
    assert.deepEqual(readdirSync(publicDirectory), []);
  } finally { f.dispose(); }
});
