'use server';
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireAuthenticated } from '@/lib/auth';
import { isAllowedRequest } from '@/lib/security';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { buildClientBrief } from '@/lib/client-brief-build';
import { isDeepStrictEqual } from 'node:util';
import { saveClientBrief, getClientBrief } from '@/lib/client-brief';
import { renderClientBriefPdf } from '@/lib/client-brief-pdf';
import { getResearchAsset } from '@/lib/research-assets';
import { comparisonSchema, compareProspect, getLatestComparison } from '@/lib/comparison';
import { validatePublicSiteUrl } from '@/lib/site-analysis';
import type { ActionState } from '@/lib/types';
const str=(data:FormData,key:string)=>String(data.get(key)||'').trim();
async function authorize(){const h=await headers();if(!isAllowedRequest(h.get('host'),h.get('origin'),h.get('sec-fetch-site')))throw new Error('Requête non autorisée.');await requireAuthenticated();}
export async function compareProspectAction(_:ActionState,data:FormData):Promise<ActionState>{try{await authorize();if(str(data,'confirmed')!=='yes')throw new Error('Confirmez la comparaison à la demande et son quota.');const replacements=[str(data,'replacement1'),str(data,'replacement2')].filter(Boolean);for(const url of replacements)await validatePublicSiteUrl(url);await compareProspect(await getCampaignRepository(),str(data,'campaignId'),str(data,'companyId'),str(data,'operationKey'),replacements);revalidatePath('/','layout');return {ok:true,message:'Comparaison enregistrée. Vérifiez que les entreprises proposées sont comparables.'};}catch(error){return {error:error instanceof Error?error.message:'Comparaison impossible.'};}}
export async function confirmComparisonAction(_:ActionState,data:FormData):Promise<ActionState>{try{await authorize();const repo=await getCampaignRepository(),comparison=await getLatestComparison(repo,str(data,'campaignId'),str(data,'companyId'));if(!comparison||comparison.id!==str(data,'comparisonId'))throw new Error('Le comparatif a changé. Rechargez la fiche.');const indexes=data.getAll('competitorIndex').map(Number);if(indexes.some(index=>!Number.isInteger(index)||!comparison.competitors[index]))throw new Error('Comparaison invalide.');const next=comparisonSchema.parse({...comparison,id:randomUUID(),competitors:comparison.competitors.map((c,index)=>({...c,confirmed:indexes.includes(index)}))});await repo.transaction(async tx=>{await tx.execute({sql:'INSERT INTO research_comparisons(id,campaignId,companyId,payload) VALUES (?,?,?,?)',args:[next.id,next.campaignId,next.companyId,JSON.stringify(next)]});});revalidatePath('/','layout');return {ok:true,message:'Comparabilité enregistrée sans nouvelle recherche.'};}catch(error){return {error:error instanceof Error?error.message:'Enregistrement impossible.'};}}
export async function createClientBriefAction(_:ActionState,data:FormData):Promise<ActionState>{try{
  await authorize();if(str(data,'reviewed')!=='yes')throw new Error('Relisez le bilan client avant de générer le PDF.');
  const repo=await getCampaignRepository(),id=str(data,'submittedKey');if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('Version de bilan invalide.');
  const brief=await buildClientBrief(repo,data,id),existing=await getClientBrief(repo,id);
  if(existing){const {createdAt:_oldDate,...old}=existing,{createdAt:_newDate,...next}=brief;if(!isDeepStrictEqual(old,next))throw new Error('Cette version est déjà utilisée pour un autre contenu. Créez une nouvelle version.');return {ok:true,message:'Cette version est déjà disponible.',briefId:id};}
  await renderClientBriefPdf(brief,key=>getResearchAsset(repo,key));await saveClientBrief(repo,brief);revalidatePath('/','layout');return {ok:true,message:'Bilan client généré et version conservée, sans recherche supplémentaire.',briefId:id};
}catch(error){return {error:error instanceof Error?error.message:'Génération impossible.'};}}
