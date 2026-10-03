import { requireAuthenticated } from '@/lib/auth';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, ChevronDown, MessageSquare, StickyNote, Check, CalendarDays, FlaskConical } from 'lucide-react';
import { getStore } from '@/lib/db';
import { qualify, formatDate, aiResults } from '@/lib/domain';
import { CompanyForm, PlanAction, ActionButtons, AddActivity, AddAiTest, CompanyControls } from '@/components/forms';
import { QualificationBadge, ActionDate } from '@/components/presentation';
export default async function CompanyPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{created?:string;done?:string}>}) {
  await requireAuthenticated();
  const {id}=await params, {created,done}=await searchParams,store=getStore(),c=await store.getCompany(id);
  if(!c)notFound();
  const q=qualify(c),[activities,tests]=await Promise.all([store.listActivities(id),store.listAiTests(id)]);
  return <><Link href="/prospects" className="back-link"><ArrowLeft size={16}/>Tous les prospects</Link>
    <div className="page-heading detail-heading"><div><p className="eyebrow">{[c.city,c.business].filter(Boolean).join(' · ')||'FICHE ENTREPRISE'}</p><h1>{c.name}</h1><div className="detail-heading-meta"><QualificationBadge company={c}/><span className="stage-label">{c.stage}</span>{c.archived&&<span className="badge">Archivée</span>}{c.website&&<a href={c.website} target="_blank" rel="noopener noreferrer" className="open-link">Voir le site<ArrowUpRight size={14}/></a>}</div></div><PlanAction company={c}/></div>
    {created&&<p className="form-success" role="status"><Check size={16}/>Entreprise créée. Commencez par ce que vous savez, le reste peut attendre.</p>}
    {done&&<p className="form-success" role="status"><Check size={16}/>Action terminée et ajoutée à l’historique. Vous pouvez prévoir la suite quand vous le souhaitez.</p>}
    <section className="qualification-summary"><div><span className="eyebrow">{q.label}</span><p>{q.explanation}</p></div><div className="summary-action"><span className="eyebrow">PROCHAINE ACTION</span>{c.nextAction?<><strong>{c.nextAction.text}</strong><ActionDate date={c.nextAction.date}/><ActionButtons company={c}/></>:<p>{c.oppositionActive?'Relances bloquées par l’opposition.':'À planifier — choisissez une petite action utile.'}</p>}</div></section>
    <div className="detail-body"><CompanyForm company={c}/>
      <section className="panel section-panel" aria-labelledby="notes-heading"><div className="section-title"><span className="section-number">03</span><div><h2 id="notes-heading">Notes et échanges</h2><p className="muted">Le fil de vos observations et conversations.</p></div></div><AddActivity id={id}/>
        {activities.length?<ol className="timeline">{activities.map(a=><li key={a.id}><span className="timeline-icon">{a.kind==='note'?<StickyNote size={15}/>:a.kind==='exchange'?<MessageSquare size={15}/>:a.kind==='action_done'?<Check size={15}/>:<CalendarDays size={15}/>}</span><div><div className="timeline-meta"><strong>{a.kind==='note'?'Note':a.kind==='exchange'?a.type||'Échange':a.kind==='action_done'?'Action terminée':a.kind==='action_rescheduled'?'Action reportée':'Suivi de la fiche'}</strong><span>{a.date?formatDate(a.date):'Date non renseignée'}</span></div><p className="plain-text">{a.text}</p></div></li>)}</ol>:<p className="inline-empty">Votre historique commence ici. Une note ou un échange suffit.</p>}
      </section>
      <details className="panel tests-panel"><summary><div className="section-title"><span className="section-number">04</span><div><h2>Tests IA <span className="optional-label">FACULTATIF</span></h2><p className="muted">Des observations manuelles, séparées du suivi commercial.</p></div></div><ChevronDown size={18}/></summary><div className="details-body"><p className="field-help">Chaque relevé décrit son propre panel, sa période et son interface. Une observation API ne représente pas un test de l’application ChatGPT. Les résultats ne sont pas additionnés.</p><AddAiTest id={id}/>{!tests.length?<div className="inline-empty"><FlaskConical size={18}/><span>Non mesuré. Aucun relevé enregistré.</span></div>:tests.map(t=>{const result=aiResults(t);return <article key={t.id} className="ai-record"><div className="ai-record-heading"><h3>{t.panel||'Panel non renseigné'}</h3><span className="small muted">{t.period||'Période non renseignée'}</span></div><p className="small muted">{t.tool||'Outil non renseigné'} · {t.interface||'Interface non renseignée'} · {t.mode==='api'?'API':t.mode==='web'?'Application avec recherche web':'Mode non renseigné'}{t.model?` · ${t.model}`:''}</p><div className="ai-results"><p>{result.recommendations}</p><p>{result.citations}</p></div><details className="inline-details"><summary>Détails et preuves<ChevronDown size={14}/></summary><div className="details-body"><p className="plain-text small">Questions : {t.questions||'Non renseigné'}</p><p className="plain-text small">{t.notes||'Notes : Non renseigné'}</p>{t.proofUrl&&<a href={t.proofUrl} target="_blank" rel="noopener noreferrer" className="open-link">Consulter la preuve<ArrowUpRight size={14}/></a>}</div></details></article>;})}</div></details>
      <CompanyControls company={c}/>
    </div>
  </>;
}
