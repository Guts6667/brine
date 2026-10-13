import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { requireAuthenticated } from '@/lib/auth';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { CampaignProvider } from '@/components/campaign-context';
import { dueStatus, isEligible, parisToday } from '@/lib/domain';
import { evaluateQualification } from '@/lib/qualification';
import { evaluateContactReadiness } from '@/lib/contact-preparation';
import { AddCompany } from '@/components/forms';
import { TodayRow } from '@/components/presentation';
import type { Company } from '@/lib/types';
import { LearningTodayCard } from '@/components/learning-today-card';
import { UI_LABELS } from '@/lib/labels';
import type { Campaign } from '@/lib/campaign-types';
import { SectionLoadingSkeleton } from '@/components/page-loading';
import { BackgroundGradient } from '@/components/ui/background-gradient';

export default async function Today({searchParams}:{searchParams:Promise<{view?:string;campagne?:string}>}) {
  await requireAuthenticated();
  const {campagne}=await searchParams;
  const repo=await getCampaignRepository();
  const campaigns=await repo.listCampaigns();
  const active=campaigns.filter(c=>c.status==='active'&&(!campagne||c.id===campagne));
  const settings=campaigns.find(c=>c.id===campagne)||campaigns[0];
  const currentDay=parisToday();
  const date=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Paris'}).format(new Date(`${currentDay}T12:00:00Z`));
  return <>
    <div className="page-heading today-heading"><div><p className="eyebrow">{date}</p><h1>Aujourd’hui</h1></div><div className="button-row"><Link href="/campagnes" className="button secondary">Mes campagnes</Link><CampaignProvider id={settings.id}><AddCompany settings={settings}/></CampaignProvider></div></div>
    <nav className="filter-tabs today-campaign-filter" aria-label="Filtrer les campagnes"><Link href="/" className={!campagne?'selected':''}>Toutes les campagnes</Link>{campaigns.filter(c=>c.status==='active').map(c=><Link key={c.id} href={`/?campagne=${c.id}`} className={campagne===c.id?'selected':''}>{c.name}</Link>)}</nav>
    <Suspense fallback={<SectionLoadingSkeleton/>}><TodayContent active={active} settings={settings} campaigns={campaigns} currentDay={currentDay}/></Suspense>
  </>;
}

async function TodayContent({active,settings,campaigns,currentDay}:{active:Campaign[];settings:Campaign;campaigns:Campaign[];currentDay:string}) {
  const repo=await getCampaignRepository();
  const [companiesByCampaign,learning]=await Promise.all([repo.listCompaniesByCampaign(active.map(c=>c.id)),repo.getLearningProgress()]);
  const all=active.flatMap(c=>companiesByCampaign[c.id]||[]);
  const eligible=all.filter(isEligible);
  const campaignSettings=(c:Company)=>campaigns.find(x=>x.id===c.campaignId)||settings;
  const evaluations=new Map(all.map(c=>[`${c.campaignId}:${c.id}`,evaluateQualification(c,campaignSettings(c),currentDay)]));
  const byPriority=(a:Company,b:Company)=>(evaluations.get(`${b.campaignId}:${b.id}`)!.score??-1)-(evaluations.get(`${a.campaignId}:${a.id}`)!.score??-1)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
  const byDate=(a:Company,b:Company)=>(a.nextAction?.date||'9999').localeCompare(b.nextAction?.date||'9999')||a.name.localeCompare(b.name,'fr');
  const late=eligible.filter(c=>c.nextAction&&dueStatus(c.nextAction.date,currentDay)==='late').sort(byDate);
  const today=eligible.filter(c=>c.nextAction&&dueStatus(c.nextAction.date,currentDay)==='today').sort(byDate);
  const reportGroups=await Promise.all(active.map(c=>repo.getCompanyReports(c.id,(companiesByCampaign[c.id]||[]).map(company=>company.id))));
  const reports=new Map<string,Awaited<ReturnType<typeof repo.getCompanyReport>>>();
  active.forEach((campaign,index)=>reportGroups[index].forEach((report,id)=>reports.set(campaign.id+':'+id,report)));
  const readiness=new Map(all.map(c=>[c.campaignId+':'+c.id,evaluateContactReadiness(c,campaignSettings(c),reports.get(c.campaignId+':'+c.id)||null,currentDay)] as const));
  const good=eligible.filter(c=>readiness.get(c.campaignId+':'+c.id)?.ready&&readiness.get(c.campaignId+':'+c.id)?.firstContact&&(!c.nextAction||!c.nextAction.date)).sort(byPriority);
  const preparing=eligible.filter(c=>!readiness.get(c.campaignId+':'+c.id)?.ready&&(!c.nextAction||!c.nextAction.date)&&['À étudier','À contacter'].includes(c.stage));
  const runsByCampaign=await repo.listRunsByCampaign(active.map(c=>c.id));
  const reviewRuns=active.flatMap(c=>runsByCampaign[c.id]||[]);
  const countsByRun=await repo.countReviewCandidatesByRun(reviewRuns.map(run=>run.id));
  const reviewCounts=reviewRuns.map(run=>({run,count:countsByRun[run.id]||0}));
  const due=late[0]||today[0],ready=good[0],review=reviewCounts.find(item=>item.count>0),toPrepare=preparing[0];
  const nextStep=due?{title:due.nextAction!.text,context:`${due.name} · action ${late.includes(due)?'en retard':'prévue aujourd’hui'}. Relisez le contexte avant de la réaliser.`,href:`/campagnes/${due.campaignId}?etape=suivre&prospect=${due.id}`,label:'Reprendre cette action'}
    :ready?{title:'Relire une approche avant de contacter.',context:`${ready.name} · la cible, le motif et le canal sont confirmés. Le contact reste manuel.`,href:`/campagnes/${ready.campaignId}?etape=preparer&prospect=${ready.id}`,label:'Relire mon approche'}
    :review?{title:`${UI_LABELS.steps.qualify} mon prochain lot.`,context:`${review.count} ${review.count>1?UI_LABELS.entities.companies.toLocaleLowerCase('fr'):UI_LABELS.entities.company.toLocaleLowerCase('fr')} à qualifier dans ${review.run.target.name}. Commencez par un ${UI_LABELS.evidence.finding.toLocaleLowerCase('fr')} précis et sa ${UI_LABELS.evidence.proof.toLocaleLowerCase('fr')}.`,href:`/campagnes/${review.run.campaignId}/qualification`,label:`${UI_LABELS.steps.qualify} les ${UI_LABELS.entities.companies.toLocaleLowerCase('fr')}`}
    :toPrepare?{title:'Préparer une approche documentée.',context:`${toPrepare.name} · vérifiez le motif et le contact professionnel avant de préparer un message.`,href:`/campagnes/${toPrepare.campaignId}?etape=preparer&prospect=${toPrepare.id}`,label:'Préparer mon approche'}
    :{title:'Trouver une prochaine bonne piste.',context:`Votre cible : ${settings.targetBusiness||'à préciser'}${settings.targetCity?` · ${settings.targetCity}`:''}. Lancez une recherche à votre rythme.`,href:`/campagnes/${settings.id}?etape=rechercher`,label:'Ouvrir ma campagne'};
  const program=[
    ...late.map(company=>({company,category:'En retard'})),
    ...today.map(company=>({company,category:'Aujourd’hui'})),
    ...good.map(company=>({company,category:'Prêts à contacter'})),
  ];
  const reviewTotal=reviewCounts.reduce((sum,item)=>sum+item.count,0);
  const preparationTotal=preparing.length;
  const hasPreparation=reviewTotal>0||preparationTotal>0;
  const preparationHref=review?`/campagnes/lots/${review.run.id}`:toPrepare?`/campagnes/${toPrepare.campaignId}?etape=preparer&prospect=${toPrepare.id}`:`/campagnes/${settings.id}`;
  const preparationLabel=[reviewTotal?`${reviewTotal} à qualifier`:'',preparationTotal?`${preparationTotal} à préparer`:''].filter(Boolean).join(' · ');
  return <div className="today-layout"><div className="today-main">
    <BackgroundGradient containerClassName="rounded-3xl" className="rounded-[20px] bg-[var(--surface)]"><section className="today-next-action" aria-label="Votre prochaine action"><span className="eyebrow">VOTRE PROCHAINE ACTION</span><h2>{nextStep.title}</h2><p>{nextStep.context}</p><Link href={nextStep.href} className="button primary">{nextStep.label}<ArrowRight size={18} aria-hidden="true"/></Link></section></BackgroundGradient>
    {hasPreparation&&<div className="today-preparation-reminder"><span><strong>À qualifier et préparer</strong> · {preparationLabel}</span><Link href={preparationHref}>Voir<ArrowRight size={14} aria-hidden="true"/></Link></div>}
    <section className="panel today-section today-program" aria-labelledby="today-program-title"><div className="today-section-heading"><h2 id="today-program-title">Actions prioritaires</h2><span className="count">{program.length}</span></div>{program.length?<ol className="today-program-list">{program.map(({company,category})=><TodayRow key={`${company.campaignId}:${company.id}`} company={company} settings={campaignSettings(company)} today={currentDay} contactDecision={readiness.get(company.campaignId+':'+company.id)?.decision} category={category}/>)}</ol>:<div className="today-clear-empty"><h2>Aucune action prioritaire aujourd’hui</h2><p>Lancez une recherche ou ajoutez un prospect pour préparer la suite.</p><Link className="button primary" href={`/campagnes/${settings.id}?etape=rechercher`}>Rechercher des {UI_LABELS.entities.companies.toLocaleLowerCase('fr')}<ArrowRight size={17} aria-hidden="true"/></Link></div>}</section>
    <LearningTodayCard progress={learning}/>
  </div></div>;
}
