import { createApproachPlan, evaluateContactReadiness } from '@/lib/contact-preparation';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { getResearchConfiguration } from '@/lib/research-providers';
import { parisToday } from '@/lib/domain';
import { ContactWorkspace } from './contact-workspace';
import type { Campaign, CampaignCompany } from '@/lib/campaign-types';
export async function ProspectWork({company,campaign}:{company:CampaignCompany;campaign:Campaign}){
  const repo=await getCampaignRepository(),[report,profile]=await Promise.all([repo.getCompanyReport(campaign.id,company.id),repo.getProviderProfile()]);
  if(!report)return <p className="inline-empty">Complétez les informations publiques de cette fiche pour construire son dossier.</p>;
  let plan=company.plan||null;
  if(!plan){for(const fact of report.facts.filter(f=>!f.corrected&&f.kind!=='hypothesis'&&f.sourceIds.length).sort((a,b)=>Number(b.sentiment==='issue')-Number(a.sentiment==='issue'))){try{plan=createApproachPlan(report,campaign,profile,[fact.id]);break;}catch{}}}
  const readiness=evaluateContactReadiness(company,campaign,report,parisToday());
  return <ContactWorkspace company={company} campaign={campaign} report={report} profile={profile} plan={plan} aiAvailable={getResearchConfiguration().openRouter} today={parisToday()} ready={readiness.ready} missing={readiness.missing}/>;
}
