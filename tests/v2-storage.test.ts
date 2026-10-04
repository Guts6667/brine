import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { Store, getStore } from '../lib/db';
import { AsyncCloudStore } from '../lib/cloud-db';
import { CampaignRepository } from '../lib/campaign-repository';
import { researchSql } from '../lib/campaign-schema';
import { getCampaignRepository, resetCampaignRepository } from '../lib/campaign-runtime';
import { cloudMigrations } from '../lib/cloud-schema';
import { backupSchema, parisToday } from '../lib/domain';
import { buildProspectReport } from '../lib/research-report';
import { buildContactDrafts, createApproachPlan, emptyProviderProfile } from '../lib/contact-preparation';
import type { DiscoveryCandidate } from '../lib/campaign-types';
import type { ContactEvent, ContactReadiness } from '../lib/research-types';

async function fixture(kind:'local'|'cloud') {
  const dir=mkdtempSync(join(tmpdir(),'brine-v2-storage-')),path=join(dir,'data.sqlite');
  const base=kind==='local'?new Store(path):new AsyncCloudStore(createClient({url:`file:${path}`}));
  await base.listCompanies();
  const repo=new CampaignRepository(createClient({url:`file:${path}`}));await repo.bootstrap();
  return {dir,path,base,repo,close(){repo.close();base.close();rmSync(dir,{recursive:true,force:true});}};
}
const target={name:'Artisans Lyon',targetCity:'Lyon',targetBusiness:'Électricité',targetCompanyType:'Indépendants',targetOffer:'Développement et amélioration de sites web',targetExclusions:'',activityCodes:'',keywords:'électricien indépendant'};
function candidate(runId:string,index=0):DiscoveryCandidate {
  return {id:randomUUID(),runId,companyId:null,company:{name:`Atelier ${index}`,siren:'',siret:'',city:'Lyon',business:'Électricité',activityCode:'',address:'',sourceUrl:`https://maps.google.com/?cid=${index}`},status:'review',websites:[],website:'',html:null,mobile:null,htmlError:'',mobileError:'',attempts:{},revision:1,dedupeKey:`maps:place-${index}`,research:{sources:[{id:`maps-source-${index}`,provider:'maps',url:`https://maps.google.com/?cid=${index}`,title:`Atelier ${index}`,excerpt:'Présentation et contact publiés',collectedAt:'2026-10-04',externalId:`place-${index}`}],facts:Array.from({length:12},(_,n)=>({id:`fact-${index}-${n}`,section:'site' as const,kind:'observed' as const,sentiment:'issue' as const,text:`Accès documenté ${n} : une page renvoie HTTP 404.`,sourceIds:[`maps-source-${index}`],observedOn:'2026-10-04',scope:'Une vérification ponctuelle, défaut à confirmer.'})),contacts:[{kind:'email',value:`contact${index}@atelier.test`,sourceUrl:`https://maps.google.com/?cid=${index}`,sourceId:`maps-source-${index}`}],profiles:[],warnings:[]}};
}
async function accepted(f:Awaited<ReturnType<typeof fixture>>) {
  const campaign=await f.repo.saveCampaign(target),run=await f.repo.createRun(campaign.id,10,randomUUID()),c=candidate(run.id);
  await f.repo.transaction(tx=>f.repo.putCandidate(tx,c));
  const id=(await f.repo.reviewCandidate(c.id,1,'accept',['fact-0-0'],[0],''))!;
  return {campaign,run,c,id};
}
async function preparation(f:Awaited<ReturnType<typeof fixture>>,context:Awaited<ReturnType<typeof accepted>>) {
  const profile=await f.repo.saveProviderProfile({...emptyProviderProfile(),name:'Alex',activity:'développeur indépendant',services:'Création et amélioration de sites web'},0);
  const report=(await f.repo.getCompanyReport(context.campaign.id,context.id))!;
  const plan=createApproachPlan(report,context.campaign,profile,['fact-0-0']);
  const drafts=buildContactDrafts(plan,report,profile);
  const readiness:ContactReadiness={target:true,reason:true,channel:true,evidenceIds:plan.evidenceIds,channelKind:'email',confirmedAt:new Date().toISOString(),targetRevision:context.campaign.revision,reportId:report.id};
  const before=await f.repo.getCompany(context.campaign.id,context.id);
  const company=await f.repo.savePreparation(context.campaign.id,context.id,{readiness,plan,drafts},before.participationRevision);
  return {profile,report,plan,drafts,readiness,company};
}

test('research migration is identical for SQLite and Turso with financial tables outside campaign restoration',()=>{
  assert.equal(researchSql.trim(),readFileSync('migrations/004_research.sql','utf8').trim());
  assert.equal(cloudMigrations.find(m=>m.version===5)?.sql,researchSql);
});
test('runtime restoration retains the SQL client and reconstructs legacy campaign context before backup',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'brine-runtime-')),path=join(dir,'data.sqlite');
  const globals=globalThis as typeof globalThis&{campaignRepository?:Promise<CampaignRepository>;brineStore?:Store;brineCloudStore?:AsyncCloudStore};
  const previous={repo:globals.campaignRepository,store:globals.brineStore,cloud:globals.brineCloudStore};
  const environment={BRINE_DB_PATH:process.env.BRINE_DB_PATH,TURSO_DATABASE_URL:process.env.TURSO_DATABASE_URL,TURSO_AUTH_TOKEN:process.env.TURSO_AUTH_TOKEN,VERCEL:process.env.VERCEL};
  delete globals.campaignRepository;delete globals.brineStore;delete globals.brineCloudStore;
  process.env.BRINE_DB_PATH=path;delete process.env.TURSO_DATABASE_URL;delete process.env.TURSO_AUTH_TOKEN;delete process.env.VERCEL;
  try{
    const repo=await getCampaignRepository(),base=getStore();assert.ok(base instanceof Store);
    const baseline=base.exportBackup(),{campaignData:_context,...legacy}=baseline;
    for(const snapshot of [baseline,{...legacy,schemaVersion:2 as const}]){
      const campaign=await repo.saveCampaign(target),run=await repo.createRun(campaign.id,10,randomUUID());
      await Promise.all(Array.from({length:8},()=>repo.getCampaign(campaign.id)));
      base.restoreBackup(snapshot,true);await resetCampaignRepository();
      assert.equal(await getCampaignRepository(),repo,'Restoration must not close a client shared by active requests.');
      assert.equal(base.exportBackup().schemaVersion,4);
      await assert.rejects(repo.getRun(run.id),/introuvable/);
      const manual=await repo.createCompany('initial',{name:'Après restauration',city:'Lyon',business:'Électricité',website:''});
      assert.equal(base.getCompany(manual.id)?.name,'Après restauration');
      assert.ok(base.exportBackup().companies.some(c=>c.id===manual.id));
    }
  }finally{
    const current=globalThis as typeof globals;
    if(current.campaignRepository)(await current.campaignRepository).close();current.brineStore?.close();current.brineCloudStore?.close();
    globals.campaignRepository=previous.repo;globals.brineStore=previous.store;globals.brineCloudStore=previous.cloud;
    for(const [key,value] of Object.entries(environment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    rmSync(dir,{recursive:true,force:true});
  }
});
for(const kind of ['local','cloud'] as const) {
  test(`${kind}: reopened campaign connections and immediate backup remain consistent after repeated restoration`,async()=>{
    const f=await fixture(kind);let repo=f.repo;
    try {
      const baseline=await f.base.exportBackup();
      for(let pass=0;pass<3;pass++){
        // Exercise the read pool used by dashboard/report requests, then replace its runtime handle.
        await Promise.all(Array.from({length:8},()=>repo.getCampaign('initial')));
        const campaign=await repo.saveCampaign({...target,name:`Cycle ${pass}`});
        const run=await repo.createRun(campaign.id,10,randomUUID()),entry=candidate(run.id,pass);
        await repo.transaction(async tx=>{await repo.putCandidate(tx,entry);await repo.putRun(tx,{...run,status:'completed'});});
        const snapshot=await f.base.exportBackup();
        assert.ok(snapshot.campaignData?.campaigns.some(c=>c.id===campaign.id));
        assert.equal(snapshot.campaignData?.runs.find(r=>r.id===run.id)?.status,'completed');
        assert.deepEqual(snapshot.campaignData?.candidates.filter(c=>c.runId===run.id).map(c=>c.id),(await repo.listCandidates(run.id)).map(c=>c.id));
        await f.base.restoreBackup(baseline,true);repo.close();
        repo=new CampaignRepository(createClient({url:`file:${f.path}`}));await repo.bootstrap();
        await assert.rejects(repo.getRun(run.id),/introuvable/);
        const restored=await f.base.exportBackup();
        assert.deepEqual(restored.campaignData?.campaigns.map(c=>c.id),baseline.campaignData?.campaigns.map(c=>c.id));
        assert.deepEqual(restored.campaignData?.runs.map(r=>r.id),baseline.campaignData?.runs.map(r=>r.id));
        assert.deepEqual(restored.campaignData?.candidates.map(c=>c.id),baseline.campaignData?.candidates.map(c=>c.id));
      }
    }finally{repo.close();f.close();}
  });
  test(`${kind}: empty registry identity permits multiple candidates and retains rejected discovery keys`,async()=>{
    const f=await fixture(kind);try {
      const campaign=await f.repo.saveCampaign(target),run=await f.repo.createRun(campaign.id,10,randomUUID()),a=candidate(run.id,0),b=candidate(run.id,1);
      await f.repo.transaction(async tx=>{await f.repo.putCandidate(tx,a);await f.repo.putCandidate(tx,b);});
      assert.equal((await f.repo.listCandidates(run.id)).length,2);
      await f.repo.reviewCandidate(a.id,1,'reject',[],[],'');
      assert.equal((await f.repo.seenCandidateKeys(campaign.id)).has(a.dedupeKey!),true);
      const id=(await f.repo.reviewCandidate(b.id,1,'accept',[],[0],''))!;
      assert.equal((await f.repo.getCompany(campaign.id,id)).contact.email,'contact1@atelier.test');
      assert.equal((await f.repo.knownSourceCompany('initial','maps','place-1'))?.companyId,id);
      await f.repo.setOpposition(campaign.id,id,true,'Demande explicite',false);
      assert.equal((await f.repo.knownSourceCompany('initial','maps','place-1'))?.opposed,true);
    }finally{f.close();}
  });
  test(`${kind}: complete report, provider profile and versions round-trip in backup v4 while ledger survives`,async()=>{
    const f=await fixture(kind);try {
      const context=await accepted(f),prep=await preparation(f,context);
      const stored=(await f.repo.getCandidate(context.c.id));
      stored.html={website:'https://atelier.test/',analyzedOn:'2026-10-04',pages:[{url:'https://atelier.test/',title:'L’atelier'}],contacts:[],findings:[],warnings:[],content:[{url:'https://atelier.test/',title:'Prestations déclarées',excerpt:'Nous présentons nos projets de rénovation électrique.',collectedAt:'2026-10-04T12:00:00.000Z'}]};
      stored.research!.report=buildProspectReport(stored,context.campaign);
      await f.repo.transaction(tx=>f.repo.putCandidate(tx,stored));
      const backup=await f.base.exportBackup();
      assert.equal(backup.schemaVersion,4);assert.equal(backupSchema.safeParse(backup).success,true);
      assert.equal(backup.campaignData?.candidates[0].research?.facts.length,12);
      assert.equal(backup.campaignData?.providerProfile?.name,'Alex');
      assert.equal(backup.campaignData?.candidates[0].html?.content?.[0].excerpt,stored.html.content?.[0].excerpt);
      const oversized=structuredClone(backup);oversized.campaignData!.candidates[0].html!.content=Array(9).fill(stored.html.content![0]);
      assert.equal(backupSchema.safeParse(oversized).success,false);
      await f.repo.client.execute({sql:"INSERT INTO research_operations(operationKey,provider,month,createdAt,updatedAt,status,reservedUsdMicros) VALUES('spent','openrouter','2026-10',?,?,'reserved',500000)",args:[new Date().toISOString(),new Date().toISOString()]});
      await f.repo.client.execute("INSERT INTO research_cache(cacheKey,expiresAt,payload) VALUES('saved','2099-01-01','{}')");
      await f.repo.client.execute("INSERT INTO research_provider_state(provider,payload) VALUES('serpapi','{}')");
      await f.repo.client.execute("INSERT INTO research_credit_purchases(id,date,amountEuroCents,notes,createdAt) VALUES('paid','2026-10-04',500,'Receipt','2026-10-04T00:00:00Z')");
      await f.base.restoreBackup(backup,true);
      assert.equal((await f.repo.client.execute('SELECT * FROM research_operations')).rows.length,1);
      assert.equal((await f.repo.client.execute('SELECT * FROM research_cache')).rows.length,1);
      assert.equal((await f.repo.client.execute('SELECT * FROM research_provider_state')).rows.length,1);
      assert.equal((await f.repo.client.execute('SELECT * FROM research_credit_purchases')).rows.length,1);
      const report=(await f.repo.getCompanyReport(context.campaign.id,context.id))!;
      assert.equal((await f.repo.getCandidate(context.c.id)).html?.content?.[0].excerpt,stored.html.content?.[0].excerpt);
      assert.equal(report.facts.filter(f=>f.id.startsWith('fact-0-')).length,12);
      assert.equal((await f.repo.getCompany(context.campaign.id,context.id)).drafts?.length,prep.drafts.length);
      assert.equal((await f.repo.getRun(context.run.id)).status,'paused');
    }finally{f.close();}
  });
  test(`${kind}: manually performed contact and follow-up are atomic and idempotent without granting readiness`,async()=>{
    const f=await fixture(kind);try {
      const context=await accepted(f),event:ContactEvent={id:randomUUID(),submittedKey:randomUUID(),date:parisToday(),channel:'email',outcome:'no_response',note:'Premier email envoyé',nextAction:{text:'Relire la réponse',date:'2026-10-20'}};
      const before=await f.repo.getCompany(context.campaign.id,context.id);
      await assert.rejects(f.repo.recordContact(context.campaign.id,context.id,{...event,date:'2099-01-01'},before.participationRevision),/jour passé/);
      const result=await f.repo.recordContact(context.campaign.id,context.id,event,before.participationRevision);
      assert.equal(result.contactEvents?.length,1);assert.equal(result.nextAction?.text,'Relire la réponse');assert.equal(result.stage,'À étudier');
      assert.equal(result.readiness,undefined);
      const activities=(await f.repo.listActivities(context.id)).length;
      const repeated=await f.repo.recordContact(context.campaign.id,context.id,event,before.participationRevision);
      assert.equal(repeated.contactEvents?.length,1);assert.equal(repeated.nextAction?.id,result.nextAction?.id);assert.equal((await f.repo.listActivities(context.id)).length,activities);
      const bad={...event,id:randomUUID(),submittedKey:randomUUID(),nextAction:{text:'Suite',date:''}};
      await assert.rejects(f.repo.recordContact(context.campaign.id,context.id,bad,result.participationRevision));
      assert.equal((await f.repo.getCompany(context.campaign.id,context.id)).contactEvents?.length,1);
    }finally{f.close();}
  });
  test(`${kind}: non-contact completion and accepted dated exchange step avoid duplicate entry`,async()=>{
    const f=await fixture(kind);try {
      const c=await f.repo.createCompany('initial',{name:'Fiche manuelle',website:'',city:'Lyon',business:'Électricité'});
      const action=await f.repo.setAction('initial',c.id,{text:'Lire la présentation',date:'2026-10-12'},null,c.participationRevision);
      const input={submittedKey:randomUUID(),note:'Présentation lue',date:'2026-10-01',nextAction:{text:'Vérifier le site',date:'2026-10-13'}};
      await assert.rejects(f.repo.completeActionWithOutcome('initial',c.id,action.nextAction!.id,{...input,date:'2026-02-30'},action.participationRevision),/date de réalisation réelle/);
      const done=await f.repo.completeActionWithOutcome('initial',c.id,action.nextAction!.id,input,action.participationRevision);
      await f.repo.completeActionWithOutcome('initial',c.id,action.nextAction!.id,input,action.participationRevision);
      assert.equal(done.contactEvents?.length,0);assert.equal(done.nextAction?.text,'Vérifier le site');
      assert.equal((await f.repo.listActivities(c.id)).filter(a=>a.kind==='action_done').length,1);
      assert.equal((await f.repo.listActivities(c.id)).find(a=>a.kind==='action_done')?.date,'2026-10-01');
      const next=await f.repo.saveAfterExchange('initial',c.id,{nextStep:{accepted:true,description:'Relire le périmètre',date:'2026-10-14'}},done.participationRevision);
      assert.equal(next.nextAction?.text,'Relire le périmètre');
      const same=await f.repo.saveAfterExchange('initial',c.id,{nextStep:{accepted:true,description:'Relire le périmètre',date:'2026-10-14'}},next.participationRevision);
      assert.equal(next.nextAction?.id,same.nextAction?.id);
      assert.ok(await f.repo.getCompanyReport('initial',c.id));
    }finally{f.close();}
  });
  test(`${kind}: corrections preserve old evidence, change dossier and invalidate all campaign preparations`,async()=>{
    const f=await fixture(kind);try {
      const context=await accepted(f),prep=await preparation(f,context),other=await f.repo.saveCampaign({...target,name:'Autre offre'});
      await f.repo.attach(other.id,context.id);
      await f.repo.correctReportFact(context.campaign.id,context.id,'fact-0-0','Le lien fonctionne dans un navigateur ; le blocage était lié au robot.',prep.company.participationRevision);
      const report=(await f.repo.getCompanyReport(context.campaign.id,context.id))!;
      assert.notEqual(report.id,prep.report.id);assert.equal(report.facts.find(f=>f.id==='fact-0-0')?.corrected,true);
      assert.equal(report.facts.some(f=>f.text.includes('Le lien fonctionne')),true);
      const company=await f.repo.getCompany(context.campaign.id,context.id);
      assert.equal(company.readiness?.reason,false);assert.ok(company.plan?.revalidateReason);
      const otherReport=(await f.repo.getCompanyReport(other.id,context.id))!;
      assert.equal(otherReport.facts.some(f=>f.text.includes('Le lien fonctionne')),true);
      const backup=await f.base.exportBackup();assert.equal(backupSchema.safeParse(backup).success,true);
      assert.equal(backup.campaignData?.corrections?.length,1);
      await f.base.restoreBackup(backup,true);
      assert.equal((await f.repo.getCompanyReport(context.campaign.id,context.id))?.facts.find(f=>f.id==='fact-0-0')?.corrected,true);
    }finally{f.close();}
  });
  test(`${kind}: old preparations and unverified identity merges are rejected`,async()=>{
    const f=await fixture(kind);try {
      const context=await accepted(f),prep=await preparation(f,context);
      await f.repo.saveProviderProfile({...prep.profile,signature:'Alex — Développeur'},prep.profile.revision);
      const company=await f.repo.getCompany(context.campaign.id,context.id);assert.ok(company.plan?.revalidateReason);
      await assert.rejects(f.repo.savePreparation(context.campaign.id,context.id,{drafts:prep.drafts.map(d=>({...d,id:randomUUID()}))},company.participationRevision),/courant|signature/);
      const run=await f.repo.createRun(context.campaign.id,10,randomUUID()),c=candidate(run.id,10);c.company.name='Atelier 0';c.research!.sources[0].externalId='different-place';
      await f.repo.transaction(tx=>f.repo.putCandidate(tx,c));
      await assert.rejects(f.repo.reviewCandidate(c.id,1,'accept',[],[],''),/Confirmez l’identité/);
      assert.equal((await f.base.listCompanies()).length,1);
    }finally{f.close();}
  });
  test(`${kind}: draft edits retain immutable used versions and restoration does not reopen submission keys`,async()=>{
    const f=await fixture(kind);try {
      const context=await accepted(f),prep=await preparation(f,context),original=prep.drafts.find(d=>d.channel==='email')!;
      const edited=await f.repo.savePreparation(context.campaign.id,context.id,{drafts:[{...original,text:`${original.text}\nVersion relue.`,version:original.version+1}]},prep.company.participationRevision);
      const versions=edited.drafts!.filter(d=>d.channel==='email');
      assert.equal(versions.length,2);assert.notEqual(versions[0].id,versions[1].id);assert.equal(versions[0].text,original.text);
      const beforeContact=await f.base.exportBackup();
      const event:ContactEvent={id:randomUUID(),submittedKey:randomUUID(),date:parisToday(),channel:'email',outcome:'no_response',note:'Ancienne version effectivement utilisée.',draftId:original.id,nextAction:null};
      const used=await f.repo.recordContact(context.campaign.id,context.id,event,edited.participationRevision);
      assert.ok(used.drafts!.find(d=>d.id===original.id)?.usedAt);
      assert.equal(used.drafts!.find(d=>d.id===versions[1].id)?.usedAt,undefined);
      await f.base.restoreBackup(beforeContact,true);
      const rowsBefore=(await f.repo.listActivities(context.id)).length;
      const replay=await f.repo.recordContact(context.campaign.id,context.id,event,edited.participationRevision);
      assert.equal(replay.contactEvents?.length,0);
      assert.equal((await f.repo.listActivities(context.id)).length,rowsBefore);
      await assert.rejects(f.repo.recordContact(context.campaign.id,context.id,{...event,note:'Différent'},edited.participationRevision),/d’autres informations/);
      const action=await f.repo.setAction(context.campaign.id,context.id,{text:'Lire une page',date:'2026-10-20'},null,replay.participationRevision);
      const beforeAction=await f.base.exportBackup(),input={submittedKey:randomUUID(),note:'Page lue',nextAction:null};
      await f.repo.completeActionWithOutcome(context.campaign.id,context.id,action.nextAction!.id,input,action.participationRevision);
      await f.base.restoreBackup(beforeAction,true);
      const result=await f.repo.completeActionWithOutcome(context.campaign.id,context.id,action.nextAction!.id,input,action.participationRevision);
      assert.equal(result.nextAction?.id,action.nextAction!.id);
      assert.equal((await f.repo.client.execute('SELECT * FROM research_submissions')).rows.length,2);
      await assert.rejects(f.repo.completeActionWithOutcome(context.campaign.id,context.id,action.nextAction!.id,{...input,note:'Autre'},action.participationRevision),/d’autres informations/);
    }finally{f.close();}
  });
  test(`${kind}: identical revalidation keeps the canonical plan while historical proposal IDs cannot replace other content`,async()=>{
    const f=await fixture(kind);try{
      const context=await accepted(f),prep=await preparation(f,context),proposalId=prep.plan.id;
      const firstPersonal={...prep.plan,question:'Comment préférez-vous présenter vos prestations aux nouveaux interlocuteurs ?',createdAt:'2026-10-04T13:00:00.000Z'};
      const first=await f.repo.savePreparation(context.campaign.id,context.id,{plan:firstPersonal,drafts:buildContactDrafts(firstPersonal,prep.report,prep.profile)},prep.company.participationRevision);
      assert.notEqual(first.plan?.id,proposalId);
      const personalId=first.plan!.id,personalCreatedAt=first.plan!.createdAt;
      const firstDrafts=first.drafts!.filter(draft=>draft.planId===personalId);
      assert.equal(firstDrafts.length,2);
      const identical={...firstPersonal,createdAt:'2026-10-04T14:00:00.000Z'};
      const repeated=await f.repo.savePreparation(context.campaign.id,context.id,{plan:identical,drafts:buildContactDrafts(identical,prep.report,prep.profile)},first.participationRevision);
      assert.equal(repeated.plan?.id,personalId);assert.equal(repeated.plan?.createdAt,personalCreatedAt);
      assert.equal(repeated.planHistory?.length,1);
      for(const draft of firstDrafts)assert.deepEqual(repeated.drafts!.find(d=>d.id===draft.id),draft);
      assert.equal(repeated.drafts!.filter(d=>d.planId===personalId).length,4);
      const secondPersonal={...firstPersonal,question:'Quel canal souhaitez-vous privilégier pour vos prochaines demandes ?',createdAt:'2026-10-04T15:00:00.000Z'};
      const second=await f.repo.savePreparation(context.campaign.id,context.id,{plan:secondPersonal,drafts:buildContactDrafts(secondPersonal,prep.report,prep.profile)},repeated.participationRevision);
      assert.notEqual(second.plan?.id,proposalId);assert.notEqual(second.plan?.id,personalId);
      const plans=[...(second.planHistory||[]),second.plan!];
      assert.equal(new Set(plans.map(plan=>plan.id)).size,plans.length);
      assert.equal(plans.find(plan=>plan.id===proposalId)?.question,prep.plan.question);
      assert.equal(plans.find(plan=>plan.id===personalId)?.question,firstPersonal.question);
      assert.equal(second.plan?.question,secondPersonal.question);
      for(const draft of second.drafts!)assert.ok(plans.some(plan=>plan.id===draft.planId),'Every immutable draft keeps its exact plan.');
      for(const draft of firstDrafts)assert.deepEqual(second.drafts!.find(d=>d.id===draft.id),draft);
      const latestDraft=second.drafts!.find(d=>d.planId===second.plan!.id)!;
      const edited=await f.repo.savePreparation(context.campaign.id,context.id,{drafts:[{...latestDraft,text:latestDraft.text+'\nTexte relu.'}]},second.participationRevision);
      assert.equal(edited.plan?.id,second.plan?.id);
      assert.equal(edited.drafts!.at(-1)?.planId,second.plan?.id);
      const snapshot=await f.base.exportBackup();await f.base.restoreBackup(snapshot,true);
      const restored=await f.repo.getCompany(context.campaign.id,context.id),restoredPlans=[...(restored.planHistory||[]),restored.plan!];
      assert.deepEqual(restoredPlans,plans);
      for(const draft of restored.drafts!)assert.ok(restoredPlans.some(plan=>plan.id===draft.planId));
    }finally{f.close();}
  });
  test(`${kind}: correcting an accepted result changes selection without duplicating its company or erasing history`,async()=>{
    const f=await fixture(kind);try {
      const context=await accepted(f),candidate=await f.repo.getCandidate(context.c.id);
      const changed=await f.repo.correctDecision(candidate.id,candidate.revision,'accept',['fact-0-1'],[0],'Autre piste sourcée');
      assert.equal(changed,context.id);assert.equal((await f.base.listCompanies()).length,1);
      const company=await f.repo.getCompany(context.campaign.id,context.id);
      assert.deepEqual(company.findingIds,[`${candidate.id}:fact-0-1`]);
      assert.equal(company.approach,'Autre piste sourcée');
      const history=await f.repo.listActivities(context.id);
      assert.equal(history.filter(a=>a.type==='Constat retenu').length,2);
      const confirmed=await f.repo.getCandidate(candidate.id);
      await f.repo.correctDecision(candidate.id,confirmed.revision,'accept');
      assert.deepEqual((await f.repo.getCompany(context.campaign.id,context.id)).findingIds,[`${candidate.id}:fact-0-1`]);
      const blankSelection=await f.repo.getCandidate(candidate.id);
      await f.repo.correctDecision(candidate.id,blankSelection.revision,'accept',[],[],'',true);
      assert.deepEqual((await f.repo.getCompany(context.campaign.id,context.id)).findingIds,[]);
      assert.equal((await f.repo.listActivities(context.id)).filter(a=>a.type==='Constat retenu').length,2);
      const latest=await f.repo.getCandidate(candidate.id);
      await f.repo.correctDecision(candidate.id,latest.revision,'reject');
      assert.equal((await f.repo.getCandidate(candidate.id)).status,'rejected');
      assert.equal((await f.repo.memberships(context.id)).length,1);
      assert.ok(await f.repo.getCompanyReport(context.campaign.id,context.id));
    }finally{f.close();}
  });
  test(`${kind}: removing an accepted candidate archives only its campaign participation and retains every dossier version`,async()=>{
    const f=await fixture(kind);try{
      const context=await accepted(f),prep=await preparation(f,context),other=await f.repo.saveCampaign({...target,name:'Deuxième campagne'});
      await f.repo.attach(other.id,context.id);
      const otherBefore=await f.repo.getCompany(other.id,context.id),otherAction=await f.repo.setAction(other.id,context.id,{text:'Lire le dossier',date:'2026-10-20'},null,otherBefore.participationRevision);
      const action=await f.repo.setAction(context.campaign.id,context.id,{text:'Contact envisagé',date:'2026-10-20'},null,prep.company.participationRevision);
      const current=await f.repo.getCandidate(context.c.id);
      await assert.rejects(f.repo.removeCandidateParticipation(current.id,current.revision,action.participationRevision-1),/suivi a changé/);
      assert.equal(await f.repo.removeCandidateParticipation(current.id,current.revision,action.participationRevision),context.id);
      const archived=await f.repo.getCompany(context.campaign.id,context.id),untouched=await f.repo.getCompany(other.id,context.id);
      assert.equal(archived.archived,true);assert.equal(archived.nextAction,null);
      assert.deepEqual(archived.findingIds,prep.company.findingIds);assert.deepEqual(archived.drafts,prep.company.drafts);
      assert.equal(untouched.archived,false);assert.equal(untouched.nextAction?.id,otherAction.nextAction?.id);
      assert.equal((await f.base.getCompany(context.id))?.archived,false);
      assert.equal((await f.repo.getCandidate(current.id)).status,'accepted');
      assert.equal((await f.repo.getCompanyReport(context.campaign.id,context.id))?.facts.filter(f=>f.id.startsWith('fact-0-')).length,12);
      const snapshot=await f.base.exportBackup();await f.base.restoreBackup(snapshot,true);
      assert.equal((await f.repo.getCompany(context.campaign.id,context.id)).archived,true);
      assert.equal((await f.base.getCompany(context.id))?.archived,false);
    }finally{f.close();}
  });
  test(`${kind}: actual contact retains the exact old draft despite changed profile, evidence and missing coordinates`,async()=>{
    const f=await fixture(kind);try{
      const context=await accepted(f),prep=await preparation(f,context),draft=prep.drafts.find(d=>d.channel==='email')!;
      await f.repo.saveProviderProfile({...prep.profile,activity:'Développeur et accompagnateur'},prep.profile.revision);
      const changed=await f.repo.getCompany(context.campaign.id,context.id);
      const withoutCoordinates=await f.repo.updateCompany(context.campaign.id,context.id,{...changed,contact:{...changed.contact,email:'',phone:''}},changed.participationRevision,changed.updatedAt);
      const result=await f.repo.recordContact(context.campaign.id,context.id,{id:randomUUID(),submittedKey:randomUUID(),date:'2026-10-01',channel:'email',outcome:'conversation',note:'Échange réalisé avant la saisie dans Brine.',draftId:draft.id,nextAction:null},withoutCoordinates.participationRevision);
      assert.equal(result.stage,'En échange');assert.equal(result.contactEvents?.[0].draftId,draft.id);
      assert.equal(result.drafts?.find(d=>d.id===draft.id)?.text,draft.text);assert.ok(result.drafts?.find(d=>d.id===draft.id)?.usedAt);
      assert.deepEqual(result.readiness,withoutCoordinates.readiness);
      assert.equal(result.contact.email,'');assert.equal((await f.repo.listActivities(context.id)).find(a=>a.type==='Contact effectué')?.date,'2026-10-01');
      await assert.rejects(f.repo.recordContact(context.campaign.id,context.id,{id:randomUUID(),submittedKey:randomUUID(),date:parisToday(),channel:'phone',outcome:'no_response',note:'Version inconnue',draftId:randomUUID(),nextAction:null},result.participationRevision),/version utilisée.*introuvable/i);
    }finally{f.close();}
  });
  test(`${kind}: opposition is recorded without preparation or coordinates, cancels every campaign action and forbids future contacts`,async()=>{
    const f=await fixture(kind);try{
      const company=await f.repo.createCompany('initial',{name:'Entreprise sans coordonnées',website:'',city:'Lyon',business:'Électricité'}),other=await f.repo.saveCampaign({...target,name:'Autre suivi'});
      await f.repo.attach(other.id,company.id);
      const first=await f.repo.setAction('initial',company.id,{text:'Lire la présentation',date:'2026-10-20'},null,company.participationRevision);
      const second=await f.repo.getCompany(other.id,company.id);await f.repo.setAction(other.id,company.id,{text:'Vérifier la source',date:'2026-10-20'},null,second.participationRevision);
      const initial=await f.repo.getCampaign('initial');await f.repo.setCampaignStatus('initial','paused',initial.revision);
      const event:ContactEvent={id:randomUUID(),submittedKey:randomUUID(),date:parisToday(),channel:'phone',outcome:'opposition',note:'La personne demande de ne plus être contactée.',nextAction:{text:'Ancienne valeur du formulaire à ignorer',date:'2026-10-20'}};
      const result=await f.repo.recordContact('initial',company.id,event,first.participationRevision);
      assert.equal(result.oppositionActive,true);assert.equal(result.nextAction,null);assert.equal(result.contactEvents?.[0].nextAction,null);assert.equal(result.readiness,undefined);
      assert.equal((await f.repo.getCompany(other.id,company.id)).nextAction,null);
      assert.match((await f.repo.listActivities(company.id)).find(a=>a.type==='Contact effectué')?.text||'',/toutes les prochaines actions sont annulées/);
      await f.repo.recordContact('initial',company.id,event,first.participationRevision);
      assert.equal((await f.repo.getCompany('initial',company.id)).contactEvents?.length,1);
      const otherCurrent=await f.repo.getCompany(other.id,company.id);
      await assert.rejects(f.repo.recordContact(other.id,company.id,{...event,id:randomUUID(),submittedKey:randomUUID(),outcome:'no_response',nextAction:null},otherCurrent.participationRevision),/ne doit plus être contactée/);
      await assert.rejects(f.repo.setAction(other.id,company.id,{text:'Relance interdite',date:'2026-10-20'},null,otherCurrent.participationRevision),/ne doit plus être contactée/);
      assert.equal(backupSchema.safeParse(await f.base.exportBackup()).success,true);
    }finally{f.close();}
  });
  test(`${kind}: refuting an approach hypothesis preserves the observed fact and its backup history`,async()=>{
    const f=await fixture(kind);try {
      const context=await accepted(f),prep=await preparation(f,context);
      await f.repo.correctReportFact(context.campaign.id,context.id,'fact-0-0','Le devis se reçoit uniquement par téléphone ; ce lien n’est pas utilisé pour les demandes.',prep.company.participationRevision,'hypothesis');
      const report=(await f.repo.getCompanyReport(context.campaign.id,context.id))!;
      assert.notEqual(report.id,prep.report.id);
      assert.equal(Boolean(report.facts.find(f=>f.id==='fact-0-0')?.corrected),false);
      assert.equal(report.facts.some(f=>f.text.includes('Hypothèse réfutée')),true);
      const company=await f.repo.getCompany(context.campaign.id,context.id);
      assert.equal(company.readiness?.reason,false);assert.match(company.plan?.revalidateReason||'',/hypothèse/);
      const backup=await f.base.exportBackup();assert.equal(backupSchema.safeParse(backup).success,true);
      assert.equal(backup.campaignData?.corrections?.[0].mode,'hypothesis');
      await f.base.restoreBackup(backup,true);
      assert.equal(Boolean((await f.repo.getCompanyReport(context.campaign.id,context.id))!.facts.find(f=>f.id==='fact-0-0')?.corrected),false);
    }finally{f.close();}
  });
  test(`${kind}: inline professional contact saves public provenance without replacing qualification or unrelated contact fields`,async()=>{
    const f=await fixture(kind);try {
      const context=await accepted(f),other=await f.repo.saveCampaign({...target,name:'Autre cible'});await f.repo.attach(other.id,context.id);
      const before=await f.repo.getCompany(context.campaign.id,context.id);
      await f.repo.updateCompany(context.campaign.id,context.id,{...before,contact:{...before.contact,name:'Lou',role:'Responsable',profileUrl:'https://instagram.com/atelier0/'}},before.participationRevision,before.updatedAt);
      const original=await f.repo.getCompany(context.campaign.id,context.id);
      const saved=await f.repo.saveProfessionalContact(context.campaign.id,context.id,{email:'lou@atelier.test',phone:'0612345678',sourceUrl:'https://atelier.test/contact'},original.participationRevision,original.updatedAt);
      assert.equal(saved.contact.name,'Lou');assert.equal(saved.contact.role,'Responsable');assert.equal(saved.contact.profileUrl,'https://instagram.com/atelier0/');
      assert.deepEqual(saved.qualification,original.qualification);assert.equal(saved.stage,original.stage);
      const report=(await f.repo.getCompanyReport(context.campaign.id,context.id))!;
      assert.equal(report.contacts.find(c=>c.kind==='email'&&c.value==='lou@atelier.test')?.sourceUrl,'https://atelier.test/contact');
      assert.equal(report.contacts.find(c=>c.kind==='phone'&&c.value==='0612345678')?.sourceUrl,'https://atelier.test/contact');
      assert.equal((await f.repo.getCompany(other.id,context.id)).contact.email,'lou@atelier.test');
      await assert.rejects(f.repo.saveProfessionalContact(context.campaign.id,context.id,{email:'invalid',phone:'',sourceUrl:'https://atelier.test/'},saved.participationRevision));
      await assert.rejects(f.repo.saveProfessionalContact(context.campaign.id,context.id,{email:'pro@atelier.test',phone:'',sourceUrl:'https://atelier.test/'},saved.participationRevision,original.updatedAt),/informations communes/);
      const backup=await f.base.exportBackup();await f.base.restoreBackup(backup,true);
      assert.equal((await f.repo.getCompanyReport(context.campaign.id,context.id))!.contacts.find(c=>c.value==='lou@atelier.test')?.sourceUrl,'https://atelier.test/contact');
    }finally{f.close();}
  });
}
