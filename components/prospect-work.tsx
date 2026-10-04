import { createApproachPlan, evaluateContactReadiness, getEligibleApproachEvidence } from '@/lib/contact-preparation';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { getResearchConfiguration } from '@/lib/research-providers';
import { parisToday } from '@/lib/domain';
import { ContactWorkspace } from './contact-workspace';
import type { Campaign, CampaignCompany } from '@/lib/campaign-types';
export async function ProspectWork({company,campaign}:{company:CampaignCompany;campaign:Campaign}){
  const repo=await getCampaignRepository(),[report,profile]=await Promise.all([repo.getCompanyReport(campaign.id,company.id),repo.getProviderProfile()]);
  if(!report)return <p className="inline-empty">Complétez les informations publiques de cette fiche pour construire son dossier.</p>;
  let plan=company.plan||null;
  const eligibleEvidence=getEligibleApproachEvidence(report,campaign,profile);
  const selectedEvidence=company.findingIds.map(id=>eligibleEvidence.find(f=>id===f.id||id.endsWith(':'+f.id))).filter((f):f is typeof eligibleEvidence[number]=>Boolean(f));
  const proposals=company.findingIds.length?selectedEvidence:eligibleEvidence;
  if(!plan){for(const fact of proposals){try{plan=createApproachPlan(report,campaign,profile,[fact.id]);break;}catch{}}}
  const readiness=evaluateContactReadiness(company,campaign,report,parisToday());
  return <ContactWorkspace key={campaign.id+':'+company.id} eligibleEvidence={eligibleEvidence} company={company} campaign={campaign} report={report} profile={profile} plan={plan} aiAvailable={getResearchConfiguration().openRouter} today={parisToday()} ready={readiness.ready} missing={readiness.missing}/>;
}
