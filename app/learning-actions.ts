'use server';
import {headers} from 'next/headers';
import {revalidatePath} from 'next/cache';
import {requireAuthenticated} from '@/lib/auth';
import {isAllowedRequest} from '@/lib/security';
import {getCampaignRepository} from '@/lib/campaign-runtime';
import type {LearningActionState} from '@/lib/learning-types';
const str=(data:FormData,key:string)=>String(data.get(key)||'').trim();
export async function saveLearningProgressAction(_:LearningActionState,data:FormData):Promise<LearningActionState>{
 await requireAuthenticated();const h=await headers();if(!isAllowedRequest(h.get('host'),h.get('origin'),h.get('sec-fetch-site')))return {error:'Requête non autorisée.'};
 const repo=await getCampaignRepository();
 try{
  const revision=str(data,'revision');if(!/^\d+$/.test(revision))throw new Error('Version de progression manquante ou invalide.');
  const operation=str(data,'operation'),input:Record<string,unknown>={operation,revision:Number(revision)};
  if(['visit','answers','complete'].includes(operation))input.moduleId=str(data,'moduleId');
  if(operation==='visit')input.step=str(data,'step');
  if(operation==='answers'){const raw=str(data,'answers');if(raw.length>24000)throw new Error('Réponse d’exercice trop volumineuse.');input.answers=JSON.parse(raw);}
  if(operation==='campaign')input.campaignId=str(data,'campaignId')||null;
  if(operation==='guide'){if(!['yes','no'].includes(str(data,'guideOpen')))throw new Error('Préférence du guide invalide.');input.guideOpen=str(data,'guideOpen')==='yes';}
  if(operation==='card'){if(!['yes','no'].includes(str(data,'showTodayCard')))throw new Error('Préférence d’affichage invalide.');input.showTodayCard=str(data,'showTodayCard')==='yes';}
  if(operation==='mission'){const raw=str(data,'mission');if(raw.length>1000)throw new Error('Mission invalide.');input.mission=JSON.parse(raw);}
  const progress=await repo.saveLearningProgress(input);revalidatePath('/apprendre','layout');return {ok:true,progress,message:'Progression enregistrée.'};
 }catch(error){return {error:error instanceof Error?error.message:'Enregistrement impossible.',progress:await repo.getLearningProgress()};}
}
