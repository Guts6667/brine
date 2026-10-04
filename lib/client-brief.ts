import { createHash } from 'node:crypto';
import { z } from 'zod';
import { researchFactSchema, researchSourceSchema, providerProfileSchema } from './research-schemas';
import { comparisonSchema, getLatestComparison } from './comparison';
import type { CampaignRepository } from './campaign-repository';
import { isClientBriefFact } from './client-brief-rules';
import { isConfirmedFact } from './qualification-enrichment';
import { clientBriefBodyWordCount } from './client-brief-text';

export { clientBriefSchema, type ClientBrief } from './client-brief-schema';
import { clientBriefSchema, type ClientBrief } from './client-brief-schema';
export function briefFingerprint(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export const clientBriefWordCount=clientBriefBodyWordCount;
export async function saveClientBrief(repo:CampaignRepository,input:unknown):Promise<ClientBrief>{
  const brief=clientBriefSchema.parse(input);if(clientBriefWordCount(brief)>450)throw new Error('Ce bilan dépasse 450 mots. Allégez explicitement le texte avant génération.');
  const [report,profile,campaign,company]=await Promise.all([repo.getCompanyReport(brief.campaignId,brief.companyId),repo.getProviderProfile(),repo.getCampaign(brief.campaignId),repo.getCompany(brief.campaignId,brief.companyId)]);
  if(campaign.revision!==brief.targetRevision||company.website!==brief.website)throw new Error('La cible ou le site a changé. Reprenez l’aperçu.');
  if(!report||profile.revision!==brief.profile.revision||JSON.stringify(profile)!==JSON.stringify(brief.profile))throw new Error('Le profil ou le dossier a changé. Reprenez l’aperçu.');
  for(const point of brief.points){const fact=report.facts.find(f=>f.id===point.fact.id);if(!fact||!isClientBriefFact(fact,report)||JSON.stringify(fact)!==JSON.stringify(point.fact))throw new Error('Le PDF utilise uniquement des constats confirmés encore valables.');}
  if(new Set(brief.points.map(p=>p.fact.id)).size!==brief.points.length)throw new Error('Ne sélectionnez pas deux fois le même constat.');
  if(brief.sources.some(s=>!report.sources.some(source=>JSON.stringify(source)===JSON.stringify(s))))throw new Error('Source inconnue.');
  if(brief.points.some(point=>point.fact.sourceIds.some(id=>!brief.sources.some(source=>source.id===id))))throw new Error('Chaque constat du bilan doit conserver sa source.');
  if(brief.comparison){const saved=(await repo.client.execute({sql:'SELECT payload FROM research_comparisons WHERE id=? AND campaignId=? AND companyId=?',args:[brief.comparison.id,brief.campaignId,brief.companyId]})).rows[0];if(!saved||JSON.stringify(comparisonSchema.parse(JSON.parse(String(saved.payload))))!==JSON.stringify(brief.comparison))throw new Error('Le comparatif a changé. Reprenez son aperçu.');}
  const fingerprint=briefFingerprint([brief.points.map(p=>p.fact),profile,brief.comparison,brief.website,brief.targetRevision]);if(brief.fingerprint!==fingerprint)throw new Error('Le bilan a changé. Reprenez son aperçu.');
  await repo.transaction(async tx=>{const prior=(await tx.execute({sql:'SELECT payload FROM research_client_briefs WHERE id=?',args:[brief.id]})).rows[0];if(prior){if(JSON.stringify(JSON.parse(String(prior.payload)))!==JSON.stringify(brief))throw new Error('Cette version de bilan est déjà utilisée. Créez une nouvelle version.');return;}await tx.execute({sql:'INSERT INTO research_client_briefs(id,campaignId,companyId,payload) VALUES (?,?,?,?)',args:[brief.id,brief.campaignId,brief.companyId,JSON.stringify(brief)]});});return brief;
}
export async function getClientBrief(repo:CampaignRepository,id:string):Promise<ClientBrief|null>{const row=(await repo.client.execute({sql:'SELECT payload FROM research_client_briefs WHERE id=?',args:[id]})).rows[0];return row?clientBriefSchema.parse(JSON.parse(String(row.payload))):null;}
export async function briefNeedsUpdate(repo:CampaignRepository,brief:ClientBrief){
  const [report,profile,comparison,campaign,company]=await Promise.all([repo.getCompanyReport(brief.campaignId,brief.companyId),repo.getProviderProfile(),getLatestComparison(repo,brief.campaignId,brief.companyId),repo.getCampaign(brief.campaignId),repo.getCompany(brief.campaignId,brief.companyId)]);
  return !report||briefFingerprint([brief.points.map(p=>report.facts.find(f=>f.id===p.fact.id)),profile,comparison,company.website,campaign.revision])!==brief.fingerprint;
}
