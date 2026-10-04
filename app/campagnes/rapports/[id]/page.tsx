import { requireAuthenticated } from '@/lib/auth';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { ProspectReport, PrintReportButton } from '@/components/prospect-report';
import { notFound } from 'next/navigation';
export default async function ReportPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{campagne?:string}>}){await requireAuthenticated();const {id}=await params,{campagne}=await searchParams;if(!campagne)notFound();const report=await(await getCampaignRepository()).getCompanyReport(campagne,id);if(!report)notFound();return <article className="print-report"><h1>Dossier complet · {report.companyName}</h1><p className="small muted">Version du dossier : {report.id} · {report.generatedAt}</p><PrintReportButton/><ProspectReport report={report} expanded/></article>;}
