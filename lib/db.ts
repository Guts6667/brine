import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  activityInputSchema, aiTestInputSchema, backupSchema, companyDetailsSchema,
  companyInputSchema, hasProfessionalContact, nextActionInputSchema,
  normalizeText, normalizedDomain, parisToday, settingsSchema,
} from './domain';
import { afterExchangeInputSchema, canQualifyOpportunity, captureTarget, emptyQualification, observationsSchema, qualificationDataSchema, qualificationInputSchema, targetSnapshotSchema } from './qualification';
import type { QualificationData, TargetSnapshot } from './qualification-types';
import type { Activity, AiTest, AiTestInput, Backup, Company, CompanyDetails, CompanyInput, Contact, NextAction, Settings } from './types';
import { createClient } from '@libsql/client';
import { AsyncCloudStore } from './cloud-db';

type CompanyRow = Omit<Company, 'contact' | 'nextAction' | 'archived' | 'oppositionActive' | 'qualification'> & { archived: number; oppositionActive: number; qualification: string; commercialStage: string };
const companyColumns = ['id', 'name', 'website', 'city', 'business', 'targetFit', 'problemFound', 'contactAvailable', 'observation', 'proofUrl', 'observedOn', 'trigger', 'stage', 'archived', 'oppositionActive', 'oppositionDate', 'oppositionNote', 'createdAt', 'updatedAt', 'qualification', 'commercialStage'];
const contactColumns = ['name', 'role', 'email', 'phone', 'formUrl', 'profileUrl'] as const;
const aiColumns = ['id', 'companyId', 'panel', 'period', 'tool', 'interface', 'mode', 'model', 'questions', 'validResponses', 'recommendations', 'citations', 'notes', 'proofUrl', 'createdAt'];
const quoted = (columns: readonly string[]) => columns.map((key) => `"${key}"`).join(', ');
const placeholders = (columns: readonly string[]) => columns.map(() => '?').join(', ');
const emptyContact = (): Contact => ({ name: '', role: '', email: '', phone: '', formUrl: '', profileUrl: '' });
const now = () => new Date().toISOString();

function defaultDatabasePath(): string {
  if (process.env.BRINE_DB_PATH || process.env.PICKLES_DB_PATH) return (process.env.BRINE_DB_PATH || process.env.PICKLES_DB_PATH)!;
  const current = join(process.cwd(), 'data', 'brine.sqlite');
  const legacy = join(process.cwd(), 'data', 'pickles.sqlite');
  // Reuse an existing database after the rename; never replace or move saved data.
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

/** One local SQLite connection. All public write methods validate and commit atomically. */
export class Store {
  readonly path: string;
  private readonly db: Database.Database;

  constructor(path = defaultDatabasePath()) {
    this.path = resolve(path);
    if (this.path.split(/[\\/]/).includes('public')) throw new Error('La base doit être conservée hors du dossier public.');
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    if (realpathSync(dirname(this.path)).split(/[\\/]/).includes('public')) throw new Error('La base doit être conservée hors du dossier public.');
    if (existsSync(this.path) && realpathSync(this.path).split(/[\\/]/).includes('public')) throw new Error('La base doit être conservée hors du dossier public.');
    if (!existsSync(this.path)) writeFileSync(this.path, '', { mode: 0o600, flag: 'wx' });
    this.db = new Database(this.path);
    chmodSync(this.path, 0o600);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
    this.secureFiles();
  }

  private secureFiles() {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(this.path + suffix)) chmodSync(this.path + suffix, 0o600);
    }
  }

  private migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, filename TEXT NOT NULL, appliedAt TEXT NOT NULL)');
    const directory = join(process.cwd(), 'migrations');
    const files = readdirSync(directory).filter((file) => /^\d+_[a-z0-9_-]+\.sql$/.test(file)).sort();
    for (const filename of files) {
      const version = Number(filename.split('_')[0]);
      if (this.db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version)) continue;
      this.db.transaction(() => {
        this.db.exec(readFileSync(join(directory, filename), 'utf8'));
        this.db.prepare('INSERT INTO schema_migrations(version, filename, appliedAt) VALUES (?, ?, ?)').run(version, filename, now());
      })();
    }
  }

  close() { this.db.close(); }

  private mapCompany(row: CompanyRow): Company {
    const contact = this.db.prepare('SELECT name, role, email, phone, formUrl, profileUrl FROM contacts WHERE companyId = ?').get(row.id) as Contact | undefined;
    const nextAction = this.db.prepare('SELECT id, text, date, createdAt FROM next_actions WHERE companyId = ?').get(row.id) as NextAction | undefined;
    const { qualification: json, commercialStage, ...base } = row;
    const decoded = JSON.parse(json);
    const qualification = Object.keys(decoded).length ? qualificationDataSchema.parse(decoded) : emptyQualification();
    return { ...base, stage: commercialStage === 'Opportunité qualifiée' ? 'Opportunité qualifiée' : base.stage, qualification, archived: Boolean(row.archived), oppositionActive: Boolean(row.oppositionActive), contact: contact || emptyContact(), nextAction: nextAction || null };
  }

  listCompanies(): Company[] {
    return (this.db.prepare('SELECT * FROM companies ORDER BY updatedAt DESC, id').all() as CompanyRow[]).map((row) => this.mapCompany(row));
  }

  getCompany(id: string): Company | undefined {
    const row = this.db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as CompanyRow | undefined;
    return row ? this.mapCompany(row) : undefined;
  }

  private requireCompany(id: string): Company {
    const company = this.getCompany(id);
    if (!company) throw new Error('Entreprise introuvable.');
    return company;
  }

  private touch(id: string) { this.db.prepare('UPDATE companies SET updatedAt = ? WHERE id = ?').run(now(), id); }

  private insertCompany(company: Company) {
    const values = companyColumns.map((key) => key === 'qualification' ? JSON.stringify(company.qualification || emptyQualification()) : key === 'commercialStage' ? (company.stage === 'Opportunité qualifiée' ? company.stage : '') : key === 'stage' && company.stage === 'Opportunité qualifiée' ? 'En échange' : key === 'archived' ? Number(company.archived) : key === 'oppositionActive' ? Number(company.oppositionActive) : company[key as keyof Company]);
    this.db.prepare(`INSERT INTO companies (${quoted(companyColumns)}) VALUES (${placeholders(companyColumns)})`).run(...values);
    this.db.prepare(`INSERT INTO contacts (companyId, ${quoted(contactColumns)}) VALUES (?, ${placeholders(contactColumns)})`).run(company.id, ...contactColumns.map((key) => company.contact[key]));
    if (company.nextAction) {
      const action = company.nextAction;
      this.db.prepare('INSERT INTO next_actions(id, companyId, text, date, createdAt) VALUES (?, ?, ?, ?, ?)').run(action.id, company.id, action.text, action.date, action.createdAt);
    }
  }

  private insertActivity(activity: Activity) {
    this.db.prepare('INSERT INTO activities(id, companyId, kind, type, date, text, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(activity.id, activity.companyId, activity.kind, activity.type, activity.date, activity.text, activity.createdAt);
  }

  private log(companyId: string, kind: Activity['kind'], text: string, type = '') {
    this.insertActivity({ id: randomUUID(), companyId, kind, type, date: parisToday(), text, createdAt: now() });
  }

  createCompany(input: CompanyInput): Company {
    const parsed = companyInputSchema.parse(input);
    const timestamp = now();
    const company: Company = {
      ...parsed, id: randomUUID(), targetFit: 'unknown', problemFound: 'unknown', contactAvailable: 'unknown',
      observation: '', proofUrl: '', observedOn: '', trigger: '', stage: 'À étudier', archived: false,
      oppositionActive: false, oppositionDate: '', oppositionNote: '', contact: emptyContact(), nextAction: null,
      createdAt: timestamp, updatedAt: timestamp, qualification: emptyQualification(),
    };
    this.db.transaction(() => { this.insertCompany(company); this.log(company.id, 'system', 'Entreprise ajoutée.'); })();
    return this.requireCompany(company.id);
  }

  updateCompany(id: string, input: CompanyDetails): Company {
    return this.db.transaction(() => {
      const before = this.requireCompany(id);
      // Removing the last professional channel cannot leave the legacy affirmative answer behind.
      const normalizedInput = { ...input, contactAvailable: before.contactAvailable === 'yes' && hasProfessionalContact(before.contact) && input.contactAvailable === 'yes' && !hasProfessionalContact(input.contact) ? 'unknown' : input.contactAvailable };
      const parsed = companyDetailsSchema.parse(normalizedInput);
      const enteringQualified = before.stage !== 'Opportunité qualifiée' && parsed.stage === 'Opportunité qualifiée';
      if (enteringQualified && !canQualifyOpportunity({ ...before, ...parsed })) throw new Error('Les conditions après échange doivent être confirmées avant de qualifier cette opportunité.');
      const columns = ['name', 'website', 'city', 'business', 'targetFit', 'problemFound', 'contactAvailable', 'observation', 'proofUrl', 'observedOn', 'trigger', 'stage'] as const;
      const contactChanged = contactColumns.some((key) => before.contact[key] !== parsed.contact[key]);
      const changed = columns.some((key) => before[key] !== parsed[key]) || contactChanged;
      if (!changed) return before;
      const qualification = before.qualification || emptyQualification();
      if (enteringQualified) qualification.afterExchange.qualifiedAt = now();
      this.db.prepare(`UPDATE companies SET ${columns.map((key) => `"${key}" = ?`).join(', ')}, commercialStage = ?, qualification = ?, updatedAt = ? WHERE id = ?`).run(...columns.map((key) => key === 'stage' && parsed.stage === 'Opportunité qualifiée' ? 'En échange' : parsed[key]), parsed.stage === 'Opportunité qualifiée' ? parsed.stage : '', JSON.stringify(qualification), now(), id);
      this.db.prepare(`UPDATE contacts SET ${contactColumns.map((key) => `"${key}" = ?`).join(', ')} WHERE companyId = ?`).run(...contactColumns.map((key) => parsed.contact[key]), id);
      if (before.stage !== parsed.stage) this.log(id, 'system', `Étape modifiée : ${before.stage} → ${parsed.stage}.`);
      if (columns.filter((key) => key !== 'stage').some((key) => before[key] !== parsed[key]) || contactChanged) this.log(id, 'system', before.contactAvailable === 'yes' && parsed.contactAvailable === 'unknown' && !hasProfessionalContact(parsed.contact) ? 'Fiche modifiée. Dernier canal supprimé : contact à vérifier.' : 'Informations de la fiche mises à jour.');
      return this.requireCompany(id);
    }).immediate();
  }

  qualifyOpportunity(id: string): Company {
    return this.db.transaction(() => {
      const company = this.requireCompany(id);
      if (!canQualifyOpportunity(company)) throw new Error('Les conditions après échange doivent être confirmées avant de qualifier cette opportunité.');
      const qualification = company.qualification || emptyQualification();
      if (company.stage === 'Opportunité qualifiée' && qualification.afterExchange.qualifiedAt) return company;
      qualification.afterExchange.qualifiedAt = now();
      this.db.prepare('UPDATE companies SET stage = ?, commercialStage = ?, qualification = ?, updatedAt = ? WHERE id = ?').run('En échange', 'Opportunité qualifiée', JSON.stringify(qualification), now(), id);
      this.log(id, 'system', `Étape modifiée explicitement : ${company.stage} → Opportunité qualifiée.`);
      return this.requireCompany(id);
    }).immediate();
  }

  private saveQualificationData(id: string, update: (company: Company) => QualificationData, message: string): Company {
    return this.db.transaction(() => {
      const company = this.requireCompany(id);
      const previous = company.qualification || emptyQualification();
      const qualification = qualificationDataSchema.parse(update(company));
      if (JSON.stringify(previous) === JSON.stringify(qualification)) return company;
      this.db.prepare('UPDATE companies SET qualification = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(qualification), now(), id);
      this.log(id, 'system', message);
      return this.requireCompany(id);
    }).immediate();
  }

  saveQualification(id: string, input: unknown, confirmTarget: boolean, expectedTarget?: TargetSnapshot): Company {
    if (typeof confirmTarget !== 'boolean') throw new Error('Confirmez explicitement la cible utilisée.');
    const parsed = qualificationInputSchema.parse(input);
    const expected = confirmTarget && expectedTarget !== undefined ? targetSnapshotSchema.parse(expectedTarget) : undefined;
    return this.saveQualificationData(id, (company) => {
      const current = company.qualification || emptyQualification();
      const target = confirmTarget ? captureTarget(this.getSettings()) : current.targetSnapshot;
      if (confirmTarget && (!expected || !target || (Object.keys(target) as (keyof TargetSnapshot)[]).some(key => expected[key] !== target[key]))) {
        throw new Error('La cible a changé depuis l’ouverture de la fiche. Actualisez la page avant de confirmer cette évaluation.');
      }
      return { ...current, answers: parsed.answers, targetSnapshot: target };
    }, 'Qualification de prospection enregistrée.');
  }

  saveObservations(id: string, input: unknown): Company {
    const parsed = observationsSchema.parse(input);
    return this.saveQualificationData(id, (company) => ({ ...(company.qualification || emptyQualification()), observations: parsed }), 'Constats manuels du site mis à jour.');
  }

  saveAfterExchange(id: string, input: unknown): Company {
    const parsed = afterExchangeInputSchema.parse(input);
    return this.saveQualificationData(id, (company) => {
      const current = company.qualification || emptyQualification();
      return { ...current, afterExchange: { ...parsed, qualifiedAt: current.afterExchange.qualifiedAt } };
    }, 'Informations après échange mises à jour.');
  }

  findDuplicates(input: CompanyInput, excludeId?: string): { id: string; name: string }[] {
    const parsed = companyInputSchema.parse(input);
    const domain = normalizedDomain(parsed.website);
    const name = normalizeText(parsed.name);
    const city = normalizeText(parsed.city);
    return this.listCompanies().filter((company) => company.id !== excludeId && ((Boolean(domain) && normalizedDomain(company.website) === domain) || (normalizeText(company.name) === name && normalizeText(company.city) === city))).map(({ id, name }) => ({ id, name }));
  }

  private assertCurrentAction(company: Company, expectedId?: string | null) {
    if (expectedId !== undefined && expectedId !== (company.nextAction?.id || null)) {
      throw new Error('Cette action a changé depuis l’ouverture de la page. Actualisez la fiche avant de réessayer.');
    }
  }

  setAction(id: string, input: { text: string; date: string }, expectedId?: string | null): Company {
    const parsed = nextActionInputSchema.parse(input);
    return this.db.transaction(() => {
      const company = this.requireCompany(id);
      this.assertCurrentAction(company, expectedId);
      if (company.oppositionActive) throw new Error('Cette entreprise est marquée « Ne plus contacter ». Désactivez explicitement cette opposition avant de prévoir une action.');
      if (company.nextAction?.text === parsed.text && company.nextAction.date === parsed.date) return company;
      // The ID represents the version displayed to the user, so an old button cannot affect a newer action.
      this.db.prepare('INSERT INTO next_actions(id, companyId, text, date, createdAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(companyId) DO UPDATE SET id = excluded.id, text = excluded.text, date = excluded.date').run(randomUUID(), id, parsed.text, parsed.date, company.nextAction?.createdAt || now());
      this.touch(id);
      this.log(id, 'system', `${company.nextAction ? 'Prochaine action modifiée' : 'Action planifiée'} : ${parsed.text}${parsed.date ? ` (${parsed.date})` : ' (à planifier)'}.`);
      return this.requireCompany(id);
    }).immediate();
  }

  completeAction(id: string, expectedId?: string | null): void {
    this.db.transaction(() => {
      const company = this.requireCompany(id);
      this.assertCurrentAction(company, expectedId);
      if (!company.nextAction) throw new Error('Aucune action à terminer.');
      const action = company.nextAction;
      this.log(id, 'action_done', `${action.text}${action.date ? ` — échéance initiale : ${action.date}` : ''}`, 'Action terminée');
      this.db.prepare('DELETE FROM next_actions WHERE companyId = ?').run(id);
      this.touch(id);
    }).immediate();
  }

  postponeAction(id: string, date: string, expectedId?: string | null): void {
    this.db.transaction(() => {
      const company = this.requireCompany(id);
      this.assertCurrentAction(company, expectedId);
      if (company.oppositionActive) throw new Error('Une opposition active empêche la planification.');
      if (!company.nextAction) throw new Error('Aucune action à reporter.');
      const parsed = nextActionInputSchema.parse({ text: company.nextAction.text, date });
      if (parsed.date === company.nextAction.date) return;
      this.db.prepare('UPDATE next_actions SET id = ?, date = ? WHERE companyId = ?').run(randomUUID(), parsed.date, id);
      this.log(id, 'action_rescheduled', `${company.nextAction.text} — ${company.nextAction.date || 'sans date'} → ${parsed.date || 'à planifier'}`, 'Action reportée');
      this.touch(id);
    }).immediate();
  }

  addActivity(id: string, input: { kind: 'note' | 'exchange'; type: string; date: string; text: string }): void {
    this.requireCompany(id);
    const parsed = activityInputSchema.parse(input);
    this.db.transaction(() => {
      this.insertActivity({ ...parsed, id: randomUUID(), companyId: id, createdAt: now() });
      this.touch(id);
    })();
  }

  listActivities(id: string): Activity[] {
    this.requireCompany(id);
    return this.db.prepare('SELECT * FROM activities WHERE companyId = ? ORDER BY createdAt DESC, rowid DESC').all(id) as Activity[];
  }

  private insertAiTest(test: AiTest) {
    this.db.prepare(`INSERT INTO ai_tests (${quoted(aiColumns)}) VALUES (${placeholders(aiColumns)})`).run(...aiColumns.map((key) => test[key as keyof AiTest]));
  }

  addAiTest(id: string, input: AiTestInput): void {
    this.requireCompany(id);
    const parsed = aiTestInputSchema.parse(input);
    this.db.transaction(() => {
      this.insertAiTest({ ...parsed, id: randomUUID(), companyId: id, createdAt: now() });
      this.touch(id);
    })();
  }

  listAiTests(id: string): AiTest[] {
    this.requireCompany(id);
    return this.db.prepare('SELECT * FROM ai_tests WHERE companyId = ? ORDER BY createdAt DESC, rowid DESC').all(id) as AiTest[];
  }

  setArchived(id: string, archived: boolean): void {
    if (typeof archived !== 'boolean') throw new Error('Choix d’archivage invalide.');
    const company = this.requireCompany(id);
    if (company.archived === archived) return;
    this.db.transaction(() => {
      this.db.prepare('UPDATE companies SET archived = ?, updatedAt = ? WHERE id = ?').run(Number(archived), now(), id);
      this.log(id, 'system', archived ? 'Entreprise archivée.' : 'Entreprise désarchivée.');
    })();
  }

  setOpposition(id: string, active: boolean, note = '', confirmed = false): void {
    if (typeof active !== 'boolean' || typeof note !== 'string' || note.length > 5000) throw new Error('Opposition invalide.');
    const company = this.requireCompany(id);
    if (!active && confirmed !== true) throw new Error('Confirmez explicitement la réactivation du contact.');
    this.db.transaction(() => {
      const date = active && !company.oppositionActive ? parisToday() : company.oppositionDate;
      this.db.prepare('UPDATE companies SET oppositionActive = ?, oppositionDate = ?, oppositionNote = ?, updatedAt = ? WHERE id = ?').run(Number(active), date, note.trim(), now(), id);
      if (active) this.db.prepare('DELETE FROM next_actions WHERE companyId = ?').run(id);
      this.log(id, 'system', active ? `Ne plus contacter : opposition enregistrée${company.nextAction ? ', action annulée' : ''}.${note.trim() ? ` ${note.trim()}` : ''}` : 'Opposition désactivée après confirmation explicite.');
    })();
  }

  getSettings(): Settings {
    return this.db.prepare('SELECT targetCity, targetBusiness, targetCompanyType, targetOffer, targetExclusions FROM settings WHERE id = 1').get() as Settings;
  }

  saveSettings(input: Settings): void {
    this.db.transaction(() => {
      const current = this.getSettings();
      const settings = settingsSchema.parse({ ...input, targetCompanyType: input.targetCompanyType ?? current.targetCompanyType, targetOffer: input.targetOffer ?? current.targetOffer, targetExclusions: input.targetExclusions ?? current.targetExclusions });
      this.db.prepare('UPDATE settings SET targetCity = ?, targetBusiness = ?, targetCompanyType = ?, targetOffer = ?, targetExclusions = ? WHERE id = 1').run(settings.targetCity, settings.targetBusiness, settings.targetCompanyType, settings.targetOffer, settings.targetExclusions);
    }).immediate();
  }

  exportBackup(): Backup {
    return this.db.transaction(() => ({
      schemaVersion: 2 as const, exportedAt: now(), companies: this.listCompanies(),
      activities: this.db.prepare('SELECT * FROM activities ORDER BY createdAt, rowid').all() as Activity[],
      aiTests: this.db.prepare('SELECT * FROM ai_tests ORDER BY createdAt, rowid').all() as AiTest[],
      settings: this.getSettings(),
    }))();
  }

  private validateBackup(raw: unknown): Backup {
    const backup = backupSchema.parse(raw) as Backup;
    const companies = new Set(backup.companies.map(({ id }) => id));
    if (companies.size !== backup.companies.length) throw new Error('Identifiants d’entreprises dupliqués dans la sauvegarde.');
    const actionIds = backup.companies.flatMap(({ nextAction }) => nextAction ? [nextAction.id] : []);
    if (new Set(actionIds).size !== actionIds.length) throw new Error('Identifiants d’actions dupliqués dans la sauvegarde.');
    for (const entries of [backup.activities, backup.aiTests]) {
      if (new Set(entries.map(({ id }) => id)).size !== entries.length) throw new Error('Identifiants dupliqués dans la sauvegarde.');
      if (entries.some(({ companyId }) => !companies.has(companyId))) throw new Error('Relation vers une entreprise absente de la sauvegarde.');
    }
    return backup;
  }

  previewBackup(raw: unknown): { companies: number; activities: number; aiTests: number; oppositions: number } {
    const backup = this.validateBackup(raw);
    return { companies: backup.companies.length, activities: backup.activities.length, aiTests: backup.aiTests.length, oppositions: backup.companies.filter(({ oppositionActive }) => oppositionActive).length };
  }

  /** Restore replaces the saved data, but cannot reactivate an existing opposition. */
  restoreBackup(raw: unknown, confirmed: boolean): { backupPath: string; preservedOppositions: number } {
    if (confirmed !== true) throw new Error('Confirmez le remplacement des données avant la restauration.');
    const incoming = this.validateBackup(raw); // Validate every record before a backup or any mutation.
    return this.db.transaction(() => {
      const existing = this.exportBackup();
      const opposed = existing.companies.filter(({ oppositionActive }) => oppositionActive);
      const preservedIds = new Set<string>();
      const importedCompanyIds = new Set(incoming.companies.map(({ id }) => id));
      for (const company of incoming.companies) {
        const matches = opposed.filter((prior) => prior.id === company.id || (Boolean(normalizedDomain(prior.website)) && normalizedDomain(prior.website) === normalizedDomain(company.website)) || (normalizeText(prior.name) === normalizeText(company.name) && normalizeText(prior.city) === normalizeText(company.city)));
        if (!matches.length) continue;
        const prior = matches.find(({ id }) => id === company.id) || matches[0];
        company.oppositionActive = true;
        company.oppositionDate = prior.oppositionDate;
        company.oppositionNote = prior.oppositionNote;
        company.updatedAt = now();
        company.nextAction = null;
        preservedIds.add(company.id);
        incoming.activities.push({ id: randomUUID(), companyId: company.id, kind: 'system', type: 'Restauration', date: parisToday(), text: 'Opposition déjà enregistrée conservée lors de la restauration. Aucune relance réactivée.', createdAt: now() });
      }
      // Absent opposed companies remain archived, with their contacts and complete history.
      for (const company of opposed) {
        if (importedCompanyIds.has(company.id)) continue;
        // Keep the existing company identity even if an imported child reuses that ID.
        for (const importedCompany of incoming.companies) {
          if (importedCompany.nextAction?.id === company.id) importedCompany.nextAction.id = randomUUID();
        }
        for (const entry of [...incoming.activities, ...incoming.aiTests]) if (entry.id === company.id) entry.id = randomUUID();
        incoming.companies.push({ ...company, archived: true, nextAction: null, updatedAt: now() });
        const usedIds = new Set([
          ...incoming.companies.flatMap((entry) => [entry.id, ...(entry.nextAction ? [entry.nextAction.id] : [])]),
          ...incoming.activities.map(({ id }) => id), ...incoming.aiTests.map(({ id }) => id),
        ]);
        const retainId = (id: string) => { const nextId = usedIds.has(id) ? randomUUID() : id; usedIds.add(nextId); return nextId; };
        incoming.activities.push(...existing.activities.filter(({ companyId }) => companyId === company.id).map((entry) => ({ ...entry, id: retainId(entry.id) })));
        incoming.aiTests.push(...existing.aiTests.filter(({ companyId }) => companyId === company.id).map((entry) => ({ ...entry, id: retainId(entry.id) })));
        incoming.activities.push({ id: randomUUID(), companyId: company.id, kind: 'system', type: 'Restauration', date: parisToday(), text: 'Fiche absente de la sauvegarde conservée et archivée pour préserver son opposition.', createdAt: now() });
        preservedIds.add(company.id);
      }
      const backupDirectory = join(dirname(this.path), 'backups');
      mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
      if (realpathSync(backupDirectory).split(/[\\/]/).includes('public')) throw new Error('Les sauvegardes doivent être conservées hors du dossier public.');
      chmodSync(backupDirectory, 0o700);
      const backupPath = join(backupDirectory, `avant-restauration-${now().replace(/[:.]/g, '-')}-${randomUUID()}.json`);
      writeFileSync(backupPath, JSON.stringify(existing, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      this.db.transaction(() => {
        this.db.prepare('DELETE FROM companies').run(); // Child rows cascade in this same transaction.
        for (const company of incoming.companies) this.insertCompany(company);
        for (const activity of incoming.activities) this.insertActivity(activity);
        for (const test of incoming.aiTests) this.insertAiTest(test);
        this.saveSettings(incoming.settings);
      })();
      this.secureFiles();
      return { backupPath, preservedOppositions: preservedIds.size };
    }).immediate(); // Lock writers before reading the oppositions that must be preserved.
  }
}

const storeGlobal = globalThis as typeof globalThis & { brineStore?: Store; brineCloudStore?: AsyncCloudStore };
export function isCloudStorage(): boolean { return Boolean(process.env.TURSO_DATABASE_URL); }
export function getStore(): Store | AsyncCloudStore {
  if (process.env.TURSO_DATABASE_URL) {
    if (!process.env.TURSO_AUTH_TOKEN) throw new Error('Le stockage distant doit être configuré.');
    return storeGlobal.brineCloudStore ||= new AsyncCloudStore(createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }));
  }
  if (process.env.VERCEL === '1') throw new Error('Le stockage distant doit être configuré.');
  return storeGlobal.brineStore ||= new Store();
}
