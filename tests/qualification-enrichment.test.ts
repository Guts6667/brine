import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { Store } from '../lib/db';
import { AsyncCloudStore } from '../lib/cloud-db';
import { CampaignRepository } from '../lib/campaign-repository';
import { emptyQualification,captureTarget,evaluateQualification } from '../lib/qualification';
import { proposeQualification,isConfirmedFact,qualificationListFindings } from '../lib/qualification-enrichment';
import { getEligibleApproachEvidence } from '../lib/contact-preparation';
import { enrichmentSql } from '../lib/enrichment-schema';
import { cloudMigrations } from '../lib/cloud-schema';
import { picklesProviderProfile,withDefaultProviderProfile } from '../lib/provider-profile';
import { parisToday,backupSchema } from '../lib/domain';
import { visualCaptureFixture } from './fixtures/visual-capture';
import { getResearchAsset } from '../lib/research-assets';
import type { DiscoveryCandidate } from '../lib/campaign-types';
const target={name:'Artisans',targetCity:'Montpellier',targetBusiness:'Rénovation',targetCompanyType:'Artisans',targetOffer:'',targetExclusions:'',keywords:'rénovation',activityCodes:''};
async function fixture(kind:'local'|'cloud'){
 const dir=mkdtempSync(join(tmpdir(),'brine-enrichment-')),path=join(dir,'data.sqlite'),base=kind==='local'?new Store(path):new AsyncCloudStore(createClient({url:`file:${path}`}));await base.listCompanies();const repo=new CampaignRepository(createClient({url:`file:${path}`}));await repo.bootstrap();const campaign=await repo.saveCampaign(target),run=await repo.createRun(campaign.id,10,randomUUID());
 const c:DiscoveryCandidate={id:randomUUID(),runId:run.id,companyId:null,company:{name:'Atelier',siren:'',siret:'',city:'Montpellier',business:'Rénovation',activityCode:'',address:'',sourceUrl:'https://artisan.example/'},website:'https://artisan.example/',websites:[],status:'review',html:null,mobile:null,htmlError:'',mobileError:'',attempts:{},revision:1,research:{sources:[{id:'source',provider:'website',url:'https://artisan.example/',title:'Réalisations',excerpt:'Page consultée',collectedAt:parisToday()}],facts:[{id:'visual',kind:'hypothesis',section:'site',sentiment:'issue',text:'Le bouton Comparer recouvre les photos des réalisations.',sourceIds:['source'],observedOn:parisToday(),scope:'Capture de cette section seulement.',visual:{category:'overlap',device:'desktop',element:'Comparer avant/après',pageUrl:'https://artisan.example/',screenshot:visualCaptureFixture,viewport:{width:1280,height:900}},review:{state:'proposed',nature:'observation',provenance:'vision'}}],contacts:[{kind:'email',value:'contact@artisan.example',sourceId:'source',sourceUrl:'https://artisan.example/'}],profiles:[],warnings:[]}};
 await repo.transaction(tx=>repo.putCandidate(tx,c));return {base,repo,campaign,run,c,close(){repo.close();base.close();rmSync(dir,{force:true,recursive:true});}};
}
test('enrichment migration and Pickles defaults are shared without overwriting a custom provider profile',()=>{
 assert.equal(enrichmentSql.trim(),readFileSync('migrations/005_enrichment.sql','utf8').trim());assert.equal(cloudMigrations.find(m=>m.version===6)?.sql,enrichmentSql);
 const custom={...picklesProviderProfile(),name:'Autre studio',services:'Conseil'};assert.deepEqual(withDefaultProviderProfile(custom),custom);assert.match(withDefaultProviderProfile().website,/studiopickles/);
});
for(const kind of ['local','cloud'] as const){
 test(`${kind}: a captured vision proposal is reachable but cannot assign points before a separate human confirmation`,async()=>{const f=await fixture(kind);try{
  let context=await f.repo.getQualificationContext(f.c.id),proposal=context.suggestions.find(s=>s.criterion==='problem')!;assert.equal(proposal.points,15);assert.equal(evaluateQualification(context.company,f.campaign,parisToday()).score,null);
  assert.equal(getEligibleApproachEvidence(context.report,f.campaign,picklesProviderProfile()).length,0);
  await assert.rejects(f.repo.decideQualificationSuggestion(f.c.id,1,proposal.id,'accept'),/Confirmez séparément/);
  context=await f.repo.reviewFinding(f.c.id,1,'visual','confirmed');assert.ok(isConfirmedFact(context.report.facts.find(f=>f.id==='visual')!));assert.equal(context.report.facts.find(f=>f.id==='visual')?.kind,'observed');assert.equal(evaluateQualification(context.company,f.campaign,parisToday()).confirmedPoints,0);
  proposal=context.suggestions.find(s=>s.criterion==='problem')!;const [first,retry]=await Promise.all([f.repo.decideQualificationSuggestion(f.c.id,context.company.participationRevision,proposal.id,'accept'),f.repo.decideQualificationSuggestion(f.c.id,context.company.participationRevision,proposal.id,'accept')]);assert.deepEqual(first.company.qualification,retry.company.qualification);
  context=await f.repo.getQualificationContext(f.c.id);assert.equal(evaluateQualification(context.company,f.campaign,parisToday()).confirmedPoints,15);assert.equal(evaluateQualification(context.company,f.campaign,parisToday()).completedCount,1);
  assert.equal((await f.base.listCompanies()).length,0,'A draft does not create a prospect.');
  const before=structuredClone(context.company.qualification!),id=(await f.repo.reviewCandidate(f.c.id,context.candidate.revision,'accept',['visual'],[0],''))!;assert.deepEqual((await f.repo.getCompany(f.campaign.id,id)).qualification,before);
  context=await f.repo.getQualificationContext(f.c.id);const savedAnswers=structuredClone(context.company.qualification!.answers);await f.repo.reviewFinding(f.c.id,context.candidate.revision,'visual','rejected');context=await f.repo.getQualificationContext(f.c.id);assert.deepEqual(context.company.qualification!.answers,savedAnswers);assert.ok(context.company.qualificationEnrichment?.revalidate?.includes('problem'));assert.equal(evaluateQualification(context.company,f.campaign,parisToday()).confirmedPoints,0);
 }finally{f.close();}});
 test(`${kind}: proposals cannot overwrite notes, and importing another result never overwrites an existing qualification`,async()=>{const f=await fixture(kind);try{
  const q=emptyQualification();q.answers.problem.description='Ma note déjà renseignée';q.observations.items.mobile.notes='Observation manuelle';q.afterExchange.budgetNote='Budget évoqué';await f.repo.saveCandidateQualification(f.c.id,1,{answers:q.answers});
  let context=await f.repo.getQualificationContext(f.c.id);await f.repo.reviewFinding(f.c.id,context.candidate.revision,'visual','confirmed');context=await f.repo.getQualificationContext(f.c.id);const suggestion=context.suggestions.find(s=>s.criterion==='problem')!;
  await assert.rejects(f.repo.decideQualificationSuggestion(f.c.id,context.company.participationRevision,suggestion.id,'accept'),/remplacer/);context=await f.repo.decideQualificationSuggestion(f.c.id,context.company.participationRevision,suggestion.id,'accept',true);
  await f.repo.saveCandidateQualification(f.c.id,context.candidate.revision,q.observations,'observations');context=await f.repo.getQualificationContext(f.c.id);await f.repo.saveCandidateQualification(f.c.id,context.candidate.revision,(({qualifiedAt,...input})=>input)(q.afterExchange),'exchange');context=await f.repo.getQualificationContext(f.c.id);
  const id=(await f.repo.reviewCandidate(f.c.id,context.candidate.revision,'accept',[],[0],''))!;let company=await f.repo.getCompany(f.campaign.id,id);const saved=structuredClone(company.qualification!);assert.equal(saved.observations.items.mobile.notes,'Observation manuelle');assert.equal(saved.afterExchange.budgetNote,'Budget évoqué');
  const nextRun=await f.repo.createRun(f.campaign.id,10,randomUUID()),second={...f.c,id:randomUUID(),runId:nextRun.id,companyId:id,qualificationDraft:q};await f.repo.transaction(tx=>f.repo.putCandidate(tx,second));await f.repo.reviewCandidate(second.id,1,'accept',[],[], '');company=await f.repo.getCompany(f.campaign.id,id);assert.deepEqual(company.qualification,saved);assert.equal((await f.repo.listCampaignCandidates(f.campaign.id)).length,1);
 }finally{f.close();}});
 test(`${kind}: proof sources are mandatory and rejection never fabricates an alternative issue`,async()=>{const f=await fixture(kind);try{
  const broken={...f.c,research:{...f.c.research!,sources:[]}};await f.repo.transaction(tx=>f.repo.putCandidate(tx,broken));await assert.rejects(f.repo.reviewFinding(f.c.id,1,'visual','confirmed'),/preuve|Source inconnue/);
  await f.repo.transaction(tx=>f.repo.putCandidate(tx,{...f.c,research:{...f.c.research!,facts:[{...f.c.research!.facts[0],kind:'observed',sentiment:'positive',text:'Les réalisations sont accessibles sans défaut identifié.',visual:undefined,review:{state:'proposed',nature:'observation',provenance:'render'}}]}}));const context=await f.repo.getQualificationContext(f.c.id);assert.equal(proposeQualification(context.report,f.campaign).some(s=>s.criterion==='problem'),false);
 }finally{f.close();}});
 test(`${kind}: legacy inline captures migrate once and v1-v4 imports remain compatible`,async()=>{const f=await fixture(kind);try{
  await f.repo.client.execute("DELETE FROM campaign_meta WHERE id='visual-assets-v1'");await f.repo.bootstrap();const c=await f.repo.getCandidate(f.c.id),asset=c.research!.facts[0].visual!.assetId!;assert.ok(asset);assert.equal(c.research!.facts[0].visual!.screenshot,undefined);assert.deepEqual(Buffer.from((await getResearchAsset(f.repo,asset))!),Buffer.from(visualCaptureFixture.split(',')[1],'base64'));const counts=(await f.repo.client.execute('SELECT COUNT(*) n FROM research_assets')).rows[0].n;await f.repo.bootstrap();assert.equal((await f.repo.client.execute('SELECT COUNT(*) n FROM research_assets')).rows[0].n,counts);
  const backup=await f.base.exportBackup();assert.equal(backupSchema.safeParse(backup).success,true);assert.equal(backup.campaignData?.assets?.length,1);
  const {assets,comparisons,clientBriefs,...oldData}=backup.campaignData!;const oldCandidate=structuredClone(oldData.candidates[0]);oldCandidate.research!.facts[0].visual={...oldCandidate.research!.facts[0].visual!,assetId:undefined,screenshot:visualCaptureFixture};const legacy={...backup,schemaVersion:4,campaignData:{...oldData,candidates:[oldCandidate]}};assert.equal(backupSchema.safeParse(legacy).success,true);await f.base.restoreBackup(legacy,true);await f.repo.bootstrap();assert.equal((await f.repo.getCandidate(f.c.id)).research!.facts[0].visual!.screenshot,undefined);
 }finally{f.close();}});
}

test('generic commercial paragraphs and saved criterion justifications never become reference or problem proposals',async()=>{const f=await fixture('local');try{let context=await f.repo.getQualificationContext(f.c.id);const report={...context.report,facts:[{...context.report.facts[0],section:'presentation' as const,kind:'reported' as const,visual:undefined,text:'Les risques d’un chantier mal encadré ; nous accompagnons tous vos projets.',review:undefined},{...context.report.facts[0],id:'saved-answer',kind:'reported' as const,origin:'qualification' as const,text:'Ma justification de deux problèmes.'}]};assert.equal(proposeQualification(report,f.campaign).length,0);const identified={...report,facts:[{...report.facts[0],text:'Rénovation de cuisine à Montpellier'}]};const proposal=proposeQualification(identified,f.campaign).find(s=>s.criterion==='references');assert.deepEqual((proposal?.response as {examples:string[]}).examples,['Rénovation de cuisine à Montpellier']);assert.equal(proposal?.points,5);}finally{f.close();}});

test('an unavailable AI panel stays in the full report but cannot displace a useful finding in the qualification list',async()=>{const f=await fixture('local');try{
 const context=await f.repo.getQualificationContext(f.c.id),panelFact={...context.report.facts[0],id:'panel-fact-test',section:'visibility' as const,text:'Aucune réponse exploitable.'};
 const report={...context.report,facts:[...context.report.facts,panelFact],panel:{id:'panel',targetKey:'target',createdAt:new Date().toISOString(),responses:[{question:'Question',answer:'',model:'model',engine:'API',recordedAt:new Date().toISOString(),sources:[],valid:false,recommendations:[]}]}};
 assert.equal(qualificationListFindings(report).some(f=>f.id===panelFact.id),false);assert.ok(report.facts.includes(panelFact));report.panel.responses[0].valid=true;assert.ok(qualificationListFindings(report).includes(panelFact));
 }finally{f.close();}});
