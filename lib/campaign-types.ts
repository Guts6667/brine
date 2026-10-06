import type { Company, NextAction, Settings, Stage } from './types';
import type { QualificationData } from './qualification-types';
import type { CompanyCandidate } from './company-search';
import type { SiteAnalysis } from './site-analysis';
import type { ResearchData, ContactReadiness, ApproachPlan, ContactDraft, ContactEvent, ProviderProfile, ResearchCorrection } from './research-types';

export interface Campaign extends Settings {
  id: string; name: string; activityCodes: string; status: 'active' | 'paused' | 'archived';
  revision: number; createdAt: string; updatedAt: string; keywords?: string;
}
export interface Participation {
  campaignId: string; companyId: string; stage: Stage; archived: boolean;
  qualification: QualificationData; nextAction: NextAction | null;
  approach: string; findingIds: string[]; revision: number; updatedAt: string;
  readiness?: ContactReadiness; plan?: ApproachPlan; planHistory?: ApproachPlan[]; drafts?: ContactDraft[]; contactEvents?: ContactEvent[];
  qualificationEnrichment?: import('./qualification-enrichment').QualificationEnrichment;
}
export type CampaignCompany = Company & { campaignId: string; campaignName: string; participationRevision: number; approach: string; findingIds: string[]; readiness?: ContactReadiness; plan?: ApproachPlan; planHistory?: ApproachPlan[]; drafts?: ContactDraft[]; contactEvents?: ContactEvent[] };
export type RunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export interface DiscoveryRun {
  id: string; campaignId: string; target: Campaign; limit: number; status: RunStatus;
  source: 'registry' | 'existing' | 'mixed'; companyIds: string[]; generation: number; owner: string;
  leaseUntil: string; createdAt: string; updatedAt: string; error: string;
}
export interface WebsiteProposal { url: string; sourceUrl: string; confidence: 'exact' | 'confirm'; }
export interface DiscoveryCandidate {
  id: string; runId: string; companyId: string | null; company: CompanyCandidate;
  status: 'queued' | 'processing' | 'needs_site' | 'review' | 'accepted' | 'rejected' | 'verify';
  websites: WebsiteProposal[]; website: string; html: SiteAnalysis | null; mobile: SiteAnalysis | null;
  htmlError: string; mobileError: string; attempts: Record<string, number>; revision: number;
  dedupeKey?: string; research?: ResearchData;
  qualificationDraft?: QualificationData;
  qualificationEnrichment?: import('./qualification-enrichment').QualificationEnrichment;
}
export interface CampaignBackupData {
  campaigns: Campaign[]; participations: Participation[]; runs: DiscoveryRun[];
  candidates: DiscoveryCandidate[]; identities: { siren: string; companyId: string; siret: string }[];
  activityCampaigns: { activityId: string; campaignId: string }[];
  sourceIdentities?: Array<{ provider: string; externalId: string; companyId: string }>;
  providerProfile?: ProviderProfile;
  corrections?: ResearchCorrection[];
  assets?: import('./research-assets').AssetManifest[];
  comparisons?: import('./comparison').ComparisonSnapshot[];
  clientBriefs?: import('./client-brief').ClientBrief[];
  aiStudies?: import('./ai-study-schema').AiStudy[];
  learningProgress?: import('./learning-types').LearningProgress;
}
