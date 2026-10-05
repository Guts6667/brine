import {z} from 'zod';
import {LEARNING_MODULE_IDS,LEARNING_STEPS,type LearningProgress,type LearningJson} from './learning-types';
export const learningModuleIdSchema=z.enum(LEARNING_MODULE_IDS),learningStepSchema=z.enum(LEARNING_STEPS);
function bounded(value:LearningJson,depth=0):boolean{
 if(depth>8)return false;
 if(typeof value==='string')return value.length<=12000;
 if(Array.isArray(value))return value.length<=100&&value.every(item=>bounded(item,depth+1));
 if(value&&typeof value==='object')return Object.entries(value).length<=100&&Object.entries(value).every(([key,item])=>!['__proto__','constructor','prototype'].includes(key)&&key.length<=80&&bounded(item,depth+1));
 return true;
}
const learningJson=z.json().refine(value=>bounded(value)&&JSON.stringify(value).length<=24000,'Réponse d’exercice trop volumineuse.');
export const learningAnswersSchema=z.custom<Record<string,LearningJson>>(value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&bounded(value as LearningJson),'Réponses d’exercice invalides.').pipe(z.record(z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).refine(key=>!['__proto__','constructor','prototype'].includes(key),'Clé de réponse invalide.'),learningJson)).refine(value=>Object.keys(value).length<=80&&JSON.stringify(value).length<=24000,'Réponses d’exercice trop volumineuses.');
export const learningMissionSchema=z.object({examinedThree:z.boolean(),justifiedDecisions:z.boolean(),preparedEmail:z.boolean(),recordedContact:z.boolean()}).strict();
export const learningProgressSchema=z.object({version:z.literal(1),revision:z.number().int().min(0),updatedAt:z.iso.datetime().or(z.literal('')),currentModule:learningModuleIdSchema,currentStep:learningStepSchema,completedModules:z.array(learningModuleIdSchema).max(6).refine(ids=>new Set(ids).size===ids.length,'Module terminé dupliqué.'),answers:z.object(Object.fromEntries(LEARNING_MODULE_IDS.map(id=>[id,learningAnswersSchema.optional()]))).strict(),campaignId:z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).nullable(),guideOpen:z.boolean(),showTodayCard:z.boolean(),mission:learningMissionSchema}).strict();
const revision={revision:z.number().int().min(0)};
export const learningMutationSchema=z.discriminatedUnion('operation',[
 z.object({...revision,operation:z.literal('visit'),moduleId:learningModuleIdSchema,step:learningStepSchema}).strict(),
 z.object({...revision,operation:z.literal('answers'),moduleId:learningModuleIdSchema,answers:learningAnswersSchema}).strict(),
 z.object({...revision,operation:z.literal('complete'),moduleId:learningModuleIdSchema}).strict(),
 z.object({...revision,operation:z.literal('campaign'),campaignId:learningProgressSchema.shape.campaignId}).strict(),
 z.object({...revision,operation:z.literal('guide'),guideOpen:z.boolean()}).strict(),
 z.object({...revision,operation:z.literal('card'),showTodayCard:z.boolean()}).strict(),
 z.object({...revision,operation:z.literal('mission'),mission:learningMissionSchema}).strict(),
]);
export type LearningMutation=z.infer<typeof learningMutationSchema>;
export function emptyLearningProgress():LearningProgress{return {version:1,revision:0,updatedAt:'',currentModule:'cible',currentStep:'understand',completedModules:[],answers:{},campaignId:null,guideOpen:false,showTodayCard:true,mission:{examinedThree:false,justifiedDecisions:false,preparedEmail:false,recordedContact:false}};}
export const learningSql="CREATE TABLE learning_progress (id TEXT PRIMARY KEY CHECK (id = 'learner'), payload TEXT NOT NULL);\n";
/** Imports predating training retain the current answers; revisions never rewind. */
export function learningProgressAfterRestore(incoming:LearningProgress|undefined,existing:LearningProgress|undefined,campaignIds:string[]):LearningProgress|undefined{
 const progress=incoming||existing;if(!progress)return undefined;
 return learningProgressSchema.parse({...progress,revision:Math.max(progress.revision,existing?.revision||0)+1,updatedAt:new Date().toISOString(),campaignId:progress.campaignId&&campaignIds.includes(progress.campaignId)?progress.campaignId:null}) as LearningProgress;
}
