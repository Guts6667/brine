import type { Company, NextAction, Settings, Stage } from './types';
import type { QualificationData } from './qualification-types';
import type { CompanyCandidate } from './company-search';
import type { SiteAnalysis } from './site-analysis';

export interface Campaign extends Settings {
  id: string; name: string; activityCodes: string; status: 'active' | 'paused' | 'archived';
  revision: number; createdAt: string; updatedAt: string;
}
export interface Participation {
  campaignId: string; companyId: string; stage: Stage; archived: boolean;
  qualification: QualificationData; nextAction: NextAction | null;
  approach: string; findingIds: string[]; revision: number; updatedAt: string;
}
export type CampaignCompany = Company & { campaignId: string; campaignName: string; participationRevision: number; approach: string; findingIds: string[] };
export type RunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export interface DiscoveryRun {
  id: string; campaignId: string; target: Campaign; limit: number; status: RunStatus;
  source: 'registry' | 'existing'; companyIds: string[]; generation: number; owner: string;
  leaseUntil: string; createdAt: string; updatedAt: string; error: string;
}
export interface WebsiteProposal { url: string; sourceUrl: string; confidence: 'exact' | 'confirm'; }
export interface DiscoveryCandidate {
  id: string; runId: string; companyId: string | null; company: CompanyCandidate;
  status: 'queued' | 'processing' | 'needs_site' | 'review' | 'accepted' | 'rejected' | 'verify';
  websites: WebsiteProposal[]; website: string; html: SiteAnalysis | null; mobile: SiteAnalysis | null;
  htmlError: string; mobileError: string; attempts: Record<string, number>; revision: number;
}
export interface CampaignBackupData {
  campaigns: Campaign[]; participations: Participation[]; runs: DiscoveryRun[];
  candidates: DiscoveryCandidate[]; identities: { siren: string; companyId: string; siret: string }[];
  activityCampaigns: { activityId: string; campaignId: string }[];
}
