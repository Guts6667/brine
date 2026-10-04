import type { ActionState } from './types';
import type { CompanySearchInput, CompanySearchResult } from './company-search';
import type { SiteAnalysis } from './site-analysis';

export interface SearchState extends ActionState { result?: CompanySearchResult; request?: CompanySearchInput }
export interface ImportState extends ActionState { companyId?: string }
export interface AnalysisState extends ActionState { analysis?: SiteAnalysis; previewToken?: string }
