import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CampaignRepository } from './campaign-repository';
import { researchUrlSchema } from './research-schemas';
import { serpSearch, stableResearchKey, normalizeSearchResults } from './research-providers';
import { readResearchCache, saveResearchCache } from './research-budget';
import { analyzeSite } from './site-analysis';

export { comparisonSchema, type ComparisonSnapshot } from './comparison-schema';
import { comparisonSchema, type ComparisonSnapshot } from './comparison-schema';
export async function getLatestComparison(repo:CampaignRepository,campaignId:string,companyId:string):Promise<ComparisonSnapshot|null>{const row=(await repo.client.execute({sql:'SELECT payload FROM research_comparisons WHERE campaignId=? AND companyId=? ORDER BY rowid DESC LIMIT 1',args:[campaignId,companyId]})).rows[0];return row?comparisonSchema.parse(JSON.parse(String(row.payload))):null;}
/** Two explicit localized queries; rankings remain observations of their first ten organic results. */
export async function compareProspect(repo:CampaignRepository,campaignId:string,companyId:string,operationKey:string,replacements:string[]=[],fetcher:typeof fetch=fetch,analyze:typeof analyzeSite=analyzeSite):Promise<ComparisonSnapshot>{
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(operationKey))throw new Error('Identifiant de comparaison invalide.');
  const [campaign,company]=await Promise.all([repo.getCampaign(campaignId),repo.getCompany(campaignId,companyId)]);
  replacements=z.array(researchUrlSchema).max(2).parse(replacements);
  const fingerprint=stableResearchKey([campaignId,companyId,campaign.revision,company.website,replacements]),cacheKey=`comparison:${fingerprint}`;
  const previous=(await repo.client.execute({sql:'SELECT payload FROM research_comparisons WHERE id=?',args:[operationKey]})).rows[0];if(previous){const value=comparisonSchema.parse(JSON.parse(String(previous.payload)));if(value.campaignId!==campaignId||value.companyId!==companyId)throw new Error('Cette comparaison appartient à une autre fiche.');const submission=(await repo.client.execute({sql:'SELECT fingerprint FROM research_submissions WHERE submittedKey=?',args:[`comparison:${operationKey}`]})).rows[0];if(submission&&submission.fingerprint!==fingerprint)throw new Error('Les sites à comparer ont changé. Lancez une nouvelle comparaison.');return value;}
  const cached=await readResearchCache<ComparisonSnapshot>(repo,cacheKey);if(cached)return cached;
  await repo.transaction(async tx=>{const key=`comparison:${operationKey}`,prior=(await tx.execute({sql:'SELECT fingerprint FROM research_submissions WHERE submittedKey=?',args:[key]})).rows[0];if(prior)throw new Error(prior.fingerprint===fingerprint?'Cette comparaison est déjà en cours ou interrompue. Consultez son état avant de relancer.':'Les sites à comparer ont changé. Lancez une nouvelle comparaison.');await tx.execute({sql:'INSERT INTO research_submissions(submittedKey,companyId,campaignId,kind,fingerprint,createdAt) VALUES(?,?,?,?,?,?)',args:[key,companyId,campaignId,'comparison',fingerprint,new Date().toISOString()]});});
  const snapshot:ComparisonSnapshot={id:operationKey,campaignId,companyId,targetRevision:campaign.revision,createdAt:new Date().toISOString(),queries:[],competitors:[],warnings:[]},leads:ReturnType<typeof normalizeSearchResults>=[];
  const business=(campaign.keywords?.split(/[,;\n]/)[0]||campaign.targetBusiness).slice(0,140),queries=[`${business} ${campaign.targetCity}`,`${business} prestations ${campaign.targetCity}`];
  for(let index=0;index<queries.length;index++){
    try{const parameters={engine:'google',q:queries[index],location:`${campaign.targetCity}, France`,gl:'fr',hl:'fr',device:'desktop',num:'10'},body=await serpSearch(repo,parameters,`comparison:${operationKey}:google:${index}`,fetcher),rows=(Array.isArray(body.organic_results)?body.organic_results:[]).slice(0,10) as Array<Record<string,unknown>>;
      const results=rows.flatMap(row=>{const position=Number(row.position),url=typeof row.link==='string'?row.link:'';return Number.isInteger(position)&&position>=1&&position<=10&&Boolean(url)&&researchUrlSchema.safeParse(url).success?[{position,title:String(row.title||'').slice(0,500),url}]:[];});
      const meta=body.search_metadata as Record<string,unknown>|undefined,createdAt=typeof meta?.created_at==='string'?new Date(meta.created_at.replace(' UTC','Z').replace(' ','T')):new Date();
      if(!meta?.created_at&&!body.brine_retrieved_at)snapshot.warnings.push('La date d’origine de ce relevé manque ; date de lecture affichée, ancienneté non vérifiée.');
      const retrieved=typeof body.brine_retrieved_at==='string'?body.brine_retrieved_at:snapshot.createdAt;
      snapshot.queries.push({query:queries[index],location:parameters.location,device:'desktop',recordedAt:meta?.created_at&&Number.isFinite(createdAt.getTime())?createdAt.toISOString():retrieved,depth:10,results});
      if(results.length!==rows.length)snapshot.warnings.push('Certains résultats ne fournissent pas de position exploitable : aucun rang inventé.');
      leads.push(...normalizeSearchResults(body,'google',campaign,queries[index]));
    }catch(error){snapshot.warnings.push(error instanceof Error?error.message:'Recherche localisée indisponible.');}
  }
  const ownHost=company.website?new URL(company.website).hostname.replace(/^www\./,''):'';
  const choices=replacements.length?replacements.slice(0,2).map(url=>({url,name:new URL(url).hostname,sourceUrl:url,confirmed:true})):leads.filter(lead=>lead.websites[0]?.url&&new URL(lead.websites[0].url).hostname.replace(/^www\./,'')!==ownHost).map(lead=>({url:lead.websites[0].url,name:lead.company.name,sourceUrl:lead.company.sourceUrl,confirmed:false}));
  const seen=new Set<string>();for(const choice of choices){const host=new URL(choice.url).hostname.replace(/^www\./,'');if(seen.has(host)||snapshot.competitors.length>=2)continue;seen.add(host);const notes:string[]=[];
    try{const analysis=await analyze(choice.url);for(const finding of analysis.findings.filter(f=>['services','contact','mainAction','mobile'].includes(f.key)).slice(0,4))notes.push(finding.note);notes.push('HTML consulté ; rendu visuel et fonctionnement complet non vérifiés.');}catch{notes.push('Site non consultable pendant cette comparaison ; qualité non déduite de cet échec.');}
    snapshot.competitors.push({...choice,notes,checkedAt:new Date().toISOString()});
  }
  snapshot.warnings.push('Les concurrents proposés doivent être confirmés comme comparables. Un rang est limité à cette requête, ce lieu, cette date et aux résultats consultés. Aucun classement déduit d’une IA.');
  const result=comparisonSchema.parse(snapshot);await repo.transaction(async tx=>{await tx.execute({sql:'INSERT INTO research_comparisons(id,campaignId,companyId,payload) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING',args:[result.id,campaignId,companyId,JSON.stringify(result)]});});await saveResearchCache(repo,cacheKey,result,7*86400000);return result;
}
