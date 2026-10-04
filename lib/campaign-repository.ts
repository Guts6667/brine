import { randomUUID } from 'node:crypto';
import type { Client, InValue, Transaction } from '@libsql/client';
import { z } from 'zod';
import { companyInputSchema, companyDetailsSchema, settingsSchema, parisToday, normalizeText, normalizedDomain, nextActionInputSchema, activityInputSchema } from './domain';
import { emptyQualification, qualificationDataSchema, captureTarget, qualificationInputSchema, observationsSchema, afterExchangeInputSchema, canQualifyOpportunity, targetSnapshotSchema } from './qualification';
import type { Company, CompanyDetails, CompanyInput, Contact, Activity } from './types';
import type { Campaign, Participation, CampaignCompany, DiscoveryRun, DiscoveryCandidate, CampaignBackupData } from './campaign-types';

const timestamp = () => new Date().toISOString();
const json = <T>(value: unknown): T => JSON.parse(String(value));
const campaignInput = settingsSchema.extend({ name: z.string().trim().min(1, 'Nommez la campagne.').max(180), activityCodes: z.string().trim().max(200).regex(/^(?:\d{2}\.\d{2}[A-Z](?:\s*,\s*\d{2}\.\d{2}[A-Z])*)?$/, 'Codes NAF invalides.') });
const contactKeys = ['name', 'role', 'email', 'phone', 'formUrl', 'profileUrl'] as const;
let fileWrites: Promise<unknown> = Promise.resolve();
export class CampaignRepository {
  constructor(readonly client: Client) {}
  close() { this.client.close(); }
  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const execute = async () => {
      for (let attempt = 0; ; attempt++) {
        const tx = await this.client.transaction('write');
        try { const result = await work(tx); await tx.commit(); return result; }
        catch (error) {
          if (!tx.closed) await tx.rollback().catch(() => {});
          const code = (error as { code?: string }).code || '';
          if (!code.startsWith('SQLITE_BUSY') || attempt >= 3) throw error;
        } finally { tx.close(); }
      }
    };
    if (this.client.protocol !== 'file') return execute();
    const result = fileWrites.then(execute); fileWrites = result.catch(() => {}); return result;
  }
  private async shared(tx: Transaction, id: string): Promise<Company> {
    const result = await tx.execute({ sql: 'SELECT * FROM companies WHERE id = ?', args: [id] });
    if (!result.rows.length) throw new Error('Entreprise introuvable.');
    const row = result.rows[0];
    const contact = await tx.execute({ sql: 'SELECT name, role, email, phone, formUrl, profileUrl FROM contacts WHERE companyId = ?', args: [id] });
    const action = await tx.execute({ sql: 'SELECT id, text, date, createdAt FROM next_actions WHERE companyId = ?', args: [id] });
    const q = json<Record<string, unknown>>(row.qualification);
    const { commercialStage, ...base } = row;
    return { ...base, stage: commercialStage || row.stage, qualification: Object.keys(q).length ? qualificationDataSchema.parse(q) : emptyQualification(), contact: contact.rows[0] as unknown as Contact, nextAction: action.rows[0] || null, archived: Boolean(row.archived), oppositionActive: Boolean(row.oppositionActive) } as unknown as Company;
  }
  private async campaign(tx: Transaction, id: string): Promise<Campaign> {
    const r = await tx.execute({ sql: 'SELECT payload FROM campaigns WHERE id = ?', args: [id] });
    if (!r.rows.length) throw new Error('Campagne introuvable.'); return json(r.rows[0].payload);
  }
  private async participation(tx: Transaction, campaignId: string, companyId: string): Promise<Participation> {
    const r = await tx.execute({ sql: 'SELECT payload FROM campaign_participations WHERE campaignId = ? AND companyId = ?', args: [campaignId, companyId] });
    if (!r.rows.length) throw new Error('Cette entreprise ne participe pas à cette campagne.'); return json(r.rows[0].payload);
  }
  private async writeParticipation(tx: Transaction, p: Participation) {
    await tx.execute({ sql: 'INSERT INTO campaign_participations(campaignId, companyId, payload) VALUES (?, ?, ?) ON CONFLICT(campaignId, companyId) DO UPDATE SET payload = excluded.payload', args: [p.campaignId, p.companyId, JSON.stringify(p)] });
  }
  private async log(tx: Transaction, companyId: string, campaignId: string, text: string, kind: Activity['kind'] = 'system', type = '', date = parisToday()) {
    const id = randomUUID();
    await tx.execute({ sql: 'INSERT INTO activities(id, companyId, kind, type, date, text, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [id, companyId, kind, type, date, text, timestamp()] });
    await tx.execute({ sql: 'INSERT INTO campaign_activity_context(activityId, campaignId) VALUES (?, ?)', args: [id, campaignId] });
  }
  async bootstrap() {
    await this.transaction(async tx => {
      const marker = await tx.execute("SELECT value FROM campaign_meta WHERE id = 'initial'");
      if (marker.rows.length) return;
      const settings = (await tx.execute('SELECT * FROM settings WHERE id = 1')).rows[0];
      const { id: _id, ...target } = settings;
      const now = timestamp();
      const initial: Campaign = { ...settingsSchema.parse(target), id: 'initial', name: 'Prospection initiale', activityCodes: '43.32A,43.33Z,43.34Z', status: 'active', revision: 1, createdAt: now, updatedAt: now };
      await tx.execute({ sql: 'INSERT INTO campaigns(id, payload) VALUES (?, ?)', args: [initial.id, JSON.stringify(initial)] });
      const rows = await tx.execute('SELECT id FROM companies');
      for (const row of rows.rows) {
        const c = await this.shared(tx, String(row.id));
        await this.writeParticipation(tx, { campaignId: initial.id, companyId: c.id, stage: c.stage, archived: c.archived, qualification: c.qualification || emptyQualification(), nextAction: c.nextAction, approach: '', findingIds: [], revision: 1, updatedAt: c.updatedAt });
        await tx.execute({ sql: 'INSERT INTO campaign_activity_context(activityId, campaignId) SELECT id, ? FROM activities WHERE companyId = ?', args: [initial.id, c.id] });
      }
      await tx.execute('DELETE FROM next_actions');
      await tx.execute("INSERT INTO campaign_meta(id, value) VALUES('initial', 'initial')");
      // Only exact source identifiers are backfilled; conflicting legacy duplicates remain unresolved.
      const notes = await tx.execute("SELECT companyId, text FROM activities WHERE type = 'Import Annuaire des entreprises'");
      const identities = new Map<string, { companyId: string; siret: string } | null>();
      for (const n of notes.rows) {
        if(!String(n.text).startsWith('Entreprise issue de l’Annuaire des entreprises.'))continue;
        const siren = /^SIREN : (\d{9})$/m.exec(String(n.text))?.[1];
        const siret = /^SIRET : (\d{14})$/m.exec(String(n.text))?.[1] || '';
        if (!siren) continue;
        const prior = identities.get(siren);
        identities.set(siren, prior === null || prior && prior.companyId !== n.companyId ? null : { companyId: String(n.companyId), siret });
      }
      for (const [siren, value] of identities) if (value) await tx.execute({ sql: 'INSERT OR IGNORE INTO company_registry_identity(siren, companyId, siret) VALUES (?, ?, ?)', args: [siren, value.companyId, value.siret] });
    });
  }
  async listCampaigns(): Promise<Campaign[]> { return (await this.client.execute('SELECT payload FROM campaigns ORDER BY rowid')).rows.map(r => json<Campaign>(r.payload)); }
  async getCampaign(id: string): Promise<Campaign> { return this.transaction(tx => this.campaign(tx, id)); }
  async saveCampaign(input: unknown, id?: string, expectedRevision?: number): Promise<Campaign> {
    const data = campaignInput.parse(input);
    return this.transaction(async tx => {
      const old = id ? await this.campaign(tx, id) : undefined;
      if (old && old.revision !== expectedRevision) throw new Error('La campagne a changé. Rechargez la page.');
      const c: Campaign = { ...data, id: old?.id || randomUUID(), status: old?.status || 'active', revision: (old?.revision || 0) + 1, createdAt: old?.createdAt || timestamp(), updatedAt: timestamp() };
      await tx.execute({ sql: 'INSERT INTO campaigns(id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload', args: [c.id, JSON.stringify(c)] }); return c;
    });
  }
  async setCampaignStatus(id: string, status: Campaign['status'], expectedRevision: number) {
    z.enum(['active', 'paused', 'archived']).parse(status);
    await this.transaction(async tx => {
      const c = await this.campaign(tx, id);
      if (c.revision !== expectedRevision) throw new Error('La campagne a changé. Rechargez la page.');
      await tx.execute({ sql: 'UPDATE campaigns SET payload = ? WHERE id = ?', args: [JSON.stringify({ ...c, status, revision: c.revision + 1, updatedAt: timestamp() }), id] });
      if (status !== 'active') {
        const runs = await tx.execute({ sql: 'SELECT payload FROM discovery_runs WHERE campaignId = ?', args: [id] });
        for (const row of runs.rows) { const r = json<DiscoveryRun>(row.payload); if (['queued', 'running'].includes(r.status)) await this.putRun(tx, { ...r, status: 'paused', generation: r.generation + 1, owner: '', leaseUntil: '', updatedAt: timestamp() }); }
      }
    });
  }
  private project(c: Company, p: Participation, campaign: Campaign): CampaignCompany {
    return { ...c, stage: p.stage, archived: p.archived || campaign.status === 'archived', nextAction: c.oppositionActive ? null : p.nextAction, qualification: { ...p.qualification, observations: c.qualification?.observations || emptyQualification().observations }, campaignId: campaign.id, campaignName: campaign.name, participationRevision: p.revision, approach: p.approach, findingIds: p.findingIds };
  }
  async listCompanies(campaignId: string): Promise<CampaignCompany[]> {
    return this.transaction(async tx => { const campaign = await this.campaign(tx, campaignId); const rows = await tx.execute({ sql: 'SELECT payload FROM campaign_participations WHERE campaignId = ?', args: [campaignId] }); const companies: CampaignCompany[] = []; for (const r of rows.rows) { const p = json<Participation>(r.payload); companies.push(this.project(await this.shared(tx, p.companyId), p, campaign)); } return companies.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)); });
  }
  async getCompany(campaignId: string, companyId: string): Promise<CampaignCompany> { return this.transaction(async tx => this.project(await this.shared(tx, companyId), await this.participation(tx, campaignId, companyId), await this.campaign(tx, campaignId))); }
  async memberships(companyId: string): Promise<Participation[]> { return (await this.client.execute({ sql: 'SELECT payload FROM campaign_participations WHERE companyId = ?', args: [companyId] })).rows.map(r => json(r.payload)); }
  private async attachTx(tx: Transaction, campaignId: string, companyId: string) {
    await this.campaign(tx, campaignId); const c = await this.shared(tx, companyId);
    const existing = await tx.execute({ sql: 'SELECT payload FROM campaign_participations WHERE campaignId = ? AND companyId = ?', args: [campaignId, companyId] });
    if (existing.rows.length) return json<Participation>(existing.rows[0].payload);
    const p: Participation = { campaignId, companyId, stage: 'À étudier', archived: false, qualification: emptyQualification(), nextAction: null, approach: '', findingIds: [], revision: 1, updatedAt: timestamp() };
    await this.writeParticipation(tx, p); await this.log(tx, c.id, campaignId, 'Entreprise rattachée à la campagne.'); return p;
  }
  async attach(campaignId: string, companyId: string) { return this.transaction(tx => this.attachTx(tx, campaignId, companyId)); }
  private async createTx(tx: Transaction, campaignId: string, input: CompanyInput, source?: { kind: 'note'; type: string; date: string; text: string }): Promise<string> {
    const parsed = companyInputSchema.parse(input), id = randomUUID(), now = timestamp();
    await tx.execute({ sql: 'INSERT INTO companies(id, name, website, city, business, createdAt, updatedAt, qualification) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: [id, parsed.name, parsed.website, parsed.city, parsed.business, now, now, JSON.stringify(emptyQualification())] });
    await tx.execute({ sql: 'INSERT INTO contacts(companyId) VALUES (?)', args: [id] });
    await this.attachTx(tx, campaignId, id);
    if (source) { const note = activityInputSchema.parse(source); await this.log(tx, id, campaignId, note.text, 'note', note.type, note.date); } return id;
  }
  async createCompany(campaignId: string, input: CompanyInput, source?: { kind: 'note'; type: string; date: string; text: string }) {
    const id = await this.transaction(tx => this.createTx(tx, campaignId, input, source)); return this.getCompany(campaignId, id);
  }
  async mutate(campaignId: string, companyId: string, expected: number | undefined, work: (p: Participation, c: CampaignCompany, campaign: Campaign, tx: Transaction) => Promise<void> | void, message: string) {
    await this.transaction(async tx => {
      const campaign = await this.campaign(tx, campaignId), p = await this.participation(tx, campaignId, companyId), c = this.project(await this.shared(tx, companyId), p, campaign);
      if (expected !== undefined && expected !== p.revision) throw new Error('Le suivi a changé depuis l’ouverture du formulaire. Rechargez la fiche.');
      await work(p, c, campaign, tx); p.revision++; p.updatedAt = timestamp();
      await this.writeParticipation(tx, p); if(message)await this.log(tx, companyId, campaignId, message);
    }); return this.getCompany(campaignId, companyId);
  }
  async updateCompany(campaignId: string, id: string, input: CompanyDetails, expected?: number, expectedSharedUpdatedAt?:string) {
    const parsed = companyDetailsSchema.parse(input);
    return this.mutate(campaignId, id, expected, async (p,c,_campaign,tx) => {
      if(expectedSharedUpdatedAt!==undefined&&expectedSharedUpdatedAt!==c.updatedAt)throw new Error('Les informations communes ont changé dans une autre campagne. Rechargez la fiche.');
      if (p.stage !== parsed.stage && parsed.stage === 'Opportunité qualifiée') { if (!canQualifyOpportunity(c)) throw new Error('Les conditions après échange doivent être confirmées avant de qualifier cette opportunité.'); p.qualification.afterExchange.qualifiedAt = timestamp(); }
      p.stage = parsed.stage;
      await tx.execute({ sql: 'UPDATE companies SET name = ?, website = ?, city = ?, business = ?, updatedAt = ? WHERE id = ?', args: [parsed.name, parsed.website, parsed.city, parsed.business, new Date(Math.max(Date.now(),Date.parse(c.updatedAt)+1)).toISOString(), id] });
      await tx.execute({ sql: `UPDATE contacts SET ${contactKeys.map(k => `"${k}" = ?`).join(', ')} WHERE companyId = ?`, args: [...contactKeys.map(k => parsed.contact[k]), id] });
    }, 'Informations communes et suivi de la campagne enregistrés.');
  }
  async saveQualification(campaignId: string,id: string,input: unknown,confirm: boolean,expectedTarget: unknown,expected?:number) {
    const parsed = qualificationInputSchema.parse(input);
    return this.mutate(campaignId,id,expected,(p,_c,campaign) => {
      if (confirm) { const target = captureTarget(campaign); if (JSON.stringify(targetSnapshotSchema.parse(expectedTarget)) !== JSON.stringify(target)) throw new Error('La cible a changé. Rechargez la fiche avant de confirmer.'); p.qualification.targetSnapshot = target; }
      p.qualification.answers = parsed.answers;
    }, 'Qualification de cette campagne enregistrée.');
  }
  async saveObservations(campaignId:string,id:string,input:unknown,expected?:number) {
    const parsed = observationsSchema.parse(input);
    return this.mutate(campaignId,id,expected,async (_p,_c,_campaign,tx) => {
      const shared = await this.shared(tx,id); const q = shared.qualification || emptyQualification(); q.observations = parsed;
      await tx.execute({sql:'UPDATE companies SET qualification = ?, updatedAt = ? WHERE id = ?',args:[JSON.stringify(q),timestamp(),id]});
    }, 'Constats communs du site enregistrés.');
  }
  async saveAfterExchange(campaignId:string,id:string,input:unknown,expected?:number) { const parsed=afterExchangeInputSchema.parse(input); return this.mutate(campaignId,id,expected,p=>{ p.qualification.afterExchange={...parsed,qualifiedAt:p.qualification.afterExchange.qualifiedAt}; },'Informations après échange enregistrées pour cette campagne.'); }
  async qualifyOpportunity(campaignId:string,id:string,expected?:number) { return this.mutate(campaignId,id,expected,(p,c)=>{ if(!canQualifyOpportunity(c)) throw new Error('Les conditions après échange doivent être confirmées.'); p.stage='Opportunité qualifiée'; p.qualification.afterExchange.qualifiedAt ||=timestamp(); },'Opportunité qualifiée dans cette campagne.'); }
  async setAction(campaignId:string,id:string,input:unknown,expectedId?:string|null,expected?:number) {
    const data=nextActionInputSchema.parse(input); return this.mutate(campaignId,id,expected,(p,c,campaign)=>{
      if(c.oppositionActive) throw new Error('Cette entreprise ne doit plus être contactée.'); if(campaign.status!=='active'||p.archived) throw new Error('Réactivez la campagne et la participation pour planifier une action.');
      if(expectedId!==undefined && (p.nextAction?.id||null)!==expectedId) throw new Error('Cette action a changé. Rechargez la fiche.');
      p.nextAction={...data,id:randomUUID(),createdAt:p.nextAction?.createdAt||timestamp()};
    },`Action planifiée : ${data.text}${data.date?` (${data.date})`:''}.`);
  }
  async changeAction(campaignId:string,id:string,expectedId:string|null,operation:'complete'|'postpone',date='',expected?:number) {
    return this.mutate(campaignId,id,expected,async(p,c,_campaign,tx)=>{
      if(c.oppositionActive||!p.nextAction||p.nextAction.id!==expectedId) throw new Error('Cette action a changé ou le contact est bloqué.');
      const action=p.nextAction;
      if(operation==='complete')p.nextAction=null; else {const parsed=nextActionInputSchema.parse({text:action.text,date});p.nextAction={...action,date:parsed.date,id:randomUUID()};}
      await this.log(tx,id,campaignId,operation==='complete'?action.text:`${action.text} → ${date||'sans date'}`,operation==='complete'?'action_done':'action_rescheduled');
    }, '');
  }
  async setArchived(campaignId:string,id:string,value:boolean,expected?:number) { return this.mutate(campaignId,id,expected,p=>{p.archived=z.boolean().parse(value);},value?'Participation archivée.':'Participation réactivée.'); }
  async addActivity(campaignId:string,id:string,input:unknown) { const p=activityInputSchema.parse(input); await this.transaction(async tx=>{ await this.participation(tx,campaignId,id);await this.log(tx,id,campaignId,p.text,p.kind,p.type,p.date); }); }
  async listActivities(companyId:string):Promise<(Activity & {campaignId?:string})[]> { const r=await this.client.execute({sql:'SELECT a.*, x.campaignId FROM activities a LEFT JOIN campaign_activity_context x ON x.activityId = a.id WHERE a.companyId = ? ORDER BY a.createdAt DESC, a.id',args:[companyId]});return r.rows.map(row=>row as unknown as Activity & {campaignId?:string}); }
  async setOpposition(campaignId:string,id:string,active:boolean,note:string,confirmed:boolean){
    z.boolean().parse(active);z.string().max(2000).parse(note);if(!active&&!confirmed)throw new Error('Confirmez explicitement la réactivation du contact.');
    await this.transaction(async tx=>{await this.participation(tx,campaignId,id);const company=await this.shared(tx,id);
      await tx.execute({sql:'UPDATE companies SET oppositionActive = ?, oppositionDate = ?, oppositionNote = ?, updatedAt = ? WHERE id = ?',args:[Number(active),active?(company.oppositionDate||parisToday()):'',note.trim(),timestamp(),id]});
      if(active){await tx.execute({sql:'DELETE FROM next_actions WHERE companyId = ?',args:[id]});const rows=await tx.execute({sql:'SELECT payload FROM campaign_participations WHERE companyId = ?',args:[id]});for(const r of rows.rows){const p=json<Participation>(r.payload);p.nextAction=null;p.revision++;p.updatedAt=timestamp();await this.writeParticipation(tx,p);}}
      await this.log(tx,id,campaignId,active?'Opposition commune : aucune campagne ne peut contacter cette entreprise.':'Opposition levée explicitement. Aucune action créée.');
    });
  }
  async retainedFindings(campaignId:string,id:string){const p=(await this.memberships(id)).find(x=>x.campaignId===campaignId);if(!p)return [];
    const candidates=(await this.client.execute({sql:"SELECT payload FROM discovery_candidates WHERE json_extract(payload, '$.companyId') = ?",args:[id]})).rows.map(r=>json<DiscoveryCandidate>(r.payload));
    return candidates.flatMap(c=>[c.html,c.mobile].flatMap(report=>report?report.findings.filter(f=>p.findingIds.includes(`${c.id}:${f.id}`)).map(f=>({...f,analyzedOn:report.analyzedOn})):[]));
  }
  async clearOpposedActions(id:string) { await this.transaction(async tx=>{const shared=await this.shared(tx,id);if(!shared.oppositionActive)return;const rows=await tx.execute({sql:'SELECT payload FROM campaign_participations WHERE companyId = ?',args:[id]});for(const row of rows.rows){const p=json<Participation>(row.payload);if(p.nextAction){p.nextAction=null;p.revision++;p.updatedAt=timestamp();await this.writeParticipation(tx,p);await this.log(tx,id,p.campaignId,'Opposition commune : action annulée.');}}}); }
  async putRun(tx:Transaction,run:DiscoveryRun) { await tx.execute({sql:'INSERT INTO discovery_runs(id, campaignId, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',args:[run.id,run.campaignId,JSON.stringify(run)]}); }
  async listRuns(campaignId?:string):Promise<DiscoveryRun[]> {const rows=await this.client.execute(campaignId?{sql:'SELECT payload FROM discovery_runs WHERE campaignId = ? ORDER BY rowid DESC',args:[campaignId]}:'SELECT payload FROM discovery_runs ORDER BY rowid DESC');return rows.rows.map(r=>json(r.payload));}
  async getRun(id:string):Promise<DiscoveryRun> {const rows=await this.client.execute({sql:'SELECT payload FROM discovery_runs WHERE id = ?',args:[id]});if(!rows.rows.length)throw new Error('Lot introuvable.');return json(rows.rows[0].payload);}
  async listCandidates(runId:string):Promise<DiscoveryCandidate[]> {return (await this.client.execute({sql:'SELECT payload FROM discovery_candidates WHERE runId = ? ORDER BY rowid',args:[runId]})).rows.map(r=>json(r.payload));}
  async getCandidate(id:string):Promise<DiscoveryCandidate> {const r=await this.client.execute({sql:'SELECT payload FROM discovery_candidates WHERE id = ?',args:[id]});if(!r.rows.length)throw new Error('Résultat introuvable.');return json(r.rows[0].payload);}
  async putCandidate(tx:Transaction,c:DiscoveryCandidate) { await tx.execute({sql:'INSERT INTO discovery_candidates(id, runId, siren, payload) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',args:[c.id,c.runId,c.company.siren,JSON.stringify(c)]}); }
  async snapshot():Promise<CampaignBackupData> {const tables=['campaigns','campaign_participations','discovery_runs','discovery_candidates'];const r=await this.client.batch(tables.map(table=>`SELECT payload FROM ${table}`),'read');return {campaigns:r[0].rows.map(x=>json(x.payload)),participations:r[1].rows.map(x=>json(x.payload)),runs:r[2].rows.map(x=>json(x.payload)),candidates:r[3].rows.map(x=>json(x.payload)),identities:(await this.client.execute('SELECT * FROM company_registry_identity')).rows as unknown as CampaignBackupData['identities'],activityCampaigns:(await this.client.execute('SELECT * FROM campaign_activity_context')).rows as unknown as CampaignBackupData['activityCampaigns']};}
  async epoch():Promise<string> {return String((await this.client.execute("SELECT value FROM campaign_meta WHERE id = 'epoch'")).rows[0].value);}
  async createRun(campaignId:string,limit:number,key:string,companyIds:string[]=[]):Promise<DiscoveryRun> {
    z.number().int().min(1).max(20).parse(limit);z.string().uuid().parse(key);
    return this.transaction(async tx=>{const campaign=await this.campaign(tx,campaignId);if(campaign.status!=='active')throw new Error('Réactivez cette campagne pour lancer un lot.');
      const prior=await tx.execute({sql:'SELECT payload FROM discovery_runs WHERE id = ?',args:[key]});if(prior.rows.length){const run=json<DiscoveryRun>(prior.rows[0].payload);if(run.campaignId!==campaignId)throw new Error('Identifiant de lancement déjà utilisé.');return run;}
      if(companyIds.length>20||new Set(companyIds).size!==companyIds.length)throw new Error('Sélectionnez au maximum 20 entreprises distinctes.');
      for(const id of companyIds){const p=await this.participation(tx,campaignId,id),shared=await this.shared(tx,id);if(p.archived||shared.oppositionActive)throw new Error('Une entreprise sélectionnée est archivée ou ne doit plus être contactée.');}
      const run:DiscoveryRun={id:key,campaignId,target:campaign,limit,source:companyIds.length?'existing':'registry',companyIds,generation:1,owner:'',leaseUntil:'',status:'queued',error:'',createdAt:timestamp(),updatedAt:timestamp()};await this.putRun(tx,run);return run;
    });
  }
  async controlRun(id:string,operation:'pause'|'resume'|'cancel') {await this.transaction(async tx=>{const r=await tx.execute({sql:'SELECT payload FROM discovery_runs WHERE id = ?',args:[id]});if(!r.rows.length)throw new Error('Lot introuvable.');const run=json<DiscoveryRun>(r.rows[0].payload);const c=await this.campaign(tx,run.campaignId);if(operation==='resume'&&c.status!=='active')throw new Error('Réactivez la campagne.');if(['completed','cancelled'].includes(run.status)&&operation!=='cancel')throw new Error('Ce lot est terminé.');await this.putRun(tx,{...run,status:operation==='resume'?'queued':operation==='pause'?'paused':'cancelled',generation:run.generation+1,owner:'',leaseUntil:'',updatedAt:timestamp()});});}
  async claimRun(id:string,owner:string,epoch:string):Promise<DiscoveryRun|null> {
    return this.transaction(async tx=>{const currentEpoch=String((await tx.execute("SELECT value FROM campaign_meta WHERE id = 'epoch'")).rows[0].value);if(epoch!==currentEpoch)return null;const rows=await tx.execute('SELECT payload FROM discovery_runs');const runs=rows.rows.map(r=>json<DiscoveryRun>(r.payload));const run=runs.find(r=>r.id===id);if(!run||!['queued','running'].includes(run.status))return null;
      if(run.owner && run.owner!==owner && run.leaseUntil>timestamp())return null;
      if(runs.some(r=>r.id!==id&&r.status==='running'&&r.leaseUntil>timestamp()))return null;
      const campaign=await this.campaign(tx,run.campaignId);if(campaign.status!=='active')return null;
      const claimed={...run,status:'running' as const,owner,leaseUntil:new Date(Date.now()+180_000).toISOString(),updatedAt:timestamp()};await this.putRun(tx,claimed);return claimed;
    });
  }
  async guardedRun(id:string,owner:string,generation:number,epoch:string,work:(tx:Transaction,run:DiscoveryRun)=>Promise<void>):Promise<boolean> {
    return this.transaction(async tx=>{if(String((await tx.execute("SELECT value FROM campaign_meta WHERE id = 'epoch'")).rows[0].value)!==epoch)return false;const row=await tx.execute({sql:'SELECT payload FROM discovery_runs WHERE id = ?',args:[id]});if(!row.rows.length)return false;const run=json<DiscoveryRun>(row.rows[0].payload);if(run.owner!==owner||run.generation!==generation||run.status!=='running')return false;await work(tx,run);if(run.status==='running')run.leaseUntil=new Date(Date.now()+180_000).toISOString();run.updatedAt=timestamp();await this.putRun(tx,run);return true;});
  }
  async confirmWebsite(id:string,website:string,revision:number) {
    const url=new URL(website);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Adresse de site invalide.');
    await this.transaction(async tx=>{const c=await this.getCandidateTx(tx,id);if(c.revision!==revision||['accepted','rejected'].includes(c.status))throw new Error('Ce résultat a changé.');c.website=url.href;c.html=null;c.mobile=null;c.htmlError='';c.mobileError='';c.status='queued';c.attempts={};c.revision++;await this.putCandidate(tx,c);const rows=await tx.execute({sql:'SELECT payload FROM discovery_runs WHERE id = ?',args:[c.runId]});const run=json<DiscoveryRun>(rows.rows[0].payload);if((await this.campaign(tx,run.campaignId)).status!=='active')throw new Error('Réactivez la campagne.');if(run.status==='cancelled')throw new Error('Le lot a été annulé.');await this.putRun(tx,{...run,status:'queued',generation:run.generation+1,owner:'',leaseUntil:'',updatedAt:timestamp()});});
  }
  private async getCandidateTx(tx:Transaction,id:string):Promise<DiscoveryCandidate>{const r=await tx.execute({sql:'SELECT payload FROM discovery_candidates WHERE id = ?',args:[id]});if(!r.rows.length)throw new Error('Résultat introuvable.');return json(r.rows[0].payload);}
  async knownRegistryCompany(campaignId:string,siren:string) {
    return this.transaction(async tx=>{
      const rows=await tx.execute({sql:'SELECT companyId FROM company_registry_identity WHERE siren = ?',args:[siren]});
      if(!rows.rows.length)return null;
      const company=await this.shared(tx,String(rows.rows[0].companyId));
      const participation=await tx.execute({sql:'SELECT companyId FROM campaign_participations WHERE campaignId = ? AND companyId = ?',args:[campaignId,company.id]});
      return {companyId:company.id,website:company.website,opposed:company.oppositionActive,inCampaign:Boolean(participation.rows.length)};
    });
  }
  async reviewCandidate(id:string,revision:number,decision:'accept'|'reject'|'verify',findingIds:string[],contactIndexes:number[],approach:string):Promise<string|null> {
    z.enum(['accept','reject','verify']).parse(decision);z.string().max(4000).parse(approach);
    return this.transaction(async tx=>{const candidate=await this.getCandidateTx(tx,id);if(candidate.revision!==revision)throw new Error('Ce résultat a changé. Rechargez le lot.');if(candidate.status==='accepted')return candidate.companyId;
      const r=await tx.execute({sql:'SELECT payload FROM discovery_runs WHERE id = ?',args:[candidate.runId]});const run=json<DiscoveryRun>(r.rows[0].payload);
      if(decision!=='accept'){candidate.status=decision==='reject'?'rejected':'verify';candidate.revision++;await this.putCandidate(tx,candidate);return null;}
      const findings=[...(candidate.html?.findings||[]),...(candidate.mobile?.findings||[])];const contacts=candidate.html?.contacts||[];
      if(findingIds.some(id=>!findings.some(f=>f.id===id))||contactIndexes.some(i=>!Number.isInteger(i)||i<0||i>=contacts.length))throw new Error('Sélection invalide.');
      let companyId=candidate.companyId;
      if(!companyId){const identity=await tx.execute({sql:'SELECT companyId FROM company_registry_identity WHERE siren = ?',args:[candidate.company.siren]});companyId=identity.rows.length?String(identity.rows[0].companyId):null;}
      if(!companyId){const existing=await tx.execute('SELECT c.id, c.name, c.city, c.website, i.siren FROM companies c LEFT JOIN company_registry_identity i ON i.companyId = c.id');const matches=existing.rows.filter(row=>(!row.siren||row.siren===candidate.company.siren)&&(candidate.website&&normalizedDomain(String(row.website))===normalizedDomain(candidate.website)||normalizeText(String(row.name))===normalizeText(candidate.company.name)&&normalizeText(String(row.city))===normalizeText(candidate.company.city)));if(matches.length>1)throw new Error('Plusieurs fiches correspondent. Résolvez les doublons avant de retenir.');companyId=matches.length?String(matches[0].id):null;}
      if(!companyId)companyId=await this.createTx(tx,run.campaignId,{name:candidate.company.name,city:candidate.company.city,business:candidate.company.business,website:candidate.website},{kind:'note',type:'Recherche d’entreprise',date:parisToday(),text:`Source officielle\nSIREN : ${candidate.company.siren}\nSIRET : ${candidate.company.siret}\nSource : ${candidate.company.sourceUrl}`});
      const shared=await this.shared(tx,companyId);if(shared.oppositionActive)throw new Error('Cette entreprise a une opposition active.');
      if(!shared.website&&candidate.website)await tx.execute({sql:'UPDATE companies SET website = ?, updatedAt = ? WHERE id = ?',args:[candidate.website,timestamp(),companyId]});
      for(const i of [...new Set(contactIndexes)]){const contact=contacts[i];if(!shared.contact[contact.kind]){shared.contact[contact.kind]=contact.value;}}
      companyDetailsSchema.parse({...shared,contact:shared.contact});
      await tx.execute({sql:`UPDATE contacts SET ${contactKeys.map(k=>`"${k}" = ?`).join(', ')} WHERE companyId = ?`,args:[...contactKeys.map(k=>shared.contact[k]),companyId]});
      await tx.execute({sql:'UPDATE companies SET updatedAt = ? WHERE id = ?',args:[new Date(Math.max(Date.now(),Date.parse(shared.updatedAt)+1)).toISOString(),companyId]});
      const p=await this.attachTx(tx,run.campaignId,companyId);p.findingIds=[...new Set([...p.findingIds,...findingIds.map(id=>`${candidate.id}:${id}`)])];p.approach=approach.trim()||p.approach;p.revision++;p.updatedAt=timestamp();await this.writeParticipation(tx,p);
      for(const finding of findings.filter(f=>findingIds.includes(f.id)))await this.log(tx,companyId,run.campaignId,`${finding.note}\nSource : ${finding.sourceUrl}\nConsultation : ${candidate.html?.analyzedOn||candidate.mobile?.analyzedOn||parisToday()}${finding.approach?`\nAngle à valider : ${finding.approach}`:''}`,'note','Constat retenu');
      if(candidate.company.siren.match(/^\d{9}$/))await tx.execute({sql:'INSERT INTO company_registry_identity(siren, companyId, siret) VALUES (?, ?, ?) ON CONFLICT(siren) DO NOTHING',args:[candidate.company.siren,companyId,candidate.company.siret]});
      candidate.companyId=companyId;candidate.status='accepted';candidate.revision++;await this.putCandidate(tx,candidate);return companyId;
    });
  }
  async saveApproach(campaignId:string,id:string,approach:string,expected?:number){z.string().max(4000).parse(approach);return this.mutate(campaignId,id,expected,p=>{p.approach=approach.trim();},'Angle de cette campagne enregistré.');}
}
