import type { ActionState } from './types';
export const LEARNING_MODULE_IDS=['cible','occasion','qualification','email','suivi','echange'] as const;
export const LEARNING_STEPS=['understand','example','practice','feedback','apply'] as const;
export type LearningModuleId=typeof LEARNING_MODULE_IDS[number];
export type LearningStep=typeof LEARNING_STEPS[number];
export type LearningJson=null|string|number|boolean|LearningJson[]|{[key:string]:LearningJson};
export type LearningAnswers=Record<string,LearningJson>;
export interface LearningProgress {
 version:1;revision:number;updatedAt:string;currentModule:LearningModuleId;currentStep:LearningStep;
 completedModules:LearningModuleId[];answers:Partial<Record<LearningModuleId,LearningAnswers>>;
 campaignId:string|null;guideOpen:boolean;showTodayCard:boolean;
 mission:{examinedThree:boolean;justifiedDecisions:boolean;preparedEmail:boolean;recordedContact:boolean};
}
export interface LearningActionState extends ActionState {progress?:LearningProgress}
export type LearningCampaignOption={id:string;name:string;targetBusiness:string;targetCity:string};
