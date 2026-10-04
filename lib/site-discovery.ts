import { z } from 'zod';
import { normalizePublicSiteUrl } from './site-analysis';
import type { CompanyCandidate } from './company-search';
import type { WebsiteProposal } from './campaign-types';

async function boundedJson(url:URL, fetcher:typeof fetch, timeout=12000):Promise<unknown>{
  const response=await fetcher(url,{signal:AbortSignal.timeout(timeout),redirect:'error',cache:'no-store'});
  if(!response.ok)throw new Error(`Source indisponible (HTTP ${response.status}).`);
  if(!response.body)throw new Error('Source vide.');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw new Error('Réponse source trop volumineuse.');chunks.push(value);}}finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function proposal(value:string,sourceUrl:string,confidence:WebsiteProposal['confidence']):WebsiteProposal|null {
  try{const url=normalizePublicSiteUrl(value).href;const host=new URL(url).hostname;if(/(?:^|\.)(facebook\.com|instagram\.com|linkedin\.com|pagesjaunes\.fr|societe\.com)$/.test(host))return null;return {url,sourceUrl,confidence};}catch{return null;}
}
export async function discoverWebsites(company:CompanyCandidate,fetcher:typeof fetch=fetch):Promise<{websites:WebsiteProposal[];warnings:string[]}>{
  const websites:WebsiteProposal[]=[],warnings:string[]=[];
  if(!/^\d{14}$/.test(company.siret))return {websites,warnings};
  const ademe=new URL('https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2-new/lines');
  ademe.searchParams.set('qs',`siret:${company.siret}`);ademe.searchParams.set('size','100');ademe.searchParams.set('select','siret,site_internet,nom_entreprise,lien_date_debut,lien_date_fin');
  try{const data=z.object({results:z.array(z.object({siret:z.string(),site_internet:z.string().nullish()}))}).parse(await boundedJson(ademe,fetcher));for(const r of data.results){if(r.siret!==company.siret||!r.site_internet)continue;const p=proposal(r.site_internet,`https://data.ademe.fr/datasets/liste-des-entreprises-rge-2-new`, 'exact');if(p)websites.push(p);}}
  catch{warnings.push('La source ADEME est indisponible ; aucun site n’a été déduit de cette erreur.');}
  if(!websites.length){const osm=new URL('https://overpass.private.coffee/api/interpreter');osm.searchParams.set('data',`[out:json][timeout:10];nwr["ref:FR:SIRET"="${company.siret}"];out tags;`);
    try{const data=z.object({elements:z.array(z.object({type:z.enum(['node','way','relation']),id:z.number(),tags:z.record(z.string(),z.string()).optional()}))}).parse(await boundedJson(osm,fetcher));for(const e of data.elements){const value=e.tags?.website||e.tags?.['contact:website'];if(value){const p=proposal(value,`https://www.openstreetmap.org/${e.type}/${e.id}`,'exact');if(p)websites.push(p);}}}catch{warnings.push('Le complément OpenStreetMap est indisponible.');}}
  const unique=websites.filter((p,i)=>websites.findIndex(x=>new URL(x.url).hostname===new URL(p.url).hostname)===i);
  return {websites:unique.map(p=>({...p,confidence:unique.length>1?'confirm':p.confidence})),warnings};
}
