import { createApproachPlan, evaluateContactReadiness, getEligibleApproachEvidence } from '@/lib/contact-preparation';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { getLatestComparison } from '@/lib/comparison';
import { clientBriefSchema, briefNeedsUpdate } from '@/lib/client-brief';
import { ComparisonWorkspace, ClientBriefWorkspace } from './client-brief-workspace';
import { getBudgetOverview } from '@/lib/research-budget';
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
  const [comparison,budget,briefRows]=await Promise.all([getLatestComparison(repo,campaign.id,company.id),getBudgetOverview(repo),repo.client.execute({sql:'SELECT payload FROM research_client_briefs WHERE campaignId=? AND companyId=? ORDER BY rowid DESC',args:[campaign.id,company.id]})]);
  const previous=await Promise.all(briefRows.rows.map(async row=>{const brief=clientBriefSchema.parse(JSON.parse(String(row.payload)));return {brief,stale:await briefNeedsUpdate(repo,brief)};}));
  const business=(campaign.keywords?.split(/[,;\n]/)[0]||campaign.targetBusiness).slice(0,140),searchPlan=[`${business} ${campaign.targetCity}`,`${business} prestations ${campaign.targetCity}`];
  return <><ContactWorkspace key={campaign.id+':'+company.id} eligibleEvidence={eligibleEvidence} company={company} campaign={campaign} report={report} profile={profile} plan={plan} aiAvailable={getResearchConfiguration().openRouter} today={parisToday()} ready={readiness.ready} missing={readiness.missing}/><ComparisonWorkspace campaignId={campaign.id} companyId={company.id} comparison={comparison} searchPlan={searchPlan} remainingQueries={budget.serpApiRemaining}/><ClientBriefWorkspace campaignId={campaign.id} companyId={company.id} report={report} profile={profile} website={company.website} comparison={comparison} briefs={previous.map(({brief,stale})=>({id:brief.id,createdAt:brief.createdAt,stale}))}/></>;
}
