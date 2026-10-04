import { z } from 'zod';
import type { CampaignRepository } from './campaign-repository';
import { clientBriefSchema, briefFingerprint, clientBriefWordCount } from './client-brief';
import { getLatestComparison } from './comparison';
import { isClientBriefFact } from './client-brief-rules';
const payloadSchema=z.object({situation:z.string().max(1500),positives:z.string().max(1000),points:z.array(z.object({factId:z.string().max(180),text:z.string().min(1).max(1200),effect:z.string().max(1000),help:z.string().max(1000)}).strict()).min(1).max(3),actions:z.array(z.string().min(1).max(700)).min(1).max(2),invitation:z.string().min(1).max(700)}).strict();
export async function buildClientBrief(repo:CampaignRepository,data:FormData,id:string){
  const str=(key:string)=>String(data.get(key)||'').trim(),raw=str('payload');if(raw.length>20000)throw new Error('Bilan trop long.');
  const input=payloadSchema.parse(JSON.parse(raw)),campaignId=str('campaignId'),companyId=str('companyId');
  const [report,profile,company,campaign,comparison]=await Promise.all([repo.getCompanyReport(campaignId,companyId),repo.getProviderProfile(),repo.getCompany(campaignId,companyId),repo.getCampaign(campaignId),getLatestComparison(repo,campaignId,companyId)]);
  if(!report||report.id!==str('reportId')||profile.revision!==Number(str('profileRevision')))throw new Error('Le dossier ou le profil a changé. Reprenez l’aperçu.');
  const points=input.points.map(point=>{const fact=report.facts.find(f=>f.id===point.factId);if(!fact||!isClientBriefFact(fact,report))throw new Error('Choisissez un constat public, confirmé et daté. Les notes internes restent dans Brine.');return {fact,text:point.text,effect:point.effect,help:point.help};}),sourceIds=new Set(points.flatMap(p=>p.fact.sourceIds));
  const brief=clientBriefSchema.parse({version:1,template:'pickles-client-v1',id,campaignId,companyId,createdAt:new Date().toISOString(),profile,companyName:company.name,website:company.website,targetRevision:campaign.revision,situation:input.situation,positives:input.positives,points,actions:input.actions,invitation:input.invitation,sources:report.sources.filter(s=>sourceIds.has(s.id)),comparison,fingerprint:briefFingerprint([points.map(p=>p.fact),profile,comparison,company.website,campaign.revision]),reviewed:true});
  if(clientBriefWordCount(brief)>450)throw new Error('Ce bilan dépasse 450 mots. Réduisez explicitement le texte avant de générer.');
  return brief;
}
