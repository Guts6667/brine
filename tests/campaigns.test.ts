import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { Store } from '../lib/db';
import { AsyncCloudStore } from '../lib/cloud-db';
import { CampaignRepository } from '../lib/campaign-repository';
import { campaignSql } from '../lib/campaign-schema';
import { backupSchema } from '../lib/domain';
import { emptyQualification,captureTarget } from '../lib/qualification';
import { populateRun,processCandidate,processMobile,finishRun,type DiscoveryProviders } from '../lib/discovery-engine';
import { discoverWebsites } from '../lib/site-discovery';
import type { Company, CompanyDetails } from '../lib/types';

async function fixture(kind:'local'|'cloud'){
  const dir=mkdtempSync(join(tmpdir(),'brine-campaigns-')),path=join(dir,'test.sqlite');
  const base=kind==='local'?new Store(path):new AsyncCloudStore(createClient({url:`file:${path}`}));await base.listCompanies();
  const repo=new CampaignRepository(createClient({url:`file:${path}`}));
  return {base,repo,dir,path,close(){repo.close();base.close();rmSync(dir,{recursive:true,force:true});}};
}
const details=(c:Company):CompanyDetails=>({name:c.name,website:c.website,city:c.city,business:c.business,targetFit:c.targetFit,problemFound:c.problemFound,contactAvailable:c.contactAvailable,observation:c.observation,proofUrl:c.proofUrl,observedOn:c.observedOn,trigger:c.trigger,stage:c.stage,contact:{...c.contact}});
const target={name:'Électriciens Lyon',targetCity:'Lyon',targetBusiness:'Électricité',targetCompanyType:'Artisans',targetOffer:'Améliorer les devis',targetExclusions:'Franchises',activityCodes:'43.21A'};
const company={siren:'490484557',siret:'49048455700023',name:'Atelier Test',city:'Lyon',business:'Électricité',activityCode:'43.21A',address:'1 rue Test',sourceUrl:'https://annuaire-entreprises.data.gouv.fr/entreprise/490484557'};
const providers:DiscoveryProviders={
  search:async()=>({companies:[company],total:1,page:1,totalPages:1,commune:{name:'Lyon',code:'69123'}}),
  sites:async()=>({websites:[{url:'https://atelier.test/',sourceUrl:'https://data.ademe.fr/datasets/liste-des-entreprises-rge-2-new',confidence:'exact'}],warnings:[]}),
  html:async website=>({website,analyzedOn:'2026-10-04',pages:[{url:website,title:'Atelier'}],contacts:[{kind:'email',value:'contact@atelier.test',sourceUrl:website}],findings:[{id:'broken-quote',key:'technical',note:'Le lien devis renvoie HTTP 404.',sourceUrl:website,approach:'Proposer de rétablir la demande de devis.'}],warnings:[]}),
  mobile:async()=>{throw new Error('HTTP 429 : quota indisponible.');},
};

test('campaign migration SQL is identical in local and embedded cloud schema',()=>{assert.equal(readFileSync('migrations/003_campaigns.sql','utf8').trim(),campaignSql.trim());});
for(const kind of ['local','cloud'] as const){
 test(`${kind}: migration preserves existing qualification, action, archive and history once`,async()=>{const f=await fixture(kind);try{
  const c=await f.base.createCompany({name:'Ancienne entreprise',website:'',city:'Montpellier',business:'Rénovation'});await f.base.setAction(c.id,{text:'Appeler',date:'2026-10-10'});await f.base.setArchived(c.id,true);const legacy=await f.base.getCompany(c.id);
  await f.repo.bootstrap();await f.repo.bootstrap();const projected=await f.repo.getCompany('initial',c.id);assert.equal(projected.archived,true);assert.equal(projected.nextAction?.id,legacy?.nextAction?.id);assert.deepEqual(projected.qualification,legacy?.qualification);assert.equal((await f.repo.listCampaigns()).length,1);assert.equal((await f.repo.listActivities(c.id))[0].campaignId,'initial');
 }finally{f.close();}});
 test(`${kind}: shared company has independent campaign qualification, actions and stages`,async()=>{const f=await fixture(kind);try{
  await f.repo.bootstrap();const c=await f.repo.createCompany('initial',{name:'Commune',website:'',city:'Lyon',business:'Électricité'}),campaign=await f.repo.saveCampaign(target);await f.repo.attach(campaign.id,c.id);
  const answers=emptyQualification().answers;answers.fit.answer='exact';answers.fit.note='Activité vérifiée';await f.repo.saveQualification(campaign.id,c.id,{answers},true,captureTarget(campaign),1);
  assert.equal((await f.repo.getCompany('initial',c.id)).qualification?.answers.fit.answer,'unknown');
  await f.repo.setAction('initial',c.id,{text:'Premier appel',date:'2026-10-10'},null,1);await f.repo.setAction(campaign.id,c.id,{text:'Autre offre',date:'2026-10-11'},null,2);
  const a=await f.repo.getCompany('initial',c.id),b=await f.repo.getCompany(campaign.id,c.id);await f.repo.changeAction('initial',c.id,a.nextAction!.id,'complete','',a.participationRevision);
  assert.equal((await f.repo.getCompany('initial',c.id)).nextAction,null);assert.equal((await f.repo.getCompany(campaign.id,c.id)).nextAction?.id,b.nextAction?.id);
  const input=details(await f.repo.getCompany('initial',c.id));input.stage='En échange';input.contact.email='pro@commune.test';await f.repo.updateCompany('initial',c.id,input,3);
  const other=await f.repo.getCompany(campaign.id,c.id);assert.equal(other.stage,'À étudier');assert.equal(other.contact.email,'pro@commune.test');
  const stale=details(b);stale.contact.email='stale@commune.test';await assert.rejects(f.repo.updateCompany(campaign.id,c.id,stale,b.participationRevision,b.updatedAt),/informations communes ont changé/);assert.equal((await f.repo.getCompany(campaign.id,c.id)).contact.email,'pro@commune.test');
  await assert.rejects(f.repo.setAction('initial',c.id,{text:'Obsolète',date:''},null,1),/changé/);
  await f.repo.setOpposition('initial',c.id,true,'Demande explicite',false);assert.equal((await f.repo.getCompany(campaign.id,c.id)).nextAction,null);await assert.rejects(f.repo.setAction(campaign.id,c.id,{text:'Interdit',date:''}),/plus être contactée/);await assert.rejects(f.repo.setOpposition('initial',c.id,false,'',false),/explicitement/);
 }finally{f.close();}});
 test(`${kind}: target snapshots and archived campaigns preserve history and require revalidation`,async()=>{const f=await fixture(kind);try{
  await f.repo.bootstrap();const campaign=await f.repo.saveCampaign(target),c=await f.repo.createCompany(campaign.id,{name:'Artisan',website:'',city:'Lyon',business:'Électricité'});
  const changed=await f.repo.saveCampaign({...target,targetCity:'Paris'},campaign.id,campaign.revision);await assert.rejects(f.repo.saveQualification(campaign.id,c.id,{answers:emptyQualification().answers},true,captureTarget(campaign),1),/cible a changé/);
  const run=await f.repo.createRun(campaign.id,10,randomUUID());await f.repo.setCampaignStatus(campaign.id,'archived',changed.revision);assert.equal((await f.repo.getRun(run.id)).status,'paused');assert.equal((await f.repo.getCompany(campaign.id,c.id)).archived,true);assert.equal((await f.repo.listActivities(c.id)).length,1);
 }finally{f.close();}});
 test(`${kind}: durable lot partial failures, bounded retries, review and duplicate imports`,async()=>{const f=await fixture(kind);try{
  await f.repo.bootstrap();const campaign=await f.repo.saveCampaign(target),key=randomUUID();const run=await f.repo.createRun(campaign.id,10,key),same=await f.repo.createRun(campaign.id,10,key);assert.equal(run.id,same.id);
  const epoch=await f.repo.epoch(),claimed=(await f.repo.claimRun(run.id,'worker',epoch))!;assert.ok(claimed);assert.equal(await f.repo.claimRun(run.id,'other',epoch),null);
  await populateRun(f.repo,claimed,epoch,providers);const candidate=(await f.repo.listCandidates(run.id))[0];await processCandidate(f.repo,claimed,candidate.id,epoch,providers);
  assert.equal(await processMobile(f.repo,claimed,candidate.id,epoch,providers),true);assert.equal(await processMobile(f.repo,claimed,candidate.id,epoch,providers),true);assert.equal(await processMobile(f.repo,claimed,candidate.id,epoch,providers),false);await finishRun(f.repo,claimed,epoch);
  const ready=await f.repo.getCandidate(candidate.id);assert.ok(ready.html);assert.equal(ready.status,'review');assert.equal(ready.attempts.mobile,3);assert.match(ready.mobileError,/429/);
  const id=await f.repo.reviewCandidate(ready.id,ready.revision,'accept',['broken-quote'],[0],'Rétablir les devis');assert.ok(id);assert.equal((await f.repo.getCompany(campaign.id,id!)).contact.email,'contact@atelier.test');assert.equal((await f.repo.getCompany(campaign.id,id!)).qualification?.answers.problem.answer,'unknown');assert.equal((await f.repo.retainedFindings(campaign.id,id!)).length,1);
  const nextCampaign=await f.repo.saveCampaign({...target,name:'Deuxième offre'}),run2=await f.repo.createRun(nextCampaign.id,10,randomUUID()),claim2=(await f.repo.claimRun(run2.id,'second',epoch))!;await populateRun(f.repo,claim2,epoch,providers);const c2=(await f.repo.listCandidates(run2.id))[0];const id2=await f.repo.reviewCandidate(c2.id,c2.revision,'accept',[],[],'Nouvelle offre');assert.equal(id2,id);assert.equal((await f.base.listCompanies()).length,1);assert.equal((await f.repo.memberships(id!)).length,2);
  const redundant=await f.repo.createRun(campaign.id,10,randomUUID());await finishRun(f.repo,claim2,epoch);const redundantClaim=(await f.repo.claimRun(redundant.id,'third',epoch))!;await populateRun(f.repo,redundantClaim,epoch,providers);assert.equal((await f.repo.listCandidates(redundant.id)).length,0);
  assert.equal((await f.repo.knownRegistryCompany(campaign.id,company.siren))?.inCampaign,true);
 }finally{f.close();}});
 test(`${kind}: independent workers claim one global batch and failed writes roll back`,async()=>{const f=await fixture(kind),other=new CampaignRepository(createClient({url:`file:${f.path}`}));try{
  await f.repo.bootstrap();const c=await f.repo.saveCampaign(target),epoch=await f.repo.epoch(),a=await f.repo.createRun(c.id,10,randomUUID()),b=await f.repo.createRun(c.id,10,randomUUID());
  const claims=await Promise.all([f.repo.claimRun(a.id,'worker-a',epoch),other.claimRun(b.id,'worker-b',epoch)]);assert.equal(claims.filter(Boolean).length,1);
  const active=claims.find(Boolean)!;await f.repo.transaction(async tx=>{await f.repo.putRun(tx,{...active,leaseUntil:new Date(0).toISOString()});});
  const recovered=(await other.claimRun(active.id,'recovered',epoch))!;assert.ok(recovered);assert.equal(await f.repo.guardedRun(active.id,active.owner,active.generation,epoch,async()=>{throw new Error('old worker must not execute');}),false);
  await assert.rejects(f.repo.guardedRun(recovered.id,recovered.owner,recovered.generation,epoch,async tx=>{await tx.execute({sql:'UPDATE discovery_runs SET payload = ? WHERE id = ?',args:[JSON.stringify({...recovered,error:'uncommitted'}),recovered.id]});throw new Error('Injected write failure');}),/Injected/);
  assert.equal((await other.getRun(active.id)).error,'');
 }finally{other.close();f.close();}});
 test(`${kind}: pause and restoration invalidate old workers; backup v3 round-trips`,async()=>{const f=await fixture(kind);try{
  await f.repo.bootstrap();const campaign=await f.repo.saveCampaign(target),c=await f.repo.createCompany(campaign.id,{name:'Persistante',website:'',city:'Lyon',business:'Électricité'});await f.repo.setAction(campaign.id,c.id,{text:'Appeler',date:'2026-10-12'});const run=await f.repo.createRun(campaign.id,10,randomUUID()),epoch=await f.repo.epoch(),claimed=(await f.repo.claimRun(run.id,'old',epoch))!;
  await f.repo.controlRun(run.id,'pause');assert.equal(await f.repo.guardedRun(run.id,'old',claimed.generation,epoch,async()=>{throw new Error('must not execute');}),false);
  const backup=await f.base.exportBackup();assert.equal(backup.schemaVersion,3);assert.equal(backupSchema.safeParse(backup).success,true);await f.repo.setOpposition(campaign.id,c.id,true,'Opposition',false);
  await f.base.restoreBackup(backup,true);const result=await f.repo.getCompany(campaign.id,c.id);assert.equal(result.oppositionActive,true);assert.equal(result.nextAction,null);assert.equal((await f.repo.getRun(run.id)).status,'paused');assert.notEqual(await f.repo.epoch(),epoch);assert.equal(await f.repo.claimRun(run.id,'old',epoch),null);
  const forged=structuredClone(await f.base.exportBackup());forged.campaignData!.participations[0].campaignId='missing';assert.equal(backupSchema.safeParse(forged).success,false);
 }finally{f.close();}});
 test(`${kind}: ambiguous sites do not block other candidates and cancelled generations cannot commit`,async()=>{const f=await fixture(kind);try{
  await f.repo.bootstrap();const run=await f.repo.createRun('initial',10,randomUUID()),epoch=await f.repo.epoch(),claimed=(await f.repo.claimRun(run.id,'worker',epoch))!;await populateRun(f.repo,claimed,epoch,providers);const c=(await f.repo.listCandidates(run.id))[0];await processCandidate(f.repo,claimed,c.id,epoch,{...providers,sites:async()=>({websites:[],warnings:['Source indisponible']})});assert.equal((await f.repo.getCandidate(c.id)).status,'needs_site');
  await f.repo.controlRun(run.id,'cancel');assert.equal(await f.repo.guardedRun(run.id,'worker',claimed.generation,epoch,async()=>{throw new Error('must not execute');}),false);
 }finally{f.close();}});
}
test('ADEME matches exact SIRET, deduplicates certifications and never accepts directory URLs',async()=>{
 let requests=0;const fetcher=(async()=>{requests++;return new Response(JSON.stringify({results:[{siret:company.siret,site_internet:'atelier.test'},{siret:company.siret,site_internet:'https://atelier.test/'},{siret:'00000000000000',site_internet:'wrong.test'},{siret:company.siret,site_internet:'https://facebook.com/atelier'}]}));}) as typeof fetch;
 const result=await discoverWebsites(company,fetcher);assert.equal(result.websites.length,1);assert.equal(result.websites[0].confidence,'exact');assert.equal(requests,1);
});
