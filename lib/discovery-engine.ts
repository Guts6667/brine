import { randomUUID } from 'node:crypto';
import type { CampaignRepository } from './campaign-repository';
import { searchCompanies } from './company-search';
import { analyzeSite } from './site-analysis';
import { auditMobile } from './mobile-audit';
import { discoverWebsites } from './site-discovery';
import type { DiscoveryCandidate, DiscoveryRun } from './campaign-types';

export const defaultProviders={search:searchCompanies,sites:discoverWebsites,html:analyzeSite,mobile:auditMobile};
export type DiscoveryProviders=typeof defaultProviders;
const errorText=(e:unknown)=>e instanceof Error?e.message.slice(0,1000):'Analyse indisponible.';
export function retryable(message:string){return /429|503|502|504|timeout|timed out|délai|indisponible|fetch failed|ECONNRESET/i.test(message)&&!/robots|privée|interdit|configuration|adresse.*invalide/i.test(message);}
function candidate(runId:string,company:DiscoveryCandidate['company'],companyId:string|null=null,website=''):DiscoveryCandidate{return {id:randomUUID(),runId,companyId,company,status:'queued',websites:[],website,html:null,mobile:null,htmlError:'',mobileError:'',attempts:{},revision:1};}
export async function populateRun(repo:CampaignRepository,run:DiscoveryRun,epoch:string,providers=defaultProviders) {
  if((await repo.listCandidates(run.id)).length)return;
  const candidates:DiscoveryCandidate[]=[];
  if(run.source==='existing'){for(const id of run.companyIds.slice(0,run.limit)){const c=await repo.getCompany(run.campaignId,id);candidates.push(candidate(run.id,{siren:`existing-${c.id}`,siret:'',name:c.name,city:c.city,business:c.business,activityCode:'',address:'',sourceUrl:c.website||'https://annuaire-entreprises.data.gouv.fr'},id,c.website));}}
  else {
    const seen=new Set<string>();
    for(let page=1;page<=5&&candidates.length<run.limit;page++){
      const result=await providers.search({city:run.target.targetCity,activityCodes:run.target.activityCodes,query:'',page});
      for(const company of result.companies){if(seen.has(company.siren))continue;seen.add(company.siren);const known=await repo.knownRegistryCompany(run.campaignId,company.siren);if(known?.opposed||known?.inCampaign)continue;candidates.push(candidate(run.id,company,known?.companyId||null,known?.website||''));if(candidates.length===run.limit)break;}
      if(page>=result.totalPages)break;
    }
  }
  await repo.guardedRun(run.id,run.owner,run.generation,epoch,async tx=>{for(const c of candidates)await repo.putCandidate(tx,c);});
}
export async function processCandidate(repo:CampaignRepository,run:DiscoveryRun,id:string,epoch:string,providers=defaultProviders):Promise<boolean>{
  let c=await repo.getCandidate(id);
  if(['accepted','rejected','verify','review','needs_site'].includes(c.status))return false;
  let retry=false;
  const save=()=>repo.guardedRun(run.id,run.owner,run.generation,epoch,async tx=>{const current=await tx.execute({sql:'SELECT payload FROM discovery_candidates WHERE id = ?',args:[id]});if(!current.rows.length)return;const previous=JSON.parse(String(current.rows[0].payload)) as DiscoveryCandidate;if(previous.revision!==c.revision)throw new Error('Résultat modifié pendant le traitement.');c={...c,revision:c.revision+1};await repo.putCandidate(tx,c);});
  c.status='processing';if(!await save())return false;
  if(!c.website){
    c.attempts.sites=(c.attempts.sites||0)+1;if(!await save())return false;
    const result=await providers.sites(c.company);c.websites=result.websites;
    if(result.websites.length===1&&result.websites[0].confidence==='exact')c.website=result.websites[0].url;
    else{c.status='needs_site';c.htmlError=result.warnings.join(' ');await save();return false;}
    if(!await save())return false;
  }
  if(!c.html && (c.attempts.html||0)<3){c.attempts.html=(c.attempts.html||0)+1;if(!await save())return false;
    try{c.html=await providers.html(c.website);c.htmlError='';}
    catch(e){c.htmlError=errorText(e);retry=retryable(c.htmlError)&&c.attempts.html<3;}
    if(!await save())return false;
  }
  // Mobile audits run serially across the batch, after HTML candidates.
  c.status=retry?'queued':'processing';await save();return retry;
}
export async function processMobile(repo:CampaignRepository,run:DiscoveryRun,id:string,epoch:string,providers=defaultProviders):Promise<boolean>{
  let c=await repo.getCandidate(id);if(['accepted','rejected','verify','review','needs_site'].includes(c.status)||!c.website)return false;
  let retry=false;
  if(!c.mobile&&(c.attempts.mobile||0)<3){c.attempts.mobile=(c.attempts.mobile||0)+1;const reserved=await repo.guardedRun(run.id,run.owner,run.generation,epoch,async tx=>{const rows=await tx.execute({sql:'SELECT payload FROM discovery_candidates WHERE id = ?',args:[id]});const previous=JSON.parse(String(rows.rows[0].payload)) as DiscoveryCandidate;if(previous.revision!==c.revision)throw new Error('Résultat modifié pendant l’audit mobile.');c.revision++;await repo.putCandidate(tx,c);});if(!reserved)return false;try{c.mobile=await providers.mobile(c.website);c.mobileError='';}catch(e){c.mobileError=errorText(e);retry=retryable(c.mobileError)&&c.attempts.mobile<3;}}
  c.status=retry?'processing':'review';
  await repo.guardedRun(run.id,run.owner,run.generation,epoch,async tx=>{const rows=await tx.execute({sql:'SELECT payload FROM discovery_candidates WHERE id = ?',args:[id]});const old=JSON.parse(String(rows.rows[0].payload)) as DiscoveryCandidate;if(old.revision!==c.revision)throw new Error('Résultat modifié pendant l’audit mobile.');c.revision++;await repo.putCandidate(tx,c);});return retry;
}
export async function finishRun(repo:CampaignRepository,run:DiscoveryRun,epoch:string,error='') {await repo.guardedRun(run.id,run.owner,run.generation,epoch,async (_tx,current)=>{current.status=error?'failed':'completed';current.error=error;current.owner='';current.leaseUntil='';});}
