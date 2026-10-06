import type { QualificationData } from './qualification-types';
import type { ContactReadiness, ApproachPlan, ContactDraft, ContactEvent } from './research-types';
export type Answer = 'yes' | 'no' | 'unknown';
export const stages = ['À étudier', 'À contacter', 'En échange', 'Opportunité qualifiée', 'Proposition envoyée', 'Gagné', 'Perdu'] as const;
export type Stage = typeof stages[number];
export interface Contact { name: string; role: string; email: string; phone: string; formUrl: string; profileUrl: string }
export interface NextAction { id: string; text: string; date: string; createdAt: string }
export interface Company {
  id: string; name: string; website: string; city: string; business: string;
  targetFit: Answer; problemFound: Answer; contactAvailable: Answer;
  observation: string; proofUrl: string; observedOn: string; trigger: string;
  stage: Stage; archived: boolean;
  oppositionActive: boolean; oppositionDate: string; oppositionNote: string;
  contact: Contact; nextAction: NextAction | null; createdAt: string; updatedAt: string;
  qualification?: QualificationData;
  candidateId?: string;
  qualificationEnrichment?: import('./qualification-enrichment').QualificationEnrichment;
  campaignId?: string; campaignName?: string; participationRevision?: number; approach?: string; findingIds?: string[];
  readiness?: ContactReadiness; plan?: ApproachPlan; planHistory?: ApproachPlan[]; drafts?: ContactDraft[]; contactEvents?: ContactEvent[];
}
export type CompanyInput = Pick<Company, 'name' | 'website' | 'city' | 'business'>;
export type CompanyDetails = Omit<Company, 'id' | 'nextAction' | 'createdAt' | 'updatedAt' | 'oppositionActive' | 'oppositionDate' | 'oppositionNote' | 'archived' | 'qualification'>;
export interface Activity {
  id: string; companyId: string; kind: 'note' | 'exchange' | 'action_done' | 'action_rescheduled' | 'system';
  type: string; date: string; text: string; createdAt: string;
}
export interface AiTest {
  id: string; companyId: string; panel: string; period: string; tool: string; interface: string;
  mode: 'web' | 'api' | 'unknown'; model: string; questions: string;
  validResponses: number | null; recommendations: number | null; citations: number | null;
  notes: string; proofUrl: string; createdAt: string;
}
export type AiTestInput = Omit<AiTest, 'id' | 'companyId' | 'createdAt'>;
export interface Settings { targetCity: string; targetBusiness: string; targetCompanyType?: string; targetOffer?: string; targetExclusions?: string }
export interface Backup { schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7; campaignData?: import('./campaign-types').CampaignBackupData; exportedAt: string; companies: Company[]; activities: Activity[]; aiTests: AiTest[]; settings: Settings }
export interface ActionState { ok?: boolean; error?: string; fields?: Record<string, string>; duplicates?: { id: string; name: string }[]; message?: string; briefId?:string }
