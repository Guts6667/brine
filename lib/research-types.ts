import type { SiteAnalysis } from './site-analysis';

export type ResearchProvider = 'registry' | 'ademe' | 'osm' | 'google' | 'maps' | 'openrouter' | 'website' | 'pagespeed' | 'manual';
export interface ResearchSource { id: string; provider: ResearchProvider; url: string; title: string; excerpt: string; collectedAt: string; query?: string; externalId?: string }
export type FactSection = 'identity' | 'fit' | 'presence' | 'presentation' | 'contact' | 'site' | 'visibility' | 'opportunities';
export interface VisualEvidence { category: 'overlap' | 'overflow' | 'unreadable' | 'broken_image' | 'interaction' | 'other'; device: 'desktop' | 'mobile'; pageUrl: string; element: string; viewport?: { width: number; height: number }; screenshot?: string }
export interface ResearchFact { id: string; section: FactSection; kind: 'observed' | 'reported' | 'hypothesis'; sentiment: 'positive' | 'neutral' | 'issue'; text: string; sourceIds: string[]; observedOn: string; scope: string; corrected?: boolean; refutesFactId?:string; visual?: VisualEvidence }
export interface ResearchContact { kind: 'email' | 'phone' | 'formUrl' | 'profileUrl'; value: string; sourceUrl: string; sourceId?: string }
export interface AiPanelResponse { question: string; answer: string; model: string; engine: string; recordedAt: string; sources: ResearchSource[]; valid: boolean; recommendations: Array<{ name: string; city: string; url: string }>; error?: string }
export interface AiPanel { id: string; targetKey: string; createdAt: string; responses: AiPanelResponse[] }
export interface ResearchData { sources: ResearchSource[]; facts: ResearchFact[]; contacts: ResearchContact[]; profiles: string[]; warnings: string[]; panel?: AiPanel; report?: ProspectReport; narrative?: string; collectionStatus?: string; identityKeys?: string[] }
export interface ReportSection { key: FactSection | 'method'; title: string; status: 'documented' | 'partial' | 'unverified' | 'not_applicable'; factIds: string[]; notes: string[] }
export interface ProspectReport { version: 1; id: string; generatedAt: string; companyName: string; summary: string; sources: ResearchSource[]; facts: ResearchFact[]; contacts: ResearchContact[]; profiles: string[]; sections: ReportSection[]; warnings: string[]; coverage: string[]; opportunities: ApproachPlan[]; panel?: AiPanel; narrative?: string }
export interface ProviderProfile { name: string; activity: string; skills: string; services: string; website: string; references: string; terms: string; prices: string; signature: string; revision: number }
export interface ApproachPlan { version: 1; method: 'conversation-v1'; id: string; reportId: string; evidenceIds: string[]; motive: string; rationale: string; hypothesis: string; help: string; question: string; nextStep: string; offer: string; createdAt: string; alternatives?: Array<{ motive: string; evidenceIds: string[]; rationale: string }>; revalidateReason?: string }
export interface ContactDraft { id: string; version: number; channel: 'email' | 'call' | 'reply' | 'followup'; planId: string; reportId: string; profileRevision: number; subject: string; text: string; blocks: Array<{ label: string; text: string }>; createdAt: string; origin: 'template' | 'openrouter' | 'manual'; usedAt?: string }
export interface ContactReadiness { target: boolean; reason: boolean; channel: boolean; evidenceIds: string[]; channelKind: 'email' | 'phone'; confirmedAt: string; targetRevision: number; reportId: string }
export interface ContactEvent { id: string; submittedKey: string; date: string; channel: 'email' | 'phone'; outcome: 'no_response' | 'conversation' | 'callback' | 'not_interested' | 'opposition'; note: string; draftId?: string; nextAction: { text: string; date: string } | null }
export type Audit = SiteAnalysis;
export interface ResearchCorrection { id: string; companyId: string; factId: string; fingerprint: string; note: string; correctedAt: string; mode?: 'fact' | 'hypothesis' }
