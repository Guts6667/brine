import { evaluateContactReadiness } from '@/lib/contact-preparation';
import { ProspectWork } from '@/components/prospect-work';
import { WorkflowSteps } from '@/components/workflow-steps';
import { requireAuthenticated } from '@/lib/auth';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, ChevronDown, MessageSquare, StickyNote, Check, CalendarDays, FlaskConical } from 'lucide-react';
import { getStore } from '@/lib/db';
import { getCampaignRepository, getCampaignContext } from '@/lib/campaign-runtime';
import { CampaignProvider } from '@/components/campaign-context';
import { CampaignMutation, CopyText } from '@/components/campaign-forms';
import { saveApproachAction } from '@/app/campaign-actions';
import { parisToday, formatDate, aiResults } from '@/lib/domain';
import { CompanyForm, PlanAction, ActionButtons, AddActivity, AddAiTest, CompanyControls } from '@/components/forms';
import { QualificationForm, ObservationsForm, AfterExchangeForm } from '@/components/qualification-form';
import { QualificationSummary } from '@/components/qualification-summary';
import { QualificationBadge, ActionDate } from '@/components/presentation';
import { SiteAnalysisPanel } from '@/components/site-analysis';
import { AiResearchPrompts } from '@/components/ai-research-prompts';
import { aiApproach } from '@/lib/approach';
export default async function CompanyPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{created?:string;done?:string;campagne?:string}>}) {
  await requireAuthenticated();
  const {id}=await params, {created,done,campagne}=await searchParams,repo=await getCampaignRepository();
  const campaigns=await repo.listCampaigns(),members=await repo.memberships(id);
  if(!campagne&&members.length!==1){const shared=await getStore().getCompany(id);if(!shared)notFound();return <><Link href="/prospects" className="back-link">← Entreprises</Link><div className="page-heading"><div><h1>{shared.name}</h1><p className="page-subtitle">{shared.city} · {shared.business}</p></div></div><section className="panel section-panel"><h2>Choisir le suivi de campagne</h2><p>Les contacts et les faits sont communs. Chaque campagne possède sa qualification et ses actions.</p><div className="stack">{members.map(p=><Link key={p.campaignId} className="campaign-run-link" href={`/prospects/${id}?campagne=${p.campaignId}`}><strong>{campaigns.find(c=>c.id===p.campaignId)?.name}</strong><span>{p.stage} · {p.nextAction?.text||'À planifier'}</span></Link>)}</div>{!members.length&&<Link href="/campagnes" className="button secondary">Rattacher depuis une campagne</Link>}<p className="small muted">Contact commun : {shared.contact.email||shared.contact.phone||'À compléter'}</p></section></>;}
  const campaignId=campagne||members[0].campaignId;
  const store=await getCampaignContext(campaignId),c=await store.getCompany(id);
  if(!c)notFound();
  const today=parisToday(),[activities,tests,settings,findings]=await Promise.all([store.listActivities(id),store.listAiTests(id),store.getSettings(),repo.retainedFindings(campaignId,id)]);
  const contactReadiness=evaluateContactReadiness(c,settings,await repo.getCompanyReport(campaignId,id),today);
  return <CampaignProvider id={campaignId} revision={c.participationRevision}><Link href={`/prospects?campagne=${campaignId}`} className="back-link"><ArrowLeft size={16}/>Tous les prospects</Link>
    <div className="campaign-context-banner"><strong>Suivi : {c.campaignName}</strong><Link href={`/campagnes/${campaignId}`}>Ouvrir la campagne ↗</Link>{members.filter(p=>p.campaignId!==campaignId).map(p=><Link key={p.campaignId} href={`/prospects/${id}?campagne=${p.campaignId}`}>{campaigns.find(c=>c.id===p.campaignId)?.name} · {p.stage}{p.nextAction?` · ${p.nextAction.text}`:''}</Link>)}</div>
    <div className="page-heading detail-heading"><div><p className="eyebrow">{[c.city,c.business].filter(Boolean).join(' · ')||'FICHE ENTREPRISE'}</p><h1>{c.name}</h1><div className="detail-heading-meta"><QualificationBadge company={c} settings={settings} today={today} contactDecision={contactReadiness.decision}/><span className="stage-label">{c.stage}</span>{c.archived&&<span className="badge">Archivée</span>}{c.website&&<a href={c.website} target="_blank" rel="noopener noreferrer" className="open-link">Voir le site<ArrowUpRight size={14}/></a>}</div></div><PlanAction company={c}/></div>
    {created&&<p className="form-success" role="status"><Check size={16}/>Entreprise créée. Commencez par ce que vous savez, le reste peut attendre.</p>}
    {done&&<p className="form-success" role="status"><Check size={16}/>Action terminée et ajoutée à l’historique. Vous pouvez prévoir la suite quand vous le souhaitez.</p>}
    <WorkflowSteps campaignId={campaignId} active="preparer"/>
    <section className="panel section-panel"><ProspectWork company={c} campaign={settings}/></section>
    <details className="panel section-panel" open={!c.readiness&&!findings.length}><summary>Qualification détaillée et outils complémentaires</summary><div className="details-body"><QualificationSummary company={c} settings={settings} today={today}/>
    <div className="detail-body"><CompanyForm company={c}/><SiteAnalysisPanel key={c.website} company={c}/><ObservationsForm company={c} today={today}/><QualificationForm company={c} settings={settings} today={today} suggestedFinding={findings[0]}/><AfterExchangeForm company={c}/>
      <section className="panel section-panel" aria-labelledby="notes-heading"><div className="section-title"><span className="section-number">03</span><div><h2 id="notes-heading">Notes et échanges</h2><p className="muted">Le fil de vos observations et conversations.</p></div></div><AddActivity id={id}/>
        {activities.length?<ol className="timeline">{activities.map(a=><li key={a.id}><span className="timeline-icon">{a.kind==='note'?<StickyNote size={15}/>:a.kind==='exchange'?<MessageSquare size={15}/>:a.kind==='action_done'?<Check size={15}/>:<CalendarDays size={15}/>}</span><div><div className="timeline-meta"><strong>{a.kind==='note'?'Note':a.kind==='exchange'?a.type||'Échange':a.kind==='action_done'?'Action terminée':a.kind==='action_rescheduled'?'Action reportée':'Suivi de la fiche'}</strong><span className="small muted">{a.campaignId?campaigns.find(c=>c.id===a.campaignId)?.name:'Information commune'}</span><span>{a.date?formatDate(a.date):'Date non renseignée'}</span></div><p className="plain-text">{a.text}</p></div></li>)}</ol>:<p className="inline-empty">Votre historique commence ici. Une note ou un échange suffit.</p>}
      </section>
      <details className="panel tests-panel"><summary><div className="section-title"><span className="section-number">04</span><div><h2>Tests IA <span className="optional-label">FACULTATIF</span></h2><p className="muted">Des observations manuelles, séparées du suivi commercial.</p></div></div><ChevronDown size={18}/></summary><div className="details-body"><p className="field-help">Chaque relevé décrit son propre panel, sa période et son interface. Une observation API ne représente pas un test de l’application ChatGPT. Les résultats ne sont pas additionnés.</p><AiResearchPrompts company={c}/><AddAiTest id={id}/>{!tests.length?<div className="inline-empty"><FlaskConical size={18}/><span>Non mesuré. Aucun relevé enregistré.</span></div>:tests.map(t=>{const result=aiResults(t);return <article key={t.id} className="ai-record"><div className="ai-record-heading"><h3>{t.panel||'Panel non renseigné'}</h3><span className="small muted">{t.period||'Période non renseignée'}</span></div><p className="small muted">{t.tool||'Outil non renseigné'} · {t.interface||'Interface non renseignée'} · {t.mode==='api'?'API':t.mode==='web'?'Application avec recherche web':'Mode non renseigné'}{t.model?` · ${t.model}`:''}</p><div className="ai-results"><p>{result.recommendations}</p><p>{result.citations}</p></div>{aiApproach(c,t)&&<div className="audit-approach"><span className="eyebrow">ANGLE SUR CE PANEL</span><p>{aiApproach(c,t)}</p></div>}<details className="inline-details"><summary>Détails et preuves<ChevronDown size={14}/></summary><div className="details-body"><p className="plain-text small">Questions : {t.questions||'Non renseigné'}</p><p className="plain-text small">{t.notes||'Notes : Non renseigné'}</p>{t.proofUrl&&<a href={t.proofUrl} target="_blank" rel="noopener noreferrer" className="open-link">Consulter la preuve<ArrowUpRight size={14}/></a>}</div></details></article>;})}</div></details>
      <CompanyControls company={c}/>
    </div></div></details>
  </CampaignProvider>;
}
