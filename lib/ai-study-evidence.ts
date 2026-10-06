import {createHash} from 'node:crypto';
import {aiStudySchema,type AiStudy,studyStats} from './ai-study-schema';
import type {ProspectReport,ResearchFact,ResearchSource} from './research-types';
import type {Transaction} from '@libsql/client';
export function studyEvidence(study:AiStudy,questionId:string){
 const question=study.questions.find(q=>q.id===questionId);if(!question)throw new Error('Question introuvable.');
 const stats=studyStats(study,questionId);if(!stats.valid)throw new Error('Classez au moins un essai avant de choisir cette observation.');
 const trials=study.trials.filter(t=>t.questionId===questionId),stamp=trials.filter(t=>t.recordedAt).map(t=>t.recordedAt).sort().at(-1)!;
 const fingerprint=createHash('sha256').update(JSON.stringify([study.id,questionId,trials])).digest('hex').slice(0,24),id='study-'+fingerprint,sourceId=id+'-source';
 const ratio=(s:{yes:number;classified:number})=>s.classified?`${s.yes}/${s.classified}`:'non classé';
 const source:ResearchSource={id:sourceId,provider:study.channel==='api'?'openrouter':'manual',url:`https://brine-iota.vercel.app/campagnes/${study.campaignId}/visibilite-ia?etude=${study.id}`,title:'Questions, réponses et preuves de l’étude conservée',excerpt:trials.map(t=>`Essai ${t.ordinal} · ${t.status} · ${t.model}\n${t.answer||t.error}`).join('\n').slice(0,12000),collectedAt:stamp,query:question.text};
 const fact:ResearchFact={id,section:'visibility',kind:'observed',sentiment:'neutral',text:`Pour « ${question.text} », ${study.subject.name} a été recommandé dans ${ratio(stats.recommendation)} réponses classées (${study.interface}). Mentions : ${ratio(stats.mention)} ; liens vers son domaine : ${ratio(stats.citation)}. ${stats.valid}/${stats.total} essais classés, ${stats.errors} erreur(s).`,sourceIds:[sourceId],observedOn:stamp,scope:`Étude ${study.id}, question ${question.id}, mot-clé « ${question.keyword} », intention ${question.intent}. Modèle ${study.model||'inconnu'} ; recherche web. La ville est demandée dans la question ; localisation effective du moteur non vérifiée. Relevé limité et daté, sans mesure de visibilité générale, sans cause ni impact commercial déduits.`,review:{state:'confirmed',nature:'measurement',provenance:'manual',reviewedAt:new Date().toISOString()}};
 return {questionId,fact,source};
}
export async function appendStudyEvidence(tx:Transaction,report:ProspectReport,campaignId:string,companyId:string|null,candidateId:string|null){
 const rows=await tx.execute({sql:'SELECT payload FROM research_ai_studies WHERE campaignId=?',args:[campaignId]});
 const evidence=rows.rows.map(r=>aiStudySchema.parse(JSON.parse(String(r.payload)))).filter(s=>(companyId&&s.companyId===companyId)||(candidateId&&s.candidateId===candidateId)).flatMap(s=>s.evidence||[]);
 if(!evidence.length)return report;
 const result=structuredClone(report);for(const item of evidence){const index=result.facts.findIndex(f=>f.id===item.fact.id);if(index<0)result.facts.push(item.fact);else if(item.fact.corrected)result.facts[index]={...result.facts[index],corrected:true,scope:item.fact.scope};if(!result.sources.some(s=>s.id===item.source.id))result.sources.push(item.source);const section=result.sections.find(s=>s.key==='visibility');if(section&&!section.factIds.includes(item.fact.id)){section.factIds.push(item.fact.id);section.status='documented';}}
 result.id='report-'+createHash('sha256').update(JSON.stringify([report.id,evidence])).digest('hex').slice(0,24);return result;
}
