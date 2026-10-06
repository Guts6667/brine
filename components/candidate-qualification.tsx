import {CompanyForm} from './forms';
import {CampaignProvider} from './campaign-context';
import {QualificationForm,ObservationsForm,AfterExchangeForm} from './qualification-form';
import {SiteQualificationWorkspace} from './site-qualification-workspace';
import type {CampaignRepository} from '@/lib/campaign-repository';
import {parisToday} from '@/lib/domain';
import {QualificationSummary} from './qualification-summary';
export function CandidateQualification({context}:{context:Awaited<ReturnType<CampaignRepository['getQualificationContext']>>}){
 const {company,campaign,candidate,report,suggestions}=context,today=parisToday();
 return <CampaignProvider id={campaign.id} revision={company.participationRevision}><QualificationSummary company={company} settings={campaign} today={today} compact/>
 <SiteQualificationWorkspace report={report} website={company.website} candidateId={candidate.id} revision={candidate.revision} studyHref={`/campagnes/${campaign.id}/visibilite-ia?candidat=${candidate.id}`} observations={<ObservationsForm company={company} today={today} report={report} compact/>} qualification={<QualificationForm company={company} settings={campaign} today={today} suggestions={suggestions} report={report} candidate={candidate} compact/>} contactEditor={!company.candidateId?<CompanyForm company={company}/>:undefined} afterExchange={!company.candidateId?<AfterExchangeForm company={company} initiallyOpen/>:undefined}/></CampaignProvider>;
}
