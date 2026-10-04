import { requireAuthenticated } from '@/lib/auth';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { buildProspectReport } from '@/lib/research-report';
import { ProspectReport, PrintReportButton } from '@/components/prospect-report';
export default async function CandidateReportPage({params}:{params:Promise<{id:string}>}){await requireAuthenticated();const {id}=await params,repo=await getCampaignRepository(),candidate=await repo.getCandidate(id),run=await repo.getRun(candidate.runId),report=buildProspectReport(candidate,run.target);return <article className="print-report"><h1>Dossier complet · {report.companyName}</h1><p className="small muted">Version du dossier : {report.id} · {report.generatedAt}</p><PrintReportButton/><ProspectReport report={report} expanded/></article>;}
