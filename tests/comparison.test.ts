import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { Store } from '../lib/db';
import { CampaignRepository } from '../lib/campaign-repository';
import { compareProspect } from '../lib/comparison';
import { getBudgetOverview, saveProviderState } from '../lib/research-budget';
import { stableResearchKey } from '../lib/research-providers';
import type { analyzeSite } from '../lib/site-analysis';
const analyze:typeof analyzeSite=async website=>({website,analyzedOn:'2026-10-05',pages:[],contacts:[],findings:[{id:'services',key:'services',note:'Prestations déclarées sur cette page.',sourceUrl:website}],warnings:[]});
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'brine-comparison-')),path=join(dir,'data.sqlite'),base=new Store(path),repo=new CampaignRepository(createClient({url:`file:${path}`}));await repo.bootstrap();
 const campaign=await repo.saveCampaign({name:'Artisans',targetCity:'Montpellier',targetBusiness:'Rénovation',targetCompanyType:'Artisans',targetOffer:'',targetExclusions:'',keywords:'rénovation',activityCodes:''}),company=await repo.createCompany(campaign.id,{name:'Artisan',website:'https://artisan.example/',city:'Montpellier',business:'Rénovation'});
 await saveProviderState(repo,'serpapi',{checkedAt:new Date().toISOString(),credentialId:stableResearchKey('test-google'),valid:true,remaining:250,hourlyLimit:50});
 return {base,repo,campaign,company,close(){repo.close();base.close();rmSync(dir,{recursive:true,force:true});}};
}
async function configured(work:()=>Promise<void>){const prior=process.env.SERPAPI_API_KEY;process.env.SERPAPI_API_KEY='test-google';try{await work();}finally{if(prior===undefined)delete process.env.SERPAPI_API_KEY;else process.env.SERPAPI_API_KEY=prior;}}
function results(){return {search_metadata:{created_at:'2026-10-05 12:00:00 UTC'},organic_results:[{position:1,title:'Artisan',link:'https://artisan.example/'},{position:3,title:'Autre artisan',link:'https://other.example/'},{title:'Sans rang documenté',link:'https://third.example/'},{position:12,title:'Hors des dix premiers',link:'https://fourth.example/'}]};}
test('localized comparisons retain observed ranks and sources; seven-day replay and replacement reuse Google without a second quota charge',()=>configured(async()=>{const f=await fixture();try{
 let calls=0;const fetcher:typeof fetch=async input=>{calls++;const url=new URL(String(input));assert.equal(url.searchParams.get('location'),'Montpellier, France');assert.equal(url.searchParams.get('num'),'10');assert.equal(url.searchParams.get('device'),'desktop');assert.match(url.searchParams.get('q')!,/rénovation.*Montpellier/);return Response.json(results());};
 const result=await compareProspect(f.repo,f.campaign.id,f.company.id,'first',[],fetcher,analyze);assert.equal(calls,2);assert.equal(result.queries.length,2);assert.deepEqual(result.queries[0].results.map(r=>r.position),[1,3]);assert.equal(result.queries[0].recordedAt,'2026-10-05T12:00:00.000Z');assert.ok(result.queries[0].results.every(r=>r.url.startsWith('https://')));assert.equal(result.competitors.length,2);assert.ok(result.competitors.every(c=>!c.confirmed&&c.notes.some(n=>n.includes('rendu visuel'))));assert.match(result.warnings.join(' '),/aucun rang inventé/);assert.equal((await getBudgetOverview(f.repo)).serpApiUsed,2);
 assert.deepEqual(await compareProspect(f.repo,f.campaign.id,f.company.id,'second',[],fetcher,analyze),result);assert.equal(calls,2);
 const replacement=await compareProspect(f.repo,f.campaign.id,f.company.id,'replacement',['https://replacement.example/'],fetcher,analyze);assert.equal(replacement.competitors[0].confirmed,true);assert.equal(replacement.competitors[0].url,'https://replacement.example/');assert.equal(calls,2);assert.equal((await getBudgetOverview(f.repo)).serpApiUsed,2);
 await assert.rejects(compareProspect(f.repo,f.campaign.id,f.company.id,'first',['https://replacement.example/'],fetcher,analyze),/ont changé/);
 }finally{f.close();}}));
test('concurrent comparison submissions execute once and a completed operation cannot be reused for another prospect',()=>configured(async()=>{const f=await fixture();try{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,25));return Response.json(results());};
 const outcomes=await Promise.allSettled([compareProspect(f.repo,f.campaign.id,f.company.id,'concurrent',[],fetcher,analyze),compareProspect(f.repo,f.campaign.id,f.company.id,'concurrent',[],fetcher,analyze)]);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(outcomes.filter(o=>o.status==='rejected').length,1);assert.equal(calls,2);assert.equal((await f.repo.client.execute('SELECT COUNT(*) n FROM research_comparisons')).rows[0].n,1);
 assert.equal((await compareProspect(f.repo,f.campaign.id,f.company.id,'concurrent',[],fetcher,analyze)).id,'concurrent');const other=await f.repo.createCompany(f.campaign.id,{name:'Deuxième artisan',website:'https://another.example/',city:'Montpellier',business:'Rénovation'});await assert.rejects(compareProspect(f.repo,f.campaign.id,other.id,'concurrent',[],fetcher,analyze),/autre fiche/);assert.equal(calls,2);
 }finally{f.close();}}));
