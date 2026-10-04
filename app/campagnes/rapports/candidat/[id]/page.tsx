import { requireAuthenticated } from '@/lib/auth';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { ProspectReport, PrintReportButton } from '@/components/prospect-report';
export default async function CandidateReportPage({params}:{params:Promise<{id:string}>}){await requireAuthenticated();const {id}=await params,repo=await getCampaignRepository(),report=await repo.getCandidateReport(id);return <article className="print-report"><h1>Dossier complet · {report.companyName}</h1><p className="small muted">Version du dossier : {report.id} · {report.generatedAt}</p><PrintReportButton/><ProspectReport report={report} expanded/></article>;}
