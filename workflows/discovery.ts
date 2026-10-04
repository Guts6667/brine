import { sleep } from 'workflow';
import { getCampaignRepository } from '../lib/campaign-runtime';
import { populateRun, prepareRunPanel, processCandidate, processMobile, processReport, finishRun, defaultProviders } from '../lib/discovery-engine';
import type { DiscoveryRun } from '../lib/campaign-types';

export async function discoveryWorkflow(id:string,owner:string,epoch:string){
  'use workflow';
  const run=await claim(id,owner,epoch);if(!run)return;
  try {
    const ids=await populate(run,epoch);
    await panel(run,epoch);
    for(let offset=0;offset<ids.length;offset+=2){
      await Promise.all(ids.slice(offset,offset+2).map(async candidateId=>{
        for(let attempt=0;attempt<3;attempt++){const retry=await html(run,candidateId,epoch);if(!retry)break;await sleep('15s');}
      }));
    }
    for(const candidateId of ids){for(let attempt=0;attempt<3;attempt++){const retry=await mobile(run,candidateId,epoch);if(!retry)break;await sleep('30s');}}
    for(const candidateId of ids)await report(run,candidateId,epoch);
    await finish(run,epoch,'');
  }catch(error){await finish(run,epoch,error instanceof Error?error.message:'Le lot a été interrompu.');}
  await dispatchNext();
}
async function providers(){if(process.env.BRINE_TEST_FIXTURES==='1'&&process.env.VERCEL!=='1')return (await import('../lib/testing/discovery-fixtures')).discoveryFixtures;return defaultProviders;}
export async function claim(id:string,owner:string,epoch:string){
  'use step';
  return (await getCampaignRepository()).claimRun(id,owner,epoch);}
export async function populate(run:DiscoveryRun,epoch:string){
  'use step';
  const repo=await getCampaignRepository();await populateRun(repo,run,epoch,await providers());return (await repo.listCandidates(run.id)).map(c=>c.id);}
export async function html(run:DiscoveryRun,id:string,epoch:string){
  'use step';
  return processCandidate(await getCampaignRepository(),run,id,epoch,await providers());}
export async function panel(run:DiscoveryRun,epoch:string){
  'use step';
  await prepareRunPanel(await getCampaignRepository(),run,epoch,await providers());}
export async function mobile(run:DiscoveryRun,id:string,epoch:string){
  'use step';
  return processMobile(await getCampaignRepository(),run,id,epoch,await providers());}
export async function report(run:DiscoveryRun,id:string,epoch:string){
  'use step';
  await processReport(await getCampaignRepository(),run,id,epoch,await providers());}
export async function finish(run:DiscoveryRun,epoch:string,error:string){
  'use step';
  await finishRun(await getCampaignRepository(),run,epoch,error);}
export async function dispatchNext(){
  'use step';
  const {dispatchDiscovery}=await import('../lib/discovery-dispatch');await dispatchDiscovery();}

// Provider attempts are reserved in the database before requests; explicit loops bound retries.
html.maxRetries = 0;
mobile.maxRetries = 0;
report.maxRetries = 0;
panel.maxRetries = 0;
populate.maxRetries = 2;
claim.maxRetries = 2;
finish.maxRetries = 2;
dispatchNext.maxRetries = 2;
