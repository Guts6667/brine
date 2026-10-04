import { randomUUID } from 'node:crypto';
import type { CampaignRepository } from './campaign-repository';
import { searchCompanies } from './company-search';
import { analyzeSite } from './site-analysis';
import { auditMobile } from './mobile-audit';
import { discoverWebsites } from './site-discovery';
import type { DiscoveryCandidate, DiscoveryRun } from './campaign-types';
import type { AiPanel, ProspectReport, ResearchData } from './research-types';
import { discoverMixedProspects, enrichCandidateResearch, generateReportNarrative, getNeutralAiPanel, emptyResearch, mergeResearchData, stableResearchKey, discoveryBacklogKey, DISCOVERY_BACKLOG_LIFETIME, type DiscoveryLead, type MixedDiscoveryResult, type ResearchEnrichment } from './research-providers';
import { buildProspectReport } from './research-report';
import { normalizeText } from './domain';
import { collectRenderedAudit, proposeVisualFindings } from './rendered-audit';

export interface DiscoveryProviders {
  search: typeof searchCompanies; sites: typeof discoverWebsites; html: typeof analyzeSite; mobile: typeof auditMobile;
  mixed?: (repo: CampaignRepository, run: DiscoveryRun, deadlineAt?:number) => Promise<MixedDiscoveryResult>;
  enrich?: (repo: CampaignRepository, run: DiscoveryRun, candidate: DiscoveryCandidate) => Promise<ResearchData|ResearchEnrichment>;
  panel?: (repo: CampaignRepository, run: DiscoveryRun) => Promise<AiPanel | undefined>;
  report?: (repo: CampaignRepository, run: DiscoveryRun, candidate: DiscoveryCandidate, report: ProspectReport) => Promise<string>;
}
export const defaultProviders: DiscoveryProviders={search:searchCompanies,sites:discoverWebsites,html:analyzeSite,mobile:auditMobile,mixed:(repo,run,deadlineAt)=>discoverMixedProspects(repo,run,fetch,deadlineAt),enrich:enrichCandidateResearch};
const errorText=(e:unknown)=>e instanceof Error?e.message.slice(0,1000):'Analyse indisponible.';
export function retryable(message:string){return /429|503|502|504|timeout|timed out|délai|indisponible|fetch failed|ECONNRESET/i.test(message)&&!/robots|privée|interdit|configuration|adresse.*invalide/i.test(message);}
function candidate(runId:string,company:DiscoveryCandidate['company'],companyId:string|null=null,website=''):DiscoveryCandidate{return {id:randomUUID(),runId,companyId,company,status:'queued',websites:[],website,html:null,mobile:null,htmlError:'',mobileError:'',attempts:{},revision:1,dedupeKey:companyId?`company:${companyId}`:/^\d{9}$/.test(company.siren)?`siren:${company.siren}`:`name:${stableResearchKey([normalizeText(company.name),normalizeText(company.city)])}`,research:emptyResearch()};}
export async function populateRun(repo:CampaignRepository,run:DiscoveryRun,epoch:string,providers:DiscoveryProviders=defaultProviders) {
  if((await repo.listCandidates(run.id)).length)return;
  const deadlineAt=Date.now()+180_000,collectionWarnings:string[]=[];
  const candidates:DiscoveryCandidate[]=[];let remainingLeads:DiscoveryLead[]|undefined;
  if(run.source==='existing'){for(const id of run.companyIds.slice(0,run.limit)){const c=await repo.getCompany(run.campaignId,id),url=`https://brine-iota.vercel.app/prospects/${encodeURIComponent(id)}`,entry=candidate(run.id,{siren:'',siret:'',name:c.name,city:c.city,business:c.business,activityCode:'',address:'',sourceUrl:url},id,c.website),sourceId=`manual-${id}`;entry.research={...emptyResearch(),sources:[{id:sourceId,provider:'manual',url,title:'Saisie manuelle dans le dossier Brine',excerpt:`${c.name} · ${c.city} · ${c.business}`,collectedAt:''}],contacts:(['email','phone','formUrl','profileUrl'] as const).flatMap(kind=>c.contact[kind]?[{kind,value:c.contact[kind],sourceUrl:url,sourceId}]:[]),profiles:c.contact.profileUrl?[c.contact.profileUrl]:[]};candidates.push(entry);}}
  else {
    const priorRows=await repo.client.execute({sql:'SELECT c.payload FROM discovery_candidates c JOIN discovery_runs r ON r.id = c.runId WHERE r.campaignId = ? AND r.id <> ?',args:[run.campaignId,run.id]});
    const prior=priorRows.rows.map(row=>JSON.parse(String(row.payload)) as DiscoveryCandidate);
    const priorKeys=new Set(prior.map(c=>c.dedupeKey||(/^\d{9}$/.test(c.company.siren)?`siren:${c.company.siren}`:'')));
    const seen=new Set<string>();
    const registryLimit=run.source==='mixed'&&providers.mixed?Math.max(1,Math.floor(run.limit/2)):run.limit;
    for(let page=1;page<=5&&candidates.length<registryLimit;page++){
      if(Date.now()+25_000>deadlineAt){collectionWarnings.push('La collecte du registre est arrêtée pour respecter la durée du lot. Les résultats déjà acquis sont conservés.');break;}
      let result;try{result=await providers.search({city:run.target.targetCity,activityCodes:run.target.activityCodes,query:run.target.activityCodes?'':(run.target.keywords||run.target.targetBusiness).split(/[,;\n]/)[0].slice(0,180),page});}catch(error){if(run.source!=='mixed')throw error;break;}
      for(const company of result.companies){if(seen.has(company.siren)||priorKeys.has(`siren:${company.siren}`))continue;seen.add(company.siren);const known=await repo.knownRegistryCompany(run.campaignId,company.siren);if(known?.opposed||known?.inCampaign)continue;candidates.push(candidate(run.id,company,known?.companyId||null,known?.website||''));if(candidates.length===registryLimit)break;}
      if(page>=result.totalPages)break;
    }
    if(run.source==='mixed'&&providers.mixed){
      const result=await providers.mixed(repo,run,deadlineAt);
      collectionWarnings.push(...result.warnings);
      remainingLeads=[];
      for(const lead of result.leads){
        if(priorKeys.has(lead.dedupeKey)||prior.some(c=>normalizeText(c.company.name)===normalizeText(lead.company.name)&&normalizeText(c.company.city)===normalizeText(lead.company.city)))continue;
        const duplicate=candidates.find(c=>c.dedupeKey===lead.dedupeKey||normalizeText(c.company.name)===normalizeText(lead.company.name)&&normalizeText(c.company.city)===normalizeText(lead.company.city));
        if(duplicate){duplicate.research=mergeResearchData(duplicate.research,lead.research);duplicate.websites.push(...lead.websites.filter(p=>!duplicate.websites.some(x=>x.url===p.url)));continue;}
        let known=null;
        for(const identity of lead.research.identityKeys||[]){const at=identity.indexOf(':');if(at>0){known=await repo.knownSourceCompany(run.campaignId,identity.slice(0,at),identity.slice(at+1));if(known)break;}}
        if(known?.opposed||known?.inCampaign)continue;
        if(candidates.length>=run.limit){remainingLeads.push(lead);continue;}
        const c=candidate(run.id,lead.company,known?.companyId||null,known?.website||lead.website);c.dedupeKey=lead.dedupeKey;c.websites=lead.websites;c.research=lead.research;candidates.push(c);
      }
    }
  }
  if(collectionWarnings.length)for(const c of candidates)c.research=mergeResearchData(c.research,{...emptyResearch(),warnings:collectionWarnings});
  await repo.guardedRun(run.id,run.owner,run.generation,epoch,async(tx,current)=>{for(const c of candidates)await repo.putCandidate(tx,c);current.error=collectionWarnings.length?`Collecte partielle : ${[...new Set(collectionWarnings)].join(' ')}`.slice(0,3800):'';if(remainingLeads)await tx.execute({sql:'INSERT INTO research_cache(cacheKey,expiresAt,payload) VALUES (?,?,?) ON CONFLICT(cacheKey) DO UPDATE SET expiresAt = excluded.expiresAt, payload = excluded.payload',args:[discoveryBacklogKey(run),new Date(Date.now()+DISCOVERY_BACKLOG_LIFETIME).toISOString(),JSON.stringify(remainingLeads)]});});
}
export async function prepareRunPanel(repo:CampaignRepository,run:DiscoveryRun,epoch:string,providers:DiscoveryProviders=defaultProviders){
  const candidates=await repo.listCandidates(run.id);if(!candidates.length||!providers.panel||candidates.some(c=>c.research?.panel))return;
  let panel:AiPanel|undefined,warning='';try{panel=await providers.panel(repo,run);}catch(error){warning=errorText(error);}
  if(!panel&&!warning)return;
  await repo.guardedRun(run.id,run.owner,run.generation,epoch,async tx=>{for(const candidate of candidates){const rows=await tx.execute({sql:'SELECT payload FROM discovery_candidates WHERE id = ?',args:[candidate.id]});if(!rows.rows.length)continue;const current=JSON.parse(String(rows.rows[0].payload)) as DiscoveryCandidate;if(['accepted','rejected'].includes(current.status))continue;current.research={...mergeResearchData(current.research,...(warning?[{...emptyResearch(),warnings:[warning]}]:[])),...(panel?{panel}:{})};current.revision++;await repo.putCandidate(tx,current);}});
}
export async function processCandidate(repo:CampaignRepository,run:DiscoveryRun,id:string,epoch:string,providers:DiscoveryProviders=defaultProviders):Promise<boolean>{
  let c=await repo.getCandidate(id);
  if(['accepted','rejected','verify','review','needs_site'].includes(c.status))return false;
  let retry=false;
  const save=()=>repo.guardedRun(run.id,run.owner,run.generation,epoch,async tx=>{const current=await tx.execute({sql:'SELECT payload FROM discovery_candidates WHERE id = ?',args:[id]});if(!current.rows.length)return;const previous=JSON.parse(String(current.rows[0].payload)) as DiscoveryCandidate;if(previous.revision!==c.revision)throw new Error('Résultat modifié pendant le traitement.');c={...c,revision:c.revision+1};await repo.putCandidate(tx,c);});
  c.status='processing';if(!await save())return false;
  if(providers.enrich&&!c.attempts.enrichCompleted){c.attempts.enrich=1;if(!await save())return false;try{const enrichment=await providers.enrich(repo,run,c);c.research=mergeResearchData(c.research,'research'in enrichment?enrichment.research:enrichment);if('research'in enrichment)c.websites.push(...enrichment.websites.filter(p=>!c.websites.some(previous=>previous.url===p.url)));}catch(error){c.research=mergeResearchData(c.research,{...emptyResearch(),warnings:[errorText(error)]});}c.attempts.enrichCompleted=1;if(!await save())return false;}
  if(!c.website){
    c.attempts.sites=(c.attempts.sites||0)+1;if(!await save())return false;
    let result;try{result=await providers.sites(c.company);}catch(error){result={websites:[],warnings:[errorText(error)]};}c.websites=[...c.websites,...result.websites.filter(p=>!c.websites.some(existing=>existing.url===p.url))];
    if(result.websites.length===1&&result.websites[0].confidence==='exact')c.website=result.websites[0].url;
    else{c.status='review';c.htmlError=result.warnings.join(' ');c.research=mergeResearchData(c.research,{...emptyResearch(),warnings:result.warnings,collectionStatus:c.research?.profiles.length?'Profil professionnel trouvé ; site officiel inconnu.':'Site officiel non confirmé. Aucun audit du site effectué.'});await save();return false;}
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
export async function processMobile(repo:CampaignRepository,run:DiscoveryRun,id:string,epoch:string,providers:DiscoveryProviders=defaultProviders):Promise<boolean>{
  let c=await repo.getCandidate(id);if(['accepted','rejected','verify','review','needs_site'].includes(c.status)||!c.website)return false;
  let retry=false;
  if(!c.mobile&&(c.attempts.mobile||0)<3){c.attempts.mobile=(c.attempts.mobile||0)+1;const reserved=await repo.guardedRun(run.id,run.owner,run.generation,epoch,async tx=>{const rows=await tx.execute({sql:'SELECT payload FROM discovery_candidates WHERE id = ?',args:[id]});const previous=JSON.parse(String(rows.rows[0].payload)) as DiscoveryCandidate;if(previous.revision!==c.revision)throw new Error('Résultat modifié pendant l’audit mobile.');c.revision++;await repo.putCandidate(tx,c);});if(!reserved)return false;try{c.mobile=await providers.mobile(c.website);c.mobileError='';}catch(e){c.mobileError=errorText(e);retry=retryable(c.mobileError)&&c.attempts.mobile<3;}}
  c.status=retry?'processing':'review';
  await repo.guardedRun(run.id,run.owner,run.generation,epoch,async tx=>{const rows=await tx.execute({sql:'SELECT payload FROM discovery_candidates WHERE id = ?',args:[id]});const old=JSON.parse(String(rows.rows[0].payload)) as DiscoveryCandidate;if(old.revision!==c.revision)throw new Error('Résultat modifié pendant l’audit mobile.');c.revision++;await repo.putCandidate(tx,c);});return retry;
}
export async function processReport(repo:CampaignRepository,run:DiscoveryRun,id:string,epoch:string,providers:DiscoveryProviders=defaultProviders){
  let c=await repo.getCandidate(id);let renderingChanged=false;if(['accepted','rejected','verify','queued'].includes(c.status))return;
  if(providers===defaultProviders&&c.website&&!c.attempts.renderCompleted){
    if(/robots|interdit|privée/i.test(c.htmlError))c.research=mergeResearchData(c.research,{...emptyResearch(),warnings:['Rendu non effectué : la collecte du site est interdite ou inaccessible.']});
    else try{const rendering=await collectRenderedAudit(repo,c.website,`candidate:${c.id}:render-v1:${stableResearchKey(c.website).slice(0,16)}`);c.research=mergeResearchData(c.research,rendering);try{const facts=await proposeVisualFindings(repo,rendering,`candidate:${c.id}:vision-v1:${stableResearchKey(rendering.facts.map(f=>f.id)).slice(0,16)}`);c.research=mergeResearchData(c.research,{...emptyResearch(),sources:rendering.sources,facts});}catch{c.research=mergeResearchData(c.research,{...emptyResearch(),warnings:['Interprétation visuelle indisponible ; captures et mesures conservées pour votre revue.']});}}catch(error){c.research=mergeResearchData(c.research,{...emptyResearch(),warnings:[errorText(error)]});}
    c.attempts.renderCompleted=1;renderingChanged=true;
  }
  let report=buildProspectReport(c,run.target);
  if(c.research?.report?.id===report.id&&!renderingChanged)return;
  if(c.research?.report){c.research={...c.research,narrative:''};report=buildProspectReport(c,run.target);}
  if(providers.report){try{const narrative=await providers.report(repo,run,c,report);if(narrative)c.research={...(c.research||emptyResearch()),narrative};}catch{c.research=mergeResearchData(c.research,{...emptyResearch(),warnings:['La synthèse IA est indisponible ; le dossier factuel est conservé.']});}report=buildProspectReport(c,run.target);}
  if(providers===defaultProviders){
    // Store proposal states for HTML/PageSpeed too, rather than implicitly confirming measurements.
    const data=c.research||emptyResearch();for(const source of report.sources)if(!data.sources.some(s=>s.id===source.id))data.sources.push(source);
    for(const fact of report.facts)if(!data.facts.some(f=>f.id===fact.id))data.facts.push({...fact,review:fact.review||{state:'proposed',nature:fact.kind==='observed'?'measurement':'observation',provenance:'render'}});
    c.research=data;report=buildProspectReport(c,run.target);
  }
  c.research={...(c.research||emptyResearch()),report};c.status='review';
  await repo.guardedRun(run.id,run.owner,run.generation,epoch,async tx=>{const rows=await tx.execute({sql:'SELECT payload FROM discovery_candidates WHERE id = ?',args:[id]});if(!rows.rows.length)return;const old=JSON.parse(String(rows.rows[0].payload)) as DiscoveryCandidate;if(old.revision!==c.revision)return;c.revision++;await repo.putCandidate(tx,c);});
}
export async function finishRun(repo:CampaignRepository,run:DiscoveryRun,epoch:string,error='') {await repo.guardedRun(run.id,run.owner,run.generation,epoch,async (_tx,current)=>{current.status=error?'failed':'completed';current.error=error||(current.error.startsWith('Collecte partielle : ')?current.error:'');current.owner='';current.leaseUntil='';});}
