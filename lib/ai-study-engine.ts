import { z } from 'zod';
import { normalizeText,normalizedDomain } from './domain';
import type {CampaignRepository} from './campaign-repository';
import type {AiStudy,StudyTrial} from './ai-study-schema';
import {openRouterJson,RESEARCH_MODEL} from './research-providers';
import {getAiStudy,updateStudyTrial,finishAiStudy} from './ai-study-storage';
import {ResearchBudgetError} from './research-budget';
const responseSchema=z.object({answer:z.string().min(1).max(40000),recommendations:z.array(z.object({name:z.string().max(180),city:z.string().max(180),url:z.string().max(2000)}).strict()).max(20)}).strict();
export type StudyProvider=(repo:CampaignRepository,study:AiStudy,trial:StudyTrial)=>ReturnType<typeof openRouterJson>;
export const realStudyProvider:StudyProvider=(repo,study,trial)=>{
 const question=study.questions.find(q=>q.id===trial.questionId)!;
 return openRouterJson(repo,`${question.text}\nRecherche Web. Retourne une réponse à cette question avec tes sources et {"answer":"réponse en français","recommendations":[{"name":"nom du professionnel recommandé","city":"commune","url":"URL citée"}]}. N’ajoute dans recommendations que des entreprises recommandées pour cette demande et documentées par une source consultée.`, `study:${study.id}:trial:${trial.id}`,true,2000,fetch,z.toJSONSchema(responseSchema));
};
export function classifyStudyAnswer(study:AiStudy,trial:StudyTrial,response:Awaited<ReturnType<StudyProvider>>):StudyTrial{
 const parsed=responseSchema.safeParse(response.data),stamp=new Date().toISOString();
 const next={...trial,rawResponse:response.rawText||JSON.stringify(response.data).slice(0,40000),answer:parsed.success?parsed.data.answer:typeof (response.data as {answer?:unknown})?.answer==='string'?String((response.data as {answer:string}).answer).slice(0,40000):JSON.stringify(response.data).slice(0,40000),sources:response.sources,recordedAt:stamp,model:response.model,error:'',status:'unclassified' as StudyTrial['status']};
 if(!parsed.success||!response.sources.length){next.error='Réponse incomplète ou sans source consultée ; classification à vérifier.';return next;}
 const domain=normalizedDomain(study.subject.website),name=normalizeText(study.subject.name),city=normalizeText(study.subject.city);
 const named=parsed.data.recommendations.filter(r=>normalizeText(r.name)===name);
 if(parsed.data.recommendations.some(r=>!response.sources.some(s=>s.url===r.url&&normalizeText(s.title+' '+s.excerpt).includes(normalizeText(r.name))))){next.error='Une recommandation manque de source correspondante ; réponse à vérifier.';return next;}
 const ambiguities=named.some(r=>normalizeText(r.city)!==city||!domain||normalizedDomain(r.url)!==domain||!response.sources.some(s=>s.url===r.url));
 const answerMentions=name.length>2&&(' '+normalizeText(parsed.data.answer)+' ').includes(' '+name+' ');
 const identified=response.sources.some(s=>domain&&normalizedDomain(s.url)===domain);
 if(ambiguities||answerMentions&&!identified){next.error='Nom possiblement homonyme ou identité non rapprochée du domaine ; confirmez cet essai.';return next;}
 return {...next,status:'valid',mention:answerMentions||named.length>0,recommendation:named.length>0,citation:domain?identified:null};
}
export async function executeStudyTrial(repo:CampaignRepository,run:AiStudy,epoch:string,trialId:string,provider:StudyProvider=realStudyProvider){
 const current=await getAiStudy(repo,run.id),trial=current.trials.find(t=>t.id===trialId);if(!trial||!['queued','running'].includes(trial.status))return;
 // The permanent operation key replays a settled response, never a paid request.
 // Pending/uncertain provider operations refuse a second call even after recovery.
 if(!await updateStudyTrial(repo,run,epoch,{...trial,status:'running',executionOwner:run.owner}))return;
 try{const response=await provider(repo,current,trial);await updateStudyTrial(repo,run,epoch,classifyStudyAnswer(current,trial,response));}
 catch(error){const message=(error instanceof Error?error.message:'Réponse indisponible.').slice(0,2000);
  if(error instanceof ResearchBudgetError&&!message.includes('incertain')){await updateStudyTrial(repo,run,epoch,{...trial,status:'queued'});await finishAiStudy(repo,run,epoch,message);return;}
  await updateStudyTrial(repo,run,epoch,{...trial,status:message.includes('incertain')?'uncertain':'error',error:message,recordedAt:new Date().toISOString()});
 }
}
export const simulatedStudyProvider:StudyProvider=async(_repo,study,trial)=>{
 const q=study.questions.find(q=>q.id===trial.questionId)!;
 if(trial.ordinal===3&&study.questions[1]?.id===q.id)throw new Error('Erreur fournisseur simulée ; cet essai ne vaut pas une absence.');
 const url=study.subject.website||'https://atelier-etude.example/',recommended=trial.ordinal!==2;
 return {data:{answer:recommended?`${study.subject.name} à ${study.subject.city} est une option documentée pour cette demande.`:'Autre Atelier est une option locale documentée.',recommendations:recommended?[{name:study.subject.name,city:study.subject.city,url}]:[]},model:RESEARCH_MODEL,sources:[{id:'study-fixture-'+trial.id,provider:'openrouter',url,title:study.subject.name,excerpt:study.subject.name+' '+study.subject.city,collectedAt:new Date().toISOString(),query:q.text}]};
};
