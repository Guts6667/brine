import { campaignSelects, campaignSnapshot, campaignRestoreStatements } from './campaign-backup';
import type { Client, InStatement, InValue, Row, Transaction, TransactionMode } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import {
  activityInputSchema, aiTestInputSchema, backupSchema, companyDetailsSchema,
  companyInputSchema, hasProfessionalContact, nextActionInputSchema,
  normalizeText, normalizedDomain, parisToday, settingsSchema,
} from './domain';
import { cloudMigrations } from './cloud-schema';
import { afterExchangeInputSchema, canQualifyOpportunity, captureTarget, emptyQualification, observationsSchema, qualificationDataSchema, qualificationInputSchema, targetSnapshotSchema } from './qualification';
import type { QualificationData, TargetSnapshot } from './qualification-types';
import type { Activity, AiTest, AiTestInput, Backup, Company, CompanyDetails, CompanyInput, Contact, NextAction, Settings } from './types';

type CompanyRow = Omit<Company, 'contact' | 'nextAction' | 'archived' | 'oppositionActive' | 'qualification'> & { archived: number; oppositionActive: number; qualification: string; commercialStage: string };
const companyColumns = ['id', 'name', 'website', 'city', 'business', 'targetFit', 'problemFound', 'contactAvailable', 'observation', 'proofUrl', 'observedOn', 'trigger', 'stage', 'archived', 'oppositionActive', 'oppositionDate', 'oppositionNote', 'createdAt', 'updatedAt', 'qualification', 'commercialStage'];
const contactColumns = ['name', 'role', 'email', 'phone', 'formUrl', 'profileUrl'] as const;
const aiColumns = ['id', 'companyId', 'panel', 'period', 'tool', 'interface', 'mode', 'model', 'questions', 'validResponses', 'recommendations', 'citations', 'notes', 'proofUrl', 'createdAt'];
const quoted = (columns: readonly string[]) => columns.map((key) => `"${key}"`).join(', ');
const placeholders = (columns: readonly string[]) => columns.map(() => '?').join(', ');
const emptyContact = (): Contact => ({ name: '', role: '', email: '', phone: '', formUrl: '', profileUrl: '' });
const now = () => new Date().toISOString();
// The native file driver runs synchronously and cannot wait for another JS transaction to yield.
// This gate is used only by file-backed adapter tests; remote clients rely on database write locks.
let fileTransactions: Promise<void> = Promise.resolve();
const statement = (sql: string, args: InValue[] = []): InStatement => ({ sql, args });
const activityStatement = (activity: Activity) => statement('INSERT INTO activities(id, companyId, kind, type, date, text, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)', [activity.id, activity.companyId, activity.kind, activity.type, activity.date, activity.text, activity.createdAt]);
const logStatement = (companyId: string, kind: Activity['kind'], text: string, type = '') => activityStatement({ id: randomUUID(), companyId, kind, type, date: parisToday(), text, createdAt: now() });
const touchStatement = (id: string) => statement('UPDATE companies SET updatedAt = ? WHERE id = ?', [now(), id]);
const aiStatement = (test: AiTest) => statement(`INSERT INTO ai_tests (${quoted(aiColumns)}) VALUES (${placeholders(aiColumns)})`, aiColumns.map((key) => test[key as keyof AiTest]));
const aiFromRow = (row: Row): AiTest => ({ ...row, validResponses: row.validResponses === null ? null : Number(row.validResponses), recommendations: row.recommendations === null ? null : Number(row.recommendations), citations: row.citations === null ? null : Number(row.citations) }) as unknown as AiTest;
function companyStatements(company: Company): InStatement[] {
  const values = companyColumns.map((key) => key === 'qualification' ? JSON.stringify(company.qualification || emptyQualification()) : key === 'commercialStage' ? (company.stage === 'Opportunité qualifiée' ? company.stage : '') : key === 'stage' && company.stage === 'Opportunité qualifiée' ? 'En échange' : key === 'archived' ? Number(company.archived) : key === 'oppositionActive' ? Number(company.oppositionActive) : company[key as keyof Company]) as InValue[];
  return [
    statement(`INSERT INTO companies (${quoted(companyColumns)}) VALUES (${placeholders(companyColumns)})`, values),
    statement(`INSERT INTO contacts (companyId, ${quoted(contactColumns)}) VALUES (?, ${placeholders(contactColumns)})`, [company.id, ...contactColumns.map((key) => company.contact[key])]),
    ...(company.nextAction ? [statement('INSERT INTO next_actions(id, companyId, text, date, createdAt) VALUES (?, ?, ?, ?, ?)', [company.nextAction.id, company.id, company.nextAction.text, company.nextAction.date, company.nextAction.createdAt])] : []),
  ];
}

/** Durable normalized SQL storage; every mutation is protected by a database write transaction. */
export class AsyncCloudStore {
  private initialized?: Promise<void>;
  constructor(private readonly client: Client) {}
  close(): void { this.client.close(); }

  private ready(): Promise<void> {
    return this.initialized ||= this.initialize().catch((error) => { this.initialized = undefined; throw error; });
  }

  private async initialize(): Promise<void> {
    if (this.client.protocol === 'file') await this.client.execute('PRAGMA journal_mode = WAL');
    const tx = await this.client.transaction('write');
    try {
      await tx.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, filename TEXT NOT NULL, appliedAt TEXT NOT NULL)');
      for (const migration of cloudMigrations) {
        const existing = await tx.execute(statement('SELECT filename FROM schema_migrations WHERE version = ?', [migration.version]));
        if (existing.rows.length) {
          if (existing.rows[0].filename !== migration.filename) throw new Error('La version de la base ne correspond pas aux migrations attendues.');
          continue;
        }
        await tx.executeMultiple(migration.sql);
        await tx.execute(statement('INSERT INTO schema_migrations(version, filename, appliedAt) VALUES (?, ?, ?)', [migration.version, migration.filename, now()]));
      }
      await tx.commit();
    } finally { tx.close(); }
  }

  private transact<T>(mode: TransactionMode, work: (tx: Transaction) => Promise<T>): Promise<T> {
    if (this.client.protocol !== 'file') return this.runTransaction(mode, work);
    const operation = fileTransactions.then(() => this.runTransaction(mode, work));
    fileTransactions = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async runTransaction<T>(mode: TransactionMode, work: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let tx: Transaction | undefined;
      try {
        await this.ready();
        tx = await this.client.transaction(mode);
        const result = await work(tx);
        await tx.commit();
        return result;
      } catch (error) {
        if (tx && !tx.closed) await tx.rollback().catch(() => undefined);
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        const locked = code === 'SQLITE_BUSY' || code.startsWith('SQLITE_BUSY_') || code === 'SQLITE_LOCKED' || code.startsWith('SQLITE_LOCKED_');
        // Only definite SQLite lock failures are retried after rollback. An uncertain network commit is never replayed.
        if (!locked || attempt >= 4) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
      } finally { tx?.close(); }
    }
  }

  private async companies(tx: Transaction, id?: string): Promise<Company[]> {
    const where = id === undefined ? '' : ' WHERE companyId = ?';
    const args = id === undefined ? [] : [id];
    const results = await tx.batch([
      statement(`SELECT * FROM companies${id === undefined ? ' ORDER BY updatedAt DESC, id' : ' WHERE id = ?'}`, args),
      statement(`SELECT companyId, ${quoted(contactColumns)} FROM contacts${where}`, args),
      statement(`SELECT companyId, id, text, date, createdAt FROM next_actions${where}`, args),
    ]);
    const contacts = new Map(results[1].rows.map((row) => {
      const { companyId, ...contact } = row;
      return [String(companyId), contact as unknown as Contact] as const;
    }));
    const actions = new Map(results[2].rows.map((row) => {
      const { companyId, ...action } = row;
      return [String(companyId), action as unknown as NextAction] as const;
    }));
    return results[0].rows.map((row) => {
      const { qualification: json, commercialStage, ...company } = row as unknown as CompanyRow;
      const decoded = JSON.parse(json);
      const qualification = Object.keys(decoded).length ? qualificationDataSchema.parse(decoded) : emptyQualification();
      return { ...company, stage: commercialStage === 'Opportunité qualifiée' ? 'Opportunité qualifiée' : company.stage, qualification, archived: Number(company.archived) === 1, oppositionActive: Number(company.oppositionActive) === 1, contact: contacts.get(company.id) || emptyContact(), nextAction: actions.get(company.id) || null };
    });
  }

  private async requireCompany(tx: Transaction, id: string): Promise<Company> {
    const company = (await this.companies(tx, id))[0];
    if (!company) throw new Error('Entreprise introuvable.');
    return company;
  }

  listCompanies(): Promise<Company[]> { return this.transact('read', (tx) => this.companies(tx)); }
  getCompany(id: string): Promise<Company | undefined> { return this.transact('read', async (tx) => (await this.companies(tx, id))[0]); }

  async createCompany(input: CompanyInput, source?: { kind: 'note'; type: string; date: string; text: string }): Promise<Company> {
    const parsed = companyInputSchema.parse(input);
    const sourceNote = source === undefined ? undefined : activityInputSchema.parse(source);
    if (sourceNote && (sourceNote.kind !== 'note' || sourceNote.text.length > 10000)) throw new Error('La source doit être une note de 10 000 caractères maximum.');
    const timestamp = now();
    const company: Company = { ...parsed, id: randomUUID(), targetFit: 'unknown', problemFound: 'unknown', contactAvailable: 'unknown', observation: '', proofUrl: '', observedOn: '', trigger: '', stage: 'À étudier', archived: false, oppositionActive: false, oppositionDate: '', oppositionNote: '', contact: emptyContact(), nextAction: null, createdAt: timestamp, updatedAt: timestamp, qualification: emptyQualification() };
    return this.transact('write', async (tx) => {
      await tx.batch([...companyStatements(company), logStatement(company.id, 'system', 'Entreprise ajoutée.'),
        ...(sourceNote ? [activityStatement({ ...sourceNote, id: randomUUID(), companyId: company.id, createdAt: timestamp })] : []),
      ]);
      return this.requireCompany(tx, company.id);
    });
  }

  /** Add research evidence and previously empty contact channels in one commit. */
  saveResearch(id: string, input: CompanyDetails, note: { kind: 'note'; type: string; date: string; text: string }, expectedUpdatedAt: string): Promise<Company> {
    const parsed = companyDetailsSchema.parse(input);
    const activity = activityInputSchema.parse(note);
    if (activity.kind !== 'note' || activity.text.length > 10000) throw new Error('La recherche doit être une note de 10 000 caractères maximum.');
    return this.transact('write', async tx => {
      const before = await this.requireCompany(tx, id);
      if (before.updatedAt !== expectedUpdatedAt) throw new Error('La fiche a changé depuis l’analyse. Actualisez-la et relancez l’analyse.');
      const protectedFields = ['name', 'website', 'city', 'business', 'targetFit', 'problemFound', 'contactAvailable', 'observation', 'proofUrl', 'observedOn', 'trigger', 'stage'] as const;
      if (protectedFields.some(key => parsed[key] !== before[key])) throw new Error('La recherche ne peut modifier que les contacts vides et son historique.');
      if (contactColumns.some(key => parsed.contact[key] !== before.contact[key] && (before.contact[key].trim() || !['email', 'phone', 'formUrl'].includes(key)))) throw new Error('La recherche ne peut remplacer un contact existant.');
      const contactChanged = contactColumns.some(key => parsed.contact[key] !== before.contact[key]);
      const timestamp = new Date(Math.max(Date.now(), Date.parse(before.updatedAt) + 1)).toISOString();
      await tx.batch([
        ...(contactChanged ? [
          statement(`UPDATE contacts SET ${contactColumns.map(key => `"${key}" = ?`).join(', ')} WHERE companyId = ?`, [...contactColumns.map(key => parsed.contact[key]), id]),
          logStatement(id, 'system', 'Contacts proposés par la recherche ajoutés.'),
        ] : []),
        activityStatement({ ...activity, id: randomUUID(), companyId: id, createdAt: now() }), statement('UPDATE companies SET updatedAt = ? WHERE id = ?', [timestamp, id]),
      ]);
      return this.requireCompany(tx, id);
    });
  }

  updateCompany(id: string, input: CompanyDetails): Promise<Company> {
    return this.transact('write', async (tx) => {
      const before = await this.requireCompany(tx, id);
      const normalized = { ...input, contactAvailable: before.contactAvailable === 'yes' && hasProfessionalContact(before.contact) && input.contactAvailable === 'yes' && !hasProfessionalContact(input.contact) ? 'unknown' : input.contactAvailable };
      const parsed = companyDetailsSchema.parse(normalized);
      const enteringQualified = before.stage !== 'Opportunité qualifiée' && parsed.stage === 'Opportunité qualifiée';
      if (enteringQualified && !canQualifyOpportunity({ ...before, ...parsed })) throw new Error('Les conditions après échange doivent être confirmées avant de qualifier cette opportunité.');
      const columns = ['name', 'website', 'city', 'business', 'targetFit', 'problemFound', 'contactAvailable', 'observation', 'proofUrl', 'observedOn', 'trigger', 'stage'] as const;
      const contactChanged = contactColumns.some((key) => before.contact[key] !== parsed.contact[key]);
      if (!contactChanged && !columns.some((key) => before[key] !== parsed[key])) return before;
      const qualification = before.qualification || emptyQualification();
      if (enteringQualified) qualification.afterExchange.qualifiedAt = now();
      const statements = [
        statement(`UPDATE companies SET ${columns.map((key) => `"${key}" = ?`).join(', ')}, commercialStage = ?, qualification = ?, updatedAt = ? WHERE id = ?`, [...columns.map((key) => key === 'stage' && parsed.stage === 'Opportunité qualifiée' ? 'En échange' : parsed[key]), parsed.stage === 'Opportunité qualifiée' ? parsed.stage : '', JSON.stringify(qualification), now(), id]),
        statement(`UPDATE contacts SET ${contactColumns.map((key) => `"${key}" = ?`).join(', ')} WHERE companyId = ?`, [...contactColumns.map((key) => parsed.contact[key]), id]),
      ];
      if (before.stage !== parsed.stage) statements.push(logStatement(id, 'system', `Étape modifiée : ${before.stage} → ${parsed.stage}.`));
      if (contactChanged || columns.filter((key) => key !== 'stage').some((key) => before[key] !== parsed[key])) statements.push(logStatement(id, 'system', before.contactAvailable === 'yes' && parsed.contactAvailable === 'unknown' && !hasProfessionalContact(parsed.contact) ? 'Fiche modifiée. Dernier canal supprimé : contact à vérifier.' : 'Informations de la fiche mises à jour.'));
      await tx.batch(statements);
      return this.requireCompany(tx, id);
    });
  }

  qualifyOpportunity(id: string): Promise<Company> {
    return this.transact('write', async (tx) => {
      const company = await this.requireCompany(tx, id);
      if (!canQualifyOpportunity(company)) throw new Error('Les conditions après échange doivent être confirmées avant de qualifier cette opportunité.');
      const qualification = company.qualification || emptyQualification();
      if (company.stage === 'Opportunité qualifiée' && qualification.afterExchange.qualifiedAt) return company;
      qualification.afterExchange.qualifiedAt = now();
      await tx.batch([statement('UPDATE companies SET stage = ?, commercialStage = ?, qualification = ?, updatedAt = ? WHERE id = ?', ['En échange', 'Opportunité qualifiée', JSON.stringify(qualification), now(), id]), logStatement(id, 'system', `Étape modifiée explicitement : ${company.stage} → Opportunité qualifiée.`)]);
      return this.requireCompany(tx, id);
    });
  }

  private saveQualificationData(id: string, update: (tx: Transaction, company: Company) => QualificationData | Promise<QualificationData>, message: string): Promise<Company> {
    return this.transact('write', async (tx) => {
      const company = await this.requireCompany(tx, id);
      const previous = company.qualification || emptyQualification();
      const qualification = qualificationDataSchema.parse(await update(tx, company));
      if (JSON.stringify(previous) === JSON.stringify(qualification)) return company;
      await tx.batch([statement('UPDATE companies SET qualification = ?, updatedAt = ? WHERE id = ?', [JSON.stringify(qualification), now(), id]), logStatement(id, 'system', message)]);
      return this.requireCompany(tx, id);
    });
  }

  async saveQualification(id: string, input: unknown, confirmTarget: boolean, expectedTarget?: TargetSnapshot): Promise<Company> {
    if (typeof confirmTarget !== 'boolean') throw new Error('Confirmez explicitement la cible utilisée.');
    const parsed = qualificationInputSchema.parse(input);
    const expected = confirmTarget && expectedTarget !== undefined ? targetSnapshotSchema.parse(expectedTarget) : undefined;
    return this.saveQualificationData(id, async (tx, company) => {
      const current = company.qualification || emptyQualification();
      const target = confirmTarget ? captureTarget(await this.settings(tx)) : current.targetSnapshot;
      if (confirmTarget && (!expected || !target || (Object.keys(target) as (keyof TargetSnapshot)[]).some(key => expected[key] !== target[key]))) {
        throw new Error('La cible a changé depuis l’ouverture de la fiche. Actualisez la page avant de confirmer cette évaluation.');
      }
      return { ...current, answers: parsed.answers, targetSnapshot: target };
    }, 'Qualification de prospection enregistrée.');
  }

  async saveObservations(id: string, input: unknown): Promise<Company> {
    const parsed = observationsSchema.parse(input);
    return this.saveQualificationData(id, (_tx, company) => ({ ...(company.qualification || emptyQualification()), observations: parsed }), 'Constats manuels du site mis à jour.');
  }

  async saveAfterExchange(id: string, input: unknown): Promise<Company> {
    const parsed = afterExchangeInputSchema.parse(input);
    return this.saveQualificationData(id, (_tx, company) => {
      const current = company.qualification || emptyQualification();
      return { ...current, afterExchange: { ...parsed, qualifiedAt: current.afterExchange.qualifiedAt } };
    }, 'Informations après échange mises à jour.');
  }

  async findDuplicates(input: CompanyInput, excludeId?: string): Promise<{ id: string; name: string }[]> {
    const parsed = companyInputSchema.parse(input), domain = normalizedDomain(parsed.website), name = normalizeText(parsed.name), city = normalizeText(parsed.city);
    return (await this.listCompanies()).filter((company) => company.id !== excludeId && ((Boolean(domain) && normalizedDomain(company.website) === domain) || (normalizeText(company.name) === name && normalizeText(company.city) === city))).map(({ id, name }) => ({ id, name }));
  }

  private assertCurrentAction(company: Company, expectedId?: string | null) {
    if (expectedId !== undefined && expectedId !== (company.nextAction?.id || null)) throw new Error('Cette action a changé depuis l’ouverture de la page. Actualisez la fiche avant de réessayer.');
  }

  async setAction(id: string, input: { text: string; date: string }, expectedId?: string | null): Promise<Company> {
    const parsed = nextActionInputSchema.parse(input);
    return this.transact('write', async (tx) => {
      const company = await this.requireCompany(tx, id);
      this.assertCurrentAction(company, expectedId);
      if (company.oppositionActive) throw new Error('Cette entreprise est marquée « Ne plus contacter ». Désactivez explicitement cette opposition avant de prévoir une action.');
      if (company.nextAction?.text === parsed.text && company.nextAction.date === parsed.date) return company;
      await tx.batch([
        statement('INSERT INTO next_actions(id, companyId, text, date, createdAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(companyId) DO UPDATE SET id = excluded.id, text = excluded.text, date = excluded.date', [randomUUID(), id, parsed.text, parsed.date, company.nextAction?.createdAt || now()]),
        touchStatement(id), logStatement(id, 'system', `${company.nextAction ? 'Prochaine action modifiée' : 'Action planifiée'} : ${parsed.text}${parsed.date ? ` (${parsed.date})` : ' (à planifier)'}.`),
      ]);
      return this.requireCompany(tx, id);
    });
  }

  completeAction(id: string, expectedId?: string | null): Promise<void> {
    return this.transact('write', async (tx) => {
      const company = await this.requireCompany(tx, id);
      this.assertCurrentAction(company, expectedId);
      if (!company.nextAction) throw new Error('Aucune action à terminer.');
      const action = company.nextAction;
      await tx.batch([logStatement(id, 'action_done', `${action.text}${action.date ? ` — échéance initiale : ${action.date}` : ''}`, 'Action terminée'), statement('DELETE FROM next_actions WHERE companyId = ?', [id]), touchStatement(id)]);
    });
  }

  postponeAction(id: string, date: string, expectedId?: string | null): Promise<void> {
    return this.transact('write', async (tx) => {
      const company = await this.requireCompany(tx, id);
      this.assertCurrentAction(company, expectedId);
      if (company.oppositionActive) throw new Error('Une opposition active empêche la planification.');
      if (!company.nextAction) throw new Error('Aucune action à reporter.');
      const parsed = nextActionInputSchema.parse({ text: company.nextAction.text, date });
      if (parsed.date === company.nextAction.date) return;
      await tx.batch([statement('UPDATE next_actions SET id = ?, date = ? WHERE companyId = ?', [randomUUID(), parsed.date, id]), logStatement(id, 'action_rescheduled', `${company.nextAction.text} — ${company.nextAction.date || 'sans date'} → ${parsed.date || 'à planifier'}`, 'Action reportée'), touchStatement(id)]);
    });
  }

  async addActivity(id: string, input: { kind: 'note' | 'exchange'; type: string; date: string; text: string }): Promise<void> {
    const parsed = activityInputSchema.parse(input);
    return this.transact('write', async (tx) => {
      await this.requireCompany(tx, id);
      await tx.batch([activityStatement({ ...parsed, id: randomUUID(), companyId: id, createdAt: now() }), touchStatement(id)]);
    });
  }

  listActivities(id: string): Promise<Activity[]> {
    return this.transact('read', async (tx) => {
      await this.requireCompany(tx, id);
      return (await tx.execute(statement('SELECT * FROM activities WHERE companyId = ? ORDER BY createdAt DESC, rowid DESC', [id]))).rows as unknown as Activity[];
    });
  }

  async addAiTest(id: string, input: AiTestInput): Promise<void> {
    const parsed = aiTestInputSchema.parse(input);
    return this.transact('write', async (tx) => { await this.requireCompany(tx, id); await tx.batch([aiStatement({ ...parsed, id: randomUUID(), companyId: id, createdAt: now() }), touchStatement(id)]); });
  }

  listAiTests(id: string): Promise<AiTest[]> {
    return this.transact('read', async (tx) => { await this.requireCompany(tx, id); return (await tx.execute(statement('SELECT * FROM ai_tests WHERE companyId = ? ORDER BY createdAt DESC, rowid DESC', [id]))).rows.map(aiFromRow); });
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    if (typeof archived !== 'boolean') throw new Error('Choix d’archivage invalide.');
    return this.transact('write', async (tx) => {
      const company = await this.requireCompany(tx, id);
      if (company.archived === archived) return;
      await tx.batch([statement('UPDATE companies SET archived = ?, updatedAt = ? WHERE id = ?', [Number(archived), now(), id]), logStatement(id, 'system', archived ? 'Entreprise archivée.' : 'Entreprise désarchivée.')]);
    });
  }

  async setOpposition(id: string, active: boolean, note = '', confirmed = false): Promise<void> {
    if (typeof active !== 'boolean' || typeof note !== 'string' || note.length > 5000) throw new Error('Opposition invalide.');
    if (!active && confirmed !== true) throw new Error('Confirmez explicitement la réactivation du contact.');
    return this.transact('write', async (tx) => {
      const company = await this.requireCompany(tx, id), date = active && !company.oppositionActive ? parisToday() : company.oppositionDate;
      await tx.batch([
        statement('UPDATE companies SET oppositionActive = ?, oppositionDate = ?, oppositionNote = ?, updatedAt = ? WHERE id = ?', [Number(active), date, note.trim(), now(), id]),
        ...(active ? [statement('DELETE FROM next_actions WHERE companyId = ?', [id])] : []),
        logStatement(id, 'system', active ? `Ne plus contacter : opposition enregistrée${company.nextAction ? ', action annulée' : ''}.${note.trim() ? ` ${note.trim()}` : ''}` : 'Opposition désactivée après confirmation explicite.'),
      ]);
    });
  }

  private async settings(tx: Transaction): Promise<Settings> {
    return (await tx.execute('SELECT targetCity, targetBusiness, targetCompanyType, targetOffer, targetExclusions FROM settings WHERE id = 1')).rows[0] as unknown as Settings;
  }
  getSettings(): Promise<Settings> { return this.transact('read', (tx) => this.settings(tx)); }
  async saveSettings(input: Settings): Promise<void> {
    return this.transact('write', async (tx) => {
      const current = await this.settings(tx);
      const settings = settingsSchema.parse({ ...input, targetCompanyType: input.targetCompanyType ?? current.targetCompanyType, targetOffer: input.targetOffer ?? current.targetOffer, targetExclusions: input.targetExclusions ?? current.targetExclusions });
      await tx.execute(statement('UPDATE settings SET targetCity = ?, targetBusiness = ?, targetCompanyType = ?, targetOffer = ?, targetExclusions = ? WHERE id = 1', [settings.targetCity, settings.targetBusiness, settings.targetCompanyType, settings.targetOffer, settings.targetExclusions]));
    });
  }

  private async snapshot(tx: Transaction): Promise<Backup> {
    const companies = await this.companies(tx);
    const results = await tx.batch(['SELECT * FROM activities ORDER BY createdAt, rowid', 'SELECT * FROM ai_tests ORDER BY createdAt, rowid', 'SELECT targetCity, targetBusiness, targetCompanyType, targetOffer, targetExclusions FROM settings WHERE id = 1']);
    const ready=(await tx.execute("SELECT 1 FROM campaign_meta WHERE id = 'initial'")).rows.length>0;
    const extra=ready?campaignSnapshot((await tx.batch(campaignSelects)).map(r=>r.rows as unknown as Record<string,unknown>[])):undefined;
    return { schemaVersion: ready?5:2, ...(extra?{campaignData:extra}:{}), exportedAt: now(), companies, activities: results[0].rows as unknown as Activity[], aiTests: results[1].rows.map(aiFromRow), settings: results[2].rows[0] as unknown as Settings };
  }
  exportBackup(): Promise<Backup> { return this.transact('read', (tx) => this.snapshot(tx)); }

  async previewBackup(raw: unknown): Promise<{ companies: number; activities: number; aiTests: number; oppositions: number }> {
    const backup = backupSchema.parse(raw);
    return { companies: backup.companies.length, activities: backup.activities.length, aiTests: backup.aiTests.length, oppositions: backup.companies.filter(({ oppositionActive }) => oppositionActive).length };
  }

  async restoreBackup(raw: unknown, confirmed: boolean): Promise<{ backupPath: string; preservedOppositions: number }> {
    if (confirmed !== true) throw new Error('Confirmez le remplacement des données avant la restauration.');
    const validated = backupSchema.parse(raw) as Backup;
    return this.transact('write', async (tx) => {
      const incoming = structuredClone(validated); // A lock retry must not reuse arrays mutated by an earlier attempt.
      const existing = await this.snapshot(tx), opposed = existing.companies.filter(({ oppositionActive }) => oppositionActive);
      const preservedIds = new Set<string>(), importedCompanyIds = new Set(incoming.companies.map(({ id }) => id));
      for (const company of incoming.companies) {
        const matches = opposed.filter((prior) => prior.id === company.id || (Boolean(normalizedDomain(prior.website)) && normalizedDomain(prior.website) === normalizedDomain(company.website)) || (normalizeText(prior.name) === normalizeText(company.name) && normalizeText(prior.city) === normalizeText(company.city)));
        if (!matches.length) continue;
        const prior = matches.find(({ id }) => id === company.id) || matches[0];
        company.oppositionActive = true; company.oppositionDate = prior.oppositionDate; company.oppositionNote = prior.oppositionNote; company.updatedAt = now(); company.nextAction = null;
        preservedIds.add(company.id);
        incoming.activities.push({ id: randomUUID(), companyId: company.id, kind: 'system', type: 'Restauration', date: parisToday(), text: 'Opposition déjà enregistrée conservée lors de la restauration. Aucune relance réactivée.', createdAt: now() });
      }
      for (const company of opposed) {
        if (importedCompanyIds.has(company.id)) continue;
        for (const imported of incoming.companies) if (imported.nextAction?.id === company.id) imported.nextAction.id = randomUUID();
        for (const entry of [...incoming.activities, ...incoming.aiTests]) if (entry.id === company.id) entry.id = randomUUID();
        incoming.companies.push({ ...company, archived: true, nextAction: null, updatedAt: now() });
        const usedIds = new Set([...incoming.companies.flatMap((entry) => [entry.id, ...(entry.nextAction ? [entry.nextAction.id] : [])]), ...incoming.activities.map(({ id }) => id), ...incoming.aiTests.map(({ id }) => id)]);
        const retainId = (id: string) => { const nextId = usedIds.has(id) ? randomUUID() : id; usedIds.add(nextId); return nextId; };
        incoming.activities.push(...existing.activities.filter(({ companyId }) => companyId === company.id).map((entry) => ({ ...entry, id: retainId(entry.id) })));
        incoming.aiTests.push(...existing.aiTests.filter(({ companyId }) => companyId === company.id).map((entry) => ({ ...entry, id: retainId(entry.id) })));
        incoming.activities.push({ id: randomUUID(), companyId: company.id, kind: 'system', type: 'Restauration', date: parisToday(), text: 'Fiche absente de la sauvegarde conservée et archivée pour préserver son opposition.', createdAt: now() });
        preservedIds.add(company.id);
      }
      // Verify all preserved relations as well as the supplied file before changing stored data.
      for(const p of incoming.campaignData?.participations||[])if(incoming.companies.find(c=>c.id===p.companyId)?.oppositionActive)p.nextAction=null;
      backupSchema.parse(incoming);
      const recoveryId = randomUUID();
      await tx.execute(statement('INSERT INTO brine_restore_backups(id, createdAt, payload) VALUES (?, ?, ?)', [recoveryId, now(), JSON.stringify(existing)]));
      // Explicit deletion also protects restoration if a database is configured without FK cascades.
      await tx.batch(['DELETE FROM campaign_activity_context','DELETE FROM discovery_candidates','DELETE FROM discovery_runs','DELETE FROM company_registry_identity','DELETE FROM company_source_identity','DELETE FROM research_fact_corrections','DELETE FROM campaign_participations','DELETE FROM next_actions', 'DELETE FROM contacts', 'DELETE FROM activities', 'DELETE FROM ai_tests', 'DELETE FROM companies']);
      const statements = [...incoming.companies.flatMap(companyStatements), ...incoming.activities.map(activityStatement), ...incoming.aiTests.map(aiStatement), statement('UPDATE settings SET targetCity = ?, targetBusiness = ?, targetCompanyType = ?, targetOffer = ?, targetExclusions = ? WHERE id = 1', [incoming.settings.targetCity, incoming.settings.targetBusiness, incoming.settings.targetCompanyType || '', incoming.settings.targetOffer || '', incoming.settings.targetExclusions || ''])];
      for (let offset = 0; offset < statements.length; offset += 100) await tx.batch(statements.slice(offset, offset + 100));
      const campaignStatements=campaignRestoreStatements(incoming,existing);
      for(let offset=0;offset<campaignStatements.length;offset+=100)await tx.batch(campaignStatements.slice(offset,offset+100));
      return { backupPath: `cloud:${recoveryId}`, preservedOppositions: preservedIds.size };
    });
  }

  getRecoveryBackup(id: string): Promise<Backup | undefined> {
    return this.transact('read', async (tx) => {
      const result = await tx.execute(statement('SELECT payload FROM brine_restore_backups WHERE id = ?', [id.replace(/^cloud:/, '')]));
      return result.rows.length ? backupSchema.parse(JSON.parse(String(result.rows[0].payload))) as Backup : undefined;
    });
  }
  listRecoveryBackups(): Promise<{ id: string; createdAt: string }[]> {
    return this.transact('read', async (tx) => (await tx.execute('SELECT id, createdAt FROM brine_restore_backups ORDER BY createdAt DESC, id')).rows as unknown as { id: string; createdAt: string }[]);
  }
}
