import { z } from 'zod';
import { researchFactSchema, researchSourceSchema } from './research-schemas';
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const text = (max:number) => z.string().trim().max(max);
const link = text(2000).refine(value => { if(!value)return true;try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;} }, 'Utilisez une URL publique HTTP ou HTTPS.');
export const studyQuestionSchema = z.object({id,keyword:text(180).min(1),intent:z.enum(['local','project','advice','brand']),text:text(800).min(1),fit:z.enum(['offer','adjacent']),rationale:text(500).min(1),sourceUrl:link}).strict();
export const aiStudyInputSchema = z.object({id,campaignId:id,candidateId:id.nullable(),companyId:id.nullable(),questions:z.array(studyQuestionSchema).min(1).max(6),repeats:z.union([z.literal(1),z.literal(3),z.literal(5)]),channel:z.enum(['api','chatgpt-app','claude-app']),model:text(180),interface:text(180).min(1),reviewed:z.literal(true)}).strict().refine(input=>!!input.companyId!==!!input.candidateId,'Choisissez un prospect.').refine(input=>new Set(input.questions.map(q=>q.id)).size===input.questions.length,'Question dupliquée.');
export const studyTrialSchema = z.object({id,questionId:id,ordinal:z.number().int().min(1).max(5),status:z.enum(['queued','running','valid','unclassified','error','uncertain']),executionOwner:text(128).optional(),rawResponse:text(40000).optional(),answer:text(40000),sources:z.array(researchSourceSchema).max(30),recordedAt:z.iso.datetime().or(z.literal('')),model:text(180),proofUrl:link,mention:z.boolean().nullable(),recommendation:z.boolean().nullable(),citation:z.boolean().nullable(),error:text(2000),reviewedAt:z.iso.datetime().or(z.literal('')),reviews:z.array(z.object({at:z.iso.datetime(),mention:z.boolean().nullable(),recommendation:z.boolean().nullable(),citation:z.boolean().nullable(),answer:text(40000),proofUrl:link}).strict()).max(100).optional()}).strict();
export const aiStudySchema = z.object({version:z.literal(1),id,campaignId:id,candidateId:id.nullable(),companyId:id.nullable(),subject:z.object({name:text(180).min(1),business:text(300),city:text(180),website:link}).strict(),questions:z.array(studyQuestionSchema).min(1).max(6),repeats:z.union([z.literal(1),z.literal(3),z.literal(5)]),channel:z.enum(['api','chatgpt-app','claude-app']),model:text(180),interface:text(180).min(1),mode:z.literal('web'),status:z.enum(['draft','queued','running','paused','completed']),revision:z.number().int().positive(),generation:z.number().int().positive(),owner:text(128),leaseUntil:text(40),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),error:text(2000),evidence:z.array(z.object({questionId:id,fact:researchFactSchema,source:researchSourceSchema}).strict()).max(30).optional(),trials:z.array(studyTrialSchema).min(1).max(30)}).strict().superRefine((s,ctx)=>{
 const ids=new Set(s.questions.map(q=>q.id));
 if(!!s.companyId===!!s.candidateId)ctx.addIssue({code:'custom',message:'Choisissez exactement un prospect.'});
 if(s.evidence?.some(e=>!ids.has(e.questionId)||!e.fact.sourceIds.includes(e.source.id)))ctx.addIssue({code:'custom',message:'Une preuve doit correspondre à une question et à sa source.'});
 if(ids.size!==s.questions.length||s.trials.length!==s.questions.length*s.repeats||new Set(s.trials.map(t=>t.id)).size!==s.trials.length||new Set(s.trials.map(t=>t.questionId+':'+t.ordinal)).size!==s.trials.length||s.trials.some(t=>!ids.has(t.questionId)||t.ordinal>s.repeats))ctx.addIssue({code:'custom',message:'Les essais doivent correspondre exactement aux questions et répétitions.'});
});
export type AiStudy = z.infer<typeof aiStudySchema>;
export type StudyQuestion = z.infer<typeof studyQuestionSchema>;
export type StudyTrial = z.infer<typeof studyTrialSchema>;
export type AiStudyInput = z.infer<typeof aiStudyInputSchema>;
export const aiStudySql = 'CREATE TABLE research_ai_studies (id TEXT PRIMARY KEY, campaignId TEXT NOT NULL, payload TEXT NOT NULL);\n';
export function studyStats(study:AiStudy,questionId:string){
 const trials=study.trials.filter(t=>t.questionId===questionId),valid=trials.filter(t=>t.status==='valid');
 const measure=(key:'mention'|'recommendation'|'citation')=>({yes:valid.filter(t=>t[key]===true).length,classified:valid.filter(t=>t[key]!==null).length});
 return {total:trials.length,valid:valid.length,unclassified:trials.filter(t=>t.status==='unclassified').length,errors:trials.filter(t=>['error','uncertain'].includes(t.status)).length,mention:measure('mention'),recommendation:measure('recommendation'),citation:measure('citation')};
}
