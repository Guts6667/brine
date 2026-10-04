import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client, type Transaction, type InStatement } from '@libsql/client';
import { AsyncCloudStore } from '../lib/cloud-db';
import { cloudMigrations } from '../lib/cloud-schema';
import { backupSchema, qualify } from '../lib/domain';
import type { AiTestInput, Backup, Company, CompanyDetails } from '../lib/types';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'brine-cloud-adapter-'));
  const url = `file:${join(directory, 'cloud.sqlite')}`;
  let client = createClient({ url }), store = new AsyncCloudStore(client);
  const extraClients: Client[] = [];
  return {
    get client() { return client; }, get store() { return store; },
    reopen() { store.close(); client = createClient({ url }); store = new AsyncCloudStore(client); return store; },
    second() { const extra = createClient({ url }); extraClients.push(extra); return new AsyncCloudStore(extra); },
    dispose() { store.close(); for (const extra of extraClients) extra.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}
const create = (store: AsyncCloudStore, name = 'Entreprise de test') => store.createCompany({ name, website: '', city: '', business: '' });
const details = (company: Company, patch: Partial<CompanyDetails> = {}): CompanyDetails => ({
  name: company.name, website: company.website, city: company.city, business: company.business,
  targetFit: company.targetFit, problemFound: company.problemFound, contactAvailable: company.contactAvailable,
  observation: company.observation, proofUrl: company.proofUrl, observedOn: company.observedOn,
  trigger: company.trigger, stage: company.stage, contact: { ...company.contact }, ...patch,
});
const sampleTest = (patch: Partial<AiTestInput> = {}): AiTestInput => ({ panel: 'Rénovation', period: '2026-10-03', tool: 'ChatGPT', interface: 'Application web', mode: 'web', model: '', questions: 'Quels artisans à Montpellier ?', validResponses: 10, recommendations: 2, citations: 1, notes: '', proofUrl: '', ...patch });
const data = ({ exportedAt: _date, ...backup }: Backup) => backup;

test('embedded cloud migration matches the versioned local schema', () => {
  assert.equal(cloudMigrations[0].sql.trim(), readFileSync(join(process.cwd(), 'migrations/001_initial.sql'), 'utf8').trim());
});

test('cloud adapter starts empty, saves name-only companies and persists over a fresh client', async () => {
  const f = fixture();
  try {
    assert.deepEqual(await f.store.listCompanies(), []);
    assert.deepEqual(await f.store.getSettings(), { targetCity: 'Montpellier', targetBusiness: 'Rénovation intérieure', targetCompanyType: '', targetOffer: '', targetExclusions: '' });
    const company = await create(f.store, "L'atelier");
    assert.equal(qualify(company).label, 'À vérifier');
    assert.equal(company.city, ''); assert.equal(company.business, ''); assert.equal(company.nextAction, null);
    await f.store.saveSettings({ targetCity: 'Lyon', targetBusiness: 'Menuiserie' });
    assert.deepEqual(await f.reopen().getCompany(company.id), company);
    assert.deepEqual(await f.store.getSettings(), { targetCity: 'Lyon', targetBusiness: 'Menuiserie', targetCompanyType: '', targetOffer: '', targetExclusions: '' });
    const migrations = await f.client.execute('SELECT version FROM schema_migrations ORDER BY version');
    assert.deepEqual(migrations.rows.map(({ version }) => version), [1, 2, 3, 4]);
  } finally { f.dispose(); }
});

test('cloud qualification recalculates on contact removal, while notes and AI keep stages manual', async () => {
  const f = fixture();
  try {
    let company = await create(f.store);
    await assert.rejects(f.store.updateCompany(company.id, details(company, { contactAvailable: 'yes' })));
    company = await f.store.updateCompany(company.id, details(company, { targetFit: 'yes', problemFound: 'yes', observation: 'Le formulaire ne fonctionne pas.', contactAvailable: 'yes', contact: { ...company.contact, email: 'contact@example.com' } }));
    assert.equal(qualify(company).label, 'Bonne piste');
    await f.store.addActivity(company.id, { kind: 'exchange', type: 'Appel', date: '2026-10-03', text: 'Compte rendu.' });
    await f.store.addAiTest(company.id, sampleTest());
    assert.equal((await f.store.getCompany(company.id))!.stage, 'À étudier');
    company = await f.store.updateCompany(company.id, details(company, { contact: { ...company.contact, email: '' } }));
    assert.equal(company.contactAvailable, 'unknown');
    assert.equal(qualify(company).label, 'Contact à trouver');
    await f.store.setArchived(company.id, true); await f.store.setArchived(company.id, false);
    assert.ok((await f.store.listActivities(company.id)).some(({ text }) => text === 'Compte rendu.'));
    assert.equal((await f.store.listAiTests(company.id)).length, 1);
  } finally { f.dispose(); }
});

test('cloud action version guards reject stale complete/report/edit and preserve meaningful history', async () => {
  const f = fixture();
  try {
    const company = await create(f.store);
    const first = (await f.store.setAction(company.id, { text: 'Appeler', date: '2026-10-03' }, null)).nextAction!;
    const second = (await f.store.setAction(company.id, { text: 'Envoyer le devis', date: '2026-10-05' }, first.id)).nextAction!;
    assert.notEqual(second.id, first.id);
    await assert.rejects(f.store.completeAction(company.id, first.id), /action a changé/);
    await assert.rejects(f.store.postponeAction(company.id, '2026-10-10', first.id), /action a changé/);
    await assert.rejects(f.store.setAction(company.id, { text: 'Écrasement périmé', date: '' }, null), /action a changé/);
    await f.store.postponeAction(company.id, '2026-10-10', second.id);
    const current = (await f.store.getCompany(company.id))!.nextAction!;
    assert.notEqual(current.id, second.id);
    await assert.rejects(f.store.completeAction(company.id, second.id), /action a changé/);
    await f.store.completeAction(company.id, current.id);
    assert.equal((await f.store.getCompany(company.id))!.nextAction, null);
    const activities = await f.store.listActivities(company.id);
    assert.equal(activities.filter(({ kind }) => kind === 'action_done').length, 1);
    assert.ok(activities.some(({ kind }) => kind === 'action_rescheduled'));
  } finally { f.dispose(); }
});

test('cloud opposition cancels relance and survives archives, edits and fresh clients until confirmation', async () => {
  const f = fixture();
  try {
    const company = await create(f.store);
    await f.store.setAction(company.id, { text: 'Relancer', date: '' });
    await f.store.setOpposition(company.id, true, 'Demande explicite');
    assert.equal((await f.store.getCompany(company.id))!.nextAction, null);
    await assert.rejects(f.store.setAction(company.id, { text: 'Relance interdite', date: '' }), /opposition/i);
    await assert.rejects(f.store.setOpposition(company.id, false), /Confirmez/);
    await f.store.setArchived(company.id, true); await f.store.setArchived(company.id, false);
    await f.store.updateCompany(company.id, details((await f.store.getCompany(company.id))!, { stage: 'En échange' }));
    assert.equal((await f.reopen().getCompany(company.id))!.oppositionActive, true);
    await f.store.setOpposition(company.id, false, '', true);
    assert.equal((await f.store.getCompany(company.id))!.oppositionActive, false);
  } finally { f.dispose(); }
});

test('cloud AI counts are validated server-side and incomplete measures remain null', async () => {
  const f = fixture();
  try {
    const company = await create(f.store);
    await f.store.addAiTest(company.id, sampleTest());
    for (const patch of [{ recommendations: 12 }, { citations: 11 }, { validResponses: -1 }, { validResponses: 1.5 }]) await assert.rejects(f.store.addAiTest(company.id, sampleTest(patch)));
    await f.store.addAiTest(company.id, sampleTest({ validResponses: null, recommendations: null, citations: null }));
    const tests = await f.store.listAiTests(company.id);
    assert.equal(tests.length, 2); assert.equal(tests[0].validResponses, null); assert.equal(tests[1].recommendations, 2);
  } finally { f.dispose(); }
});

test('cloud JSON restoration preserves relations and creates a retrievable private recovery snapshot', async () => {
  const f = fixture();
  try {
    let company = await create(f.store);
    company = await f.store.updateCompany(company.id, details(company, { contact: { ...company.contact, phone: '04 67 00 00 00' }, contactAvailable: 'yes' }));
    await f.store.setAction(company.id, { text: 'Appeler', date: '2026-10-10' });
    await f.store.addActivity(company.id, { kind: 'note', type: '', date: '', text: 'Texte <script>inoffensif</script>' });
    await f.store.addAiTest(company.id, sampleTest());
    const snapshot = await f.store.exportBackup();
    assert.doesNotThrow(() => backupSchema.parse(snapshot));
    assert.deepEqual(await f.store.previewBackup(snapshot), { companies: 1, activities: snapshot.activities.length, aiTests: 1, oppositions: 0 });
    await create(f.store, 'À remplacer');
    const before = await f.store.exportBackup();
    const result = await f.store.restoreBackup(snapshot, true);
    assert.equal(result.preservedOppositions, 0); assert.match(result.backupPath, /^cloud:/);
    assert.deepEqual(data(await f.store.exportBackup()), data(snapshot));
    assert.deepEqual(data((await f.store.getRecoveryBackup(result.backupPath))!), data(before));
    assert.equal((await f.store.listRecoveryBackups()).length, 1);
    assert.deepEqual(data(await f.reopen().exportBackup()), data(snapshot));
    assert.deepEqual(data((await f.store.getRecoveryBackup(result.backupPath))!), data(before));
    assert.equal(await f.store.getRecoveryBackup('missing'), undefined);
  } finally { f.dispose(); }
});

test('cloud invalid restoration or missing confirmation changes no rows or recovery records', async () => {
  const f = fixture();
  try {
    const company = await create(f.store); await f.store.setAction(company.id, { text: 'Appeler', date: '' });
    const snapshot = await f.store.exportBackup();
    for (const invalid of [{ ...snapshot, schemaVersion: 99 }, { ...snapshot, activities: [{ ...snapshot.activities[0], companyId: 'missing' }] }, { ...snapshot, companies: [...snapshot.companies, snapshot.companies[0]] }]) {
      await assert.rejects(f.store.previewBackup(invalid)); await assert.rejects(f.store.restoreBackup(invalid, true));
    }
    await assert.rejects(f.store.restoreBackup(snapshot, false), /Confirmez/);
    assert.deepEqual(data(await f.store.exportBackup()), data(snapshot)); assert.deepEqual(await f.store.listRecoveryBackups(), []);
  } finally { f.dispose(); }
});

test('cloud replacement preserves existing opposition by ID, domain and retained absent company history', async () => {
  const f = fixture();
  try {
    const company = await f.store.createCompany({ name: 'Opposée', website: 'https://www.partage.example/fr', city: 'Montpellier', business: '' });
    await f.store.setAction(company.id, { text: 'Ancienne relance', date: '2026-10-10' });
    const old = await f.store.exportBackup();
    await f.store.addActivity(company.id, { kind: 'note', type: '', date: '', text: 'Histoire conservée' });
    await f.store.addAiTest(company.id, sampleTest()); await f.store.setOpposition(company.id, true, 'Refus explicite');
    await f.store.restoreBackup(old, true);
    assert.equal((await f.store.getCompany(company.id))!.oppositionActive, true);
    assert.equal((await f.store.getCompany(company.id))!.nextAction, null);
    // Re-add a recent note/test so retaining an absent company also tests complete relations.
    await f.store.addActivity(company.id, { kind: 'note', type: '', date: '', text: 'Histoire conservée' }); await f.store.addAiTest(company.id, sampleTest());
    const replacement = { ...old.companies[0], id: 'replacement', website: 'https://partage.example/contact', nextAction: null };
    const result = await f.store.restoreBackup({ ...old, companies: [replacement], activities: [], aiTests: [] }, true);
    assert.equal(result.preservedOppositions, 2);
    assert.equal((await f.store.getCompany('replacement'))!.oppositionActive, true);
    assert.equal((await f.store.getCompany(company.id))!.archived, true);
    assert.ok((await f.store.listActivities(company.id)).some(({ text }) => text === 'Histoire conservée'));
    assert.equal((await f.store.listAiTests(company.id)).length, 1);
    const finalSnapshot = await f.store.exportBackup();
    assert.doesNotThrow(() => backupSchema.parse(finalSnapshot));
  } finally { f.dispose(); }
});

test('cloud SQLite failure rolls back replacement and its private recovery snapshot atomically', async () => {
  const f = fixture();
  try {
    const company = await create(f.store); await f.store.setAction(company.id, { text: 'Action préservée', date: '' });
    await f.store.addActivity(company.id, { kind: 'note', type: '', date: '', text: 'Note préservée' }); await f.store.addAiTest(company.id, sampleTest());
    const before = await f.store.exportBackup();
    await f.client.execute("CREATE TRIGGER simulate_failure BEFORE INSERT ON companies WHEN NEW.name = '__FAIL__' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END");
    await assert.rejects(f.store.restoreBackup({ ...before, companies: [{ ...before.companies[0], name: '__FAIL__' }] }, true), /simulated write failure/);
    assert.deepEqual(data(await f.store.exportBackup()), data(before)); assert.deepEqual(await f.store.listRecoveryBackups(), []);
    assert.deepEqual(data(await f.reopen().exportBackup()), data(before));
  } finally { f.dispose(); }
});

test('separate cloud adapter instances modify rows without replacing each others companies', async () => {
  const f = fixture();
  try {
    const second = f.second();
    const firstCompany = await create(f.store, 'Première'); const secondCompany = await create(second, 'Seconde');
    await f.store.addActivity(firstCompany.id, { kind: 'note', type: '', date: '', text: 'Première note' });
    await second.addActivity(secondCompany.id, { kind: 'note', type: '', date: '', text: 'Seconde note' });
    assert.equal((await f.store.listCompanies()).length, 2);
    assert.ok((await second.listActivities(firstCompany.id)).some(({ text }) => text === 'Première note'));
    assert.ok((await f.store.listActivities(secondCompany.id)).some(({ text }) => text === 'Seconde note'));
    assert.deepEqual(await second.findDuplicates({ name: ' première ', website: '', city: '', business: '' }), [{ id: firstCompany.id, name: firstCompany.name }]);
    const awaitBackup = await f.store.exportBackup();
    assert.doesNotThrow(() => backupSchema.parse(awaitBackup));
  } finally { f.dispose(); }
});


test('concurrent cloud writes retain every new company and compare action versions inside the write lock', async () => {
  const f = fixture();
  try {
    const other = f.second();
    await f.store.getSettings(); await other.getSettings();
    const companies = await Promise.all([
      create(f.store, 'Concurrente A'), create(f.store, 'Concurrente B'), create(other, 'Concurrente C'),
    ]);
    assert.equal((await f.store.listCompanies()).length, 3);
    const company = companies[0];
    const initial = (await f.store.setAction(company.id, { text: 'Action initiale', date: '' }, null)).nextAction!;
    const attempts = await Promise.allSettled([
      f.store.setAction(company.id, { text: 'Modification A', date: '2026-10-10' }, initial.id),
      other.setAction(company.id, { text: 'Modification B', date: '2026-10-11' }, initial.id),
    ]);
    assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
    const failure = attempts.find(({ status }) => status === 'rejected') as PromiseRejectedResult;
    assert.match(String(failure.reason), /action a changé/);
    const winner = attempts.find(({ status }) => status === 'fulfilled') as PromiseFulfilledResult<Company>;
    assert.deepEqual((await other.getCompany(company.id))!.nextAction, winner.value.nextAction);
    const completed = await Promise.allSettled([
      f.store.completeAction(company.id, winner.value.nextAction!.id),
      other.completeAction(company.id, winner.value.nextAction!.id),
    ]);
    assert.equal(completed.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal((await f.store.listActivities(company.id)).filter(({ kind }) => kind === 'action_done').length, 1);
  } finally { f.dispose(); }
});


test('cloud lock failures roll back partial writes; ambiguous network commits are never replayed', async () => {
  const f = fixture();
  try {
    let fault: 'busy' | 'network' | null = null, begins = 0, rollbacks = 0;
    const proxy = new Proxy(f.client, {
      get(target, key) {
        if (key === 'protocol') return 'http';
        if (key === 'transaction') return async (mode: 'write' | 'read' | 'deferred') => {
          begins++;
          const tx = await target.transaction(mode);
          return new Proxy(tx, {
            get(transaction, property) {
              if (property === 'batch') return async (statements: InStatement[]) => {
                if (fault === 'busy') {
                  fault = null; await transaction.execute(statements[0]);
                  throw Object.assign(new Error('temporary database lock'), { code: 'SQLITE_BUSY' });
                }
                return transaction.batch(statements);
              };
              if (property === 'commit') return async () => {
                await transaction.commit();
                if (fault === 'network') { fault = null; throw Object.assign(new Error('commit response lost'), { code: 'NETWORK_ERROR' }); }
              };
              if (property === 'rollback') return async () => { rollbacks++; await transaction.rollback(); };
              const value = Reflect.get(transaction, property, transaction);
              return typeof value === 'function' ? value.bind(transaction) : value;
            },
          }) as Transaction;
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as Client;
    const store = new AsyncCloudStore(proxy);
    await store.getSettings();
    begins = 0; fault = 'busy';
    await create(store, 'Verrou transitoire');
    assert.equal(begins, 2); assert.equal(rollbacks, 1);
    assert.equal((await store.listCompanies()).filter(({ name }) => name === 'Verrou transitoire').length, 1);
    begins = 0; fault = 'network';
    await assert.rejects(create(store, 'Confirmation réseau perdue'), /commit response lost/);
    assert.equal(begins, 1);
    assert.equal((await store.listCompanies()).filter(({ name }) => name === 'Confirmation réseau perdue').length, 1);
    const original = await create(store, 'Opposition retenue');
    await store.setOpposition(original.id, true, 'Opposition explicite');
    const empty = { schemaVersion: 1, exportedAt: new Date().toISOString(), companies: [], activities: [], aiTests: [], settings: await store.getSettings() };
    fault = 'busy';
    await store.restoreBackup(empty, true);
    const activities = await store.listActivities(original.id);
    assert.equal(activities.filter(({ text }) => text === 'Fiche absente de la sauvegarde conservée et archivée pour préserver son opposition.').length, 1);
    assert.equal((await store.listRecoveryBackups()).length, 1);
    const final = await store.exportBackup();
    assert.doesNotThrow(() => backupSchema.parse(final));
  } finally { f.dispose(); }
});
