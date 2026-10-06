'use server';
import {z} from 'zod';
import {headers} from 'next/headers';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {randomUUID} from 'node:crypto';
import {start} from 'workflow/api';
import {aiStudyWorkflow} from '@/workflows/ai-study';
import {getCampaignRepository} from '@/lib/campaign-runtime';
import {requireAuthenticated} from '@/lib/auth';
import {isAllowedRequest} from '@/lib/security';
import {createAiStudy,controlAiStudy,getAiStudy,saveManualStudyTrial,selectStudyEvidence} from '@/lib/ai-study-storage';
import type {ActionState} from '@/lib/types';
const val=(d:FormData,key:string)=>String(d.get(key)||'');
async function authorize(){const h=await headers();if(!isAllowedRequest(h.get('host'),h.get('origin'),h.get('sec-fetch-site')))throw new Error('Requête non autorisée.');await requireAuthenticated();}
function failure(error:unknown):ActionState{if(error instanceof z.ZodError){const issue=error.issues[0],path=issue?.path.join('.');return {error:path==='recordedAt'?'Indiquez une date valide pour cet essai, au plus tard aujourd’hui.':path==='proofUrl'?'Indiquez un lien public HTTP ou HTTPS pour cet essai.':issue?.code==='custom'?issue.message:'Vérifiez les champs du formulaire avant de l’enregistrer.'};}return {error:error instanceof Error?error.message:'Enregistrement impossible.'};}
export async function createStudyAction(_:ActionState,data:FormData):Promise<ActionState>{let path='';try{await authorize();const s=await createAiStudy(await getCampaignRepository(),JSON.parse(val(data,'payload')));path=`/campagnes/${s.campaignId}/visibilite-ia?etude=${s.id}`;revalidatePath('/campagnes','layout');}catch(error){return failure(error);}redirect(path);}
export async function controlStudyAction(_:ActionState,data:FormData):Promise<ActionState>{try{await authorize();const operation=val(data,'operation');if(!['launch','pause'].includes(operation))throw new Error('Commande invalide.');const repo=await getCampaignRepository(),s=await controlAiStudy(repo,val(data,'id'),Number(val(data,'revision')),operation as 'launch'|'pause');if(operation==='launch')try{await start(aiStudyWorkflow,[s.id,randomUUID(),await repo.epoch()]);}catch{await controlAiStudy(repo,s.id,s.revision,'pause');throw new Error('Étude conservée en pause. Reprenez-la pour relancer le travail durable.');}revalidatePath(`/campagnes/${s.campaignId}/visibilite-ia`);return {ok:true,message:operation==='launch'?'Étude lancée. Vous pouvez fermer cette page.':'Étude en pause ; réponses et réservations conservées.'};}catch(error){return failure(error);}}
export async function saveStudyTrialAction(_:ActionState,data:FormData):Promise<ActionState>{try{await authorize();const repo=await getCampaignRepository(),s=await saveManualStudyTrial(repo,val(data,'id'),Number(val(data,'revision')),val(data,'trialId'),JSON.parse(val(data,'payload')));revalidatePath(`/campagnes/${s.campaignId}/visibilite-ia`);return {ok:true,message:'Essai enregistré. Le score de qualification reste inchangé.'};}catch(error){return failure(error);}}

export async function selectStudyEvidenceAction(_:ActionState,data:FormData):Promise<ActionState>{try{await authorize();const s=await selectStudyEvidence(await getCampaignRepository(),val(data,'id'),Number(val(data,'revision')),val(data,'questionId'));revalidatePath('/campagnes','layout');revalidatePath('/prospects','layout');return {ok:true,message:'Observation choisie dans le dossier. Relisez le motif et le canal avant de préparer le contact ; aucun point ajouté.'};}catch(error){return failure(error);}}
