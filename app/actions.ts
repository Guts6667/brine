'use server';
import { getCampaignContext, getCampaignRepository, resetCampaignRepository } from '@/lib/campaign-runtime';
import { randomUUID } from 'node:crypto';
import { companyInputSchema, parisToday } from '@/lib/domain';
import { qualificationInputSchema, observationsSchema, afterExchangeInputSchema, targetSnapshotSchema, evaluateQualification, evaluateAfterExchange } from '@/lib/qualification';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { getStore, isCloudStorage } from '@/lib/db';
import { isAllowedRequest } from '@/lib/security';
import { requireAuthenticated } from '@/lib/auth';
import type { ActionState, CompanyDetails, Stage } from '@/lib/types';

const str = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
async function authorize() {
  const h = await headers();
  if (!isAllowedRequest(h.get('host'), h.get('origin'), h.get('sec-fetch-site'))) throw new Error('Requête non autorisée.');
  await requireAuthenticated();
}
function failure(error: unknown): ActionState {
  if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) fields[issue.path.join('.')] ??= issue.message;
    return { error: 'Vérifiez les champs indiqués.', fields };
  }
  return { error: error instanceof Error ? error.message : 'La sauvegarde a échoué. Réessayez.' };
}
async function context(data: FormData) {
  const explicitId=str(data,'campaignId');if(!explicitId&&(await(await getCampaignRepository()).listCampaigns()).length>1)throw new Error('Choisissez une campagne pour modifier son suivi.');const id=explicitId||'initial'; const raw=str(data,'participationRevision');
  if(raw && (!/^\d+$/.test(raw)||Number(raw)<1))throw new Error('Version de suivi invalide.');
  return getCampaignContext(id,raw?Number(raw):undefined);
}
function refresh(id?: string) {
  revalidatePath('/campagnes', 'layout');
  revalidatePath('/'); revalidatePath('/prospects'); revalidatePath('/sauvegarde');
  if (id) revalidatePath(`/prospects/${id}`);
}
export async function createCompanyAction(_: ActionState, data: FormData): Promise<ActionState> {
  let id: string;
  try {
    await authorize();
    const store = await context(data);
    const input = { name: str(data,'name'), website: str(data,'website'), city: str(data,'city'), business: str(data,'business') };
    const duplicates = await store.findDuplicates(input);
    if (duplicates.length && str(data,'allowDuplicate') !== 'yes') return { duplicates, error: 'Une fiche ressemble à cette entreprise. Vérifiez avant de créer une nouvelle fiche.' };
    id = (await store.createCompany(input)).id;
    refresh(id);
  } catch(error) { return failure(error); }
  redirect(`/prospects/${id}?created=1&campagne=${encodeURIComponent(str(data,'campaignId')||'initial')}`);
}
export async function saveCompanyAction(id: string, _: ActionState, data: FormData): Promise<ActionState> {
  try {
    await authorize();
    const store=await context(data),before=await store.getCompany(id);
    if(!before) throw new Error('Entreprise introuvable.');
    const contact = { name: str(data,'contact.name'), role: str(data,'contact.role'), email: str(data,'contact.email'), phone: str(data,'contact.phone'), formUrl: str(data,'contact.formUrl'), profileUrl: str(data,'contact.profileUrl') };
    const input: CompanyDetails = {
      name:str(data,'name'), website:str(data,'website'), city:str(data,'city'), business:str(data,'business'),
      targetFit:before.targetFit, problemFound:before.problemFound, contactAvailable:before.contactAvailable,
      observation:before.observation, proofUrl:before.proofUrl, observedOn:before.observedOn, trigger:before.trigger,
      stage:str(data,'stage') as Stage, contact,
    };
    const canonical=companyInputSchema.parse(input);
    if(before && (['name','website','city'] as const).some(key=>before[key]!==canonical[key])) {
      const duplicates=await store.findDuplicates(canonical,id);
      if(duplicates.length && str(data,'allowDuplicate')!=='yes') return {duplicates,error:'Une fiche ressemble à cette entreprise. Vérifiez avant de modifier.'};
    }
    await store.updateCompany(id,input,str(data,'companyUpdatedAt')||undefined); refresh(id);
    return {ok:true,message:'Fiche enregistrée. La qualification a été recalculée.'};
  } catch(error) { return failure(error); }
}
function parsePayload(data:FormData):unknown {
  const payload=str(data,'payload');
  if(payload.length>128*1024) throw new Error('Les informations dépassent la taille autorisée.');
  try { return JSON.parse(payload); } catch { throw new Error('Les informations du formulaire sont invalides. Rechargez la fiche.'); }
}
export async function saveQualificationAction(id:string,_:ActionState,data:FormData):Promise<ActionState> {
  try {
    await authorize();
    const store=await context(data),input=qualificationInputSchema.parse(parsePayload(data));
    const confirmTarget=str(data,'confirmTarget')==='yes';
    const expectedTarget=confirmTarget?targetSnapshotSchema.parse(parseJsonField(data,'expectedTarget')):undefined;
    const company=await store.saveQualification(id,input,confirmTarget,expectedTarget);
    const evaluation=evaluateQualification(company,await store.getSettings(),parisToday()); refresh(id);
    return {ok:true,message:evaluation.complete?`Qualification enregistrée : ${evaluation.score}/100 · ${evaluation.decision}.`:`Brouillon enregistré : ${evaluation.confirmedPoints} points confirmés · ${evaluation.completedCount} critères sur 5 complets.`};
  } catch(error) { return failure(error); }
}
function parseJsonField(data:FormData,name:string):unknown {
  const value=str(data,name);
  if(value.length>10000) throw new Error('Les informations du formulaire dépassent la taille autorisée.');
  try {return JSON.parse(value);} catch {throw new Error('Le formulaire a changé. Rechargez la fiche avant de réessayer.');}
}
export async function saveObservationsAction(id:string,_:ActionState,data:FormData):Promise<ActionState> {
  try { await authorize(); await (await context(data)).saveObservations(id,observationsSchema.parse(parsePayload(data))); refresh(id); return {ok:true,message:'Observations enregistrées. Confirmez séparément les réponses aux cinq critères.'}; }
  catch(error) { return failure(error); }
}
export async function saveAfterExchangeAction(id:string,_:ActionState,data:FormData):Promise<ActionState> {
  try { await authorize(); const company=await (await context(data)).saveAfterExchange(id,afterExchangeInputSchema.parse(parsePayload(data))); refresh(id); return {ok:true,message:`Échange enregistré : ${evaluateAfterExchange(company).label}. L’étape commerciale reste à votre choix.`}; }
  catch(error) { return failure(error); }
}
export async function qualifyOpportunityAction(id:string,_:ActionState,_data:FormData):Promise<ActionState> {
  try { await authorize(); await (await context(_data)).qualifyOpportunity(id); refresh(id); return {ok:true,message:'Entreprise passée à Opportunité qualifiée. La décision est conservée dans l’historique.'}; }
  catch(error) { return failure(error); }
}
export async function saveAction(id: string, _: ActionState, data: FormData): Promise<ActionState> {
  try {
    await authorize();
    await (await context(data)).setAction(id,{ text:str(data,'text'), date:str(data,'date') },str(data,'expectedId')||null); refresh(id);
    return {ok:true,message:'Prochaine action enregistrée.'};
  } catch(error) { return failure(error); }
}
export async function completeAction(id: string, _: ActionState, _data: FormData): Promise<ActionState> {
  try { await authorize(); await (await context(_data)).completeAction(id,str(_data,'expectedId')||null); refresh(id); }
  catch(error) { return failure(error); }
  redirect(`/prospects/${id}?done=1&campagne=${encodeURIComponent(str(_data,'campaignId')||'initial')}`);
}
export async function postponeAction(id: string, _: ActionState, data: FormData): Promise<ActionState> {
  try { await authorize(); await (await context(data)).postponeAction(id,str(data,'date'),str(data,'expectedId')||null); refresh(id); return {ok:true,message:'Action reportée.'}; }
  catch(error) { return failure(error); }
}
export async function addActivityAction(id: string, _: ActionState, data: FormData): Promise<ActionState> {
  try {
    await authorize(); await (await context(data)).addActivity(id,{kind:str(data,'kind') as 'note'|'exchange',type:str(data,'type'), date:str(data,'date'),text:str(data,'text')}); refresh(id);
    return {ok:true,message:'Ajouté à l’historique.'};
  } catch(error) { return failure(error); }
}
export async function addAiTestAction(id: string, _: ActionState, data: FormData): Promise<ActionState> {
  try {
    await authorize();
    const number = (key:string) => str(data,key) === '' ? null : Number(str(data,key));
    await (await context(data)).addAiTest(id,{
      panel:str(data,'panel'),period:str(data,'period'),tool:str(data,'tool'),interface:str(data,'interface'),mode:str(data,'mode') as 'web'|'api'|'unknown',
      model:str(data,'model'),questions:str(data,'questions'),validResponses:number('validResponses'), recommendations:number('recommendations'),citations:number('citations'),notes:str(data,'notes'),proofUrl:str(data,'proofUrl')
    }); refresh(id); return {ok:true,message:'Relevé enregistré.'};
  } catch(error) { return failure(error); }
}
export async function archiveAction(id: string, value: boolean, _: ActionState, _data: FormData): Promise<ActionState> {
  try { await authorize(); await (await context(_data)).setArchived(id,value); refresh(id); return {ok:true,message:value ? 'Entreprise archivée. Son historique est conservé.' : 'Entreprise désarchivée.'}; }
  catch(error) { return failure(error); }
}
export async function oppositionAction(id: string, active: boolean, _: ActionState, data: FormData): Promise<ActionState> {
  try {
    await authorize();
    if (!active && str(data,'confirm') !== 'yes') return {error:'Confirmez explicitement la réactivation du contact.'};
    await (await context(data)).setOpposition(id,active,str(data,'note'),str(data,'confirm')==='yes'); refresh(id);
    return {ok:true,message:active ? 'Opposition enregistrée. Les relances actives sont annulées.' : 'Opposition désactivée. Aucune relance n’a été créée.'};
  } catch(error) { return failure(error); }
}
export async function saveSettingsAction(_: ActionState, data: FormData): Promise<ActionState> {
  try { await authorize(); await getStore().saveSettings({targetCity:str(data,'targetCity'),targetBusiness:str(data,'targetBusiness'),targetCompanyType:str(data,'targetCompanyType'),targetOffer:str(data,'targetOffer'),targetExclusions:str(data,'targetExclusions')}); refresh(); return {ok:true,message:'Cible enregistrée. Les évaluations d’une autre cible demandent une revalidation explicite.'}; }
  catch(error) { return failure(error); }
}
export async function previewBackupAction(_: ActionState, data: FormData): Promise<ActionState & { preview?: Awaited<ReturnType<ReturnType<typeof getStore>['previewBackup']>>; json?: string; previewKey?:string }> {
  try {
    await authorize(); const file = data.get('file');
    if (!(file instanceof File) || !file.size) throw new Error('Choisissez un fichier JSON.');
    if (file.size > 5 * 1024 * 1024) throw new Error('La sauvegarde dépasse la limite de 5 Mo.');
    const json = await file.text(); const preview = await getStore().previewBackup(parseBackup(json));
    return {ok:true,preview,json,previewKey:randomUUID(),message:'Fichier valide. Vérifiez les quantités avant de confirmer.'};
  } catch(error) { return failure(error); }
}
export async function restoreBackupAction(_: ActionState, data: FormData): Promise<ActionState> {
  try {
    await authorize();
    if (str(data,'confirm') !== 'yes') throw new Error('Confirmez le remplacement avant de restaurer.');
    const json = str(data,'json'); if (json.length > 5*1024*1024) throw new Error('La sauvegarde dépasse la limite de 5 Mo.');
    const result = await getStore().restoreBackup(parseBackup(json),true); await resetCampaignRepository(); refresh();
    return {ok:true,message:`Restauration terminée. ${isCloudStorage()?'La copie précédente est disponible dans Données et préférences.':`Sauvegarde préalable : ${result.backupPath}.`} Oppositions conservées : ${result.preservedOppositions}.`};
  } catch(error) { return failure(error); }
}

function parseBackup(json:string):unknown {
  try { return JSON.parse(json); } catch { throw new Error('Fichier JSON invalide. Vérifiez le fichier choisi.'); }
}
