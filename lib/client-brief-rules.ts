import type { ProspectReport, ResearchFact } from './research-types';
import { isConfirmedFact } from './qualification-enrichment';
import { isPublicVisualUrl } from './visual-evidence';
/** The client receives public proof, never internal qualification or exchange notes. */
export function isClientBriefFact(fact:ResearchFact,report:ProspectReport){
  return fact.origin!=='qualification'&&fact.origin!=='exchange'&&isConfirmedFact(fact)&&fact.kind!=='hypothesis'&&['site','presentation','presence','contact','visibility'].includes(fact.section)&&Boolean(fact.observedOn)&&fact.sourceIds.length>0&&fact.sourceIds.every(id=>{const source=report.sources.find(s=>s.id===id);try{return Boolean(source?.url)&&isPublicVisualUrl(source!.url)&&!new URL(source!.url).hostname.endsWith('brine-iota.vercel.app');}catch{return false;}});
}
