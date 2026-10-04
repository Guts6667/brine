'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireAuthenticated } from '@/lib/auth';
import { isAllowedRequest } from '@/lib/security';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import type { ActionState } from '@/lib/types';
const str=(data:FormData,key:string)=>String(data.get(key)||'').trim();
export async function reviewFindingAction(_:ActionState,data:FormData):Promise<ActionState>{
  try{const h=await headers();if(!isAllowedRequest(h.get('host'),h.get('origin'),h.get('sec-fetch-site')))throw new Error('Requête non autorisée.');await requireAuthenticated();
    const decision=str(data,'decision');if(!['confirmed','rejected'].includes(decision))throw new Error('Décision invalide.');
    await(await getCampaignRepository()).reviewFinding(str(data,'candidateId'),Number(str(data,'revision')),str(data,'factId'),decision as 'confirmed'|'rejected',str(data,'note'));revalidatePath('/','layout');return {ok:true,message:'Constat enregistré. Les points se confirment séparément dans le critère.'};
  }catch(error){return {error:error instanceof Error?error.message:'Enregistrement impossible.'};}
}
export async function decideQualificationSuggestionAction(_:ActionState,data:FormData):Promise<ActionState>{
  try{const h=await headers();if(!isAllowedRequest(h.get('host'),h.get('origin'),h.get('sec-fetch-site')))throw new Error('Requête non autorisée.');await requireAuthenticated();
    const decision=str(data,'decision');if(!['accept','reject'].includes(decision))throw new Error('Décision invalide.');
    await(await getCampaignRepository()).decideQualificationSuggestion(str(data,'candidateId'),Number(str(data,'revision')),str(data,'suggestionId'),decision as 'accept'|'reject',str(data,'overwrite')==='yes');revalidatePath('/','layout');return {ok:true,message:decision==='accept'?'Réponse proposée reprise. Complétez ses justifications si nécessaire.':'Proposition rejetée ; vos réponses sont conservées.'};
  }catch(error){return {error:error instanceof Error?error.message:'Enregistrement impossible.'};}
}
