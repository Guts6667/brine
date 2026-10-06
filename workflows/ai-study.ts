import {getCampaignRepository} from '../lib/campaign-runtime';
import {claimAiStudy,getAiStudy,finishAiStudy} from '../lib/ai-study-storage';
import {executeStudyTrial,realStudyProvider,simulatedStudyProvider} from '../lib/ai-study-engine';
import type {AiStudy} from '../lib/ai-study-schema';
export async function aiStudyWorkflow(id:string,owner:string,epoch:string){
 'use workflow';
 const run=await claimStudy(id,owner,epoch);if(!run)return;
 try{for(const trial of run.trials){if(['queued','running'].includes(trial.status))await studyTrial(run,epoch,trial.id);}await finishStudy(run,epoch,'');}
 catch(error){await finishStudy(run,epoch,error instanceof Error?error.message:'Étude interrompue.');}
}
export async function claimStudy(id:string,owner:string,epoch:string){
 'use step';
 return claimAiStudy(await getCampaignRepository(),id,owner,epoch);}
export async function studyTrial(run:AiStudy,epoch:string,id:string){
 'use step';
 const repo=await getCampaignRepository(),current=await getAiStudy(repo,run.id);if(current.status!=='running'||current.owner!==run.owner||current.generation!==run.generation)return;await executeStudyTrial(repo,run,epoch,id,process.env.BRINE_TEST_FIXTURES==='1'&&process.env.VERCEL!=='1'?simulatedStudyProvider:realStudyProvider);}
export async function finishStudy(run:AiStudy,epoch:string,error:string){
 'use step';
 await finishAiStudy(await getCampaignRepository(),run,epoch,error);}
studyTrial.maxRetries=0;claimStudy.maxRetries=2;finishStudy.maxRetries=2;
