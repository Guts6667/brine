import { CampaignProvider } from './campaign-context';
import { QualificationSummary } from './qualification-summary';
import { QualificationForm, ObservationsForm, AfterExchangeForm } from './qualification-form';
import { QualificationHighlights, FindingReview } from './qualification-enrichment';
import type { CampaignRepository } from '@/lib/campaign-repository';
import { parisToday } from '@/lib/domain';
export function CandidateQualification({context}:{context:Awaited<ReturnType<CampaignRepository['getQualificationContext']>>}){
  const {company,campaign,candidate,report,suggestions}=context,today=parisToday();
  return <CampaignProvider id={campaign.id} revision={company.participationRevision}>
    <QualificationSummary company={company} settings={campaign} today={today}/>
    <QualificationHighlights report={report} suggestions={suggestions}/>
    <QualificationForm company={company} settings={campaign} today={today} suggestions={suggestions} report={report} candidate={candidate}/>
    <details className="review-secondary-detail"><summary>Observations manuelles et preuves complémentaires</summary><div className="details-body"><ObservationsForm company={company} today={today}/></div></details>
    <details className="review-secondary-detail"><summary>Examiner tous les constats ({report.facts.length})</summary><p className="field-help">Confirmer un constat ne change aucun point. Les propositions des critères se valident séparément.</p><div className="details-body">{report.facts.map(fact=><FindingReview key={fact.id} fact={fact} report={report} candidateId={candidate.id} revision={candidate.revision}/>)}</div></details>
    {!company.candidateId&&<AfterExchangeForm company={company}/>}
  </CampaignProvider>;
}
