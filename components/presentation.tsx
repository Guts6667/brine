import Link from 'next/link';
import { ArrowUpRight, CalendarDays, CircleCheck, CircleHelp, Sprout } from 'lucide-react';
import type { Company, Settings } from '@/lib/types';
import { dueStatus, formatDate } from '@/lib/domain';
import { evaluateQualification } from '@/lib/qualification';
import { CampaignProvider } from './campaign-context';
import { ActionButtons, PlanAction } from './forms';
export function QualificationBadge({company,settings,today,contactDecision}:{company:Company;settings:Settings;today:string;contactDecision?:string}) {
  const q=evaluateQualification(company,settings,today);
  if(company.readiness&&contactDecision)return <span className={'badge '+(contactDecision==='Prêt à contacter'?'badge-good':'')}>{contactDecision}</span>;
  return <span className={`badge ${q.decision==='Prêt à contacter'?'badge-good':''} ${q.decision==='Ne plus contacter'?'badge-blocked':''}`}>{q.decision==='Prêt à contacter'?<CircleCheck size={13}/>:q.decision==='À vérifier'?<CircleHelp size={13}/>:null}{q.decision}</span>;
}
export function ActionDate({date}:{date:string}) {
  const status=dueStatus(date);
  return <span className={`date-label ${status==='late'?'late':''}`}><CalendarDays size={13}/>{status==='unplanned'?'À planifier':status==='today'?'Aujourd’hui':status==='late'?`En retard · ${formatDate(date)}`:`À venir · ${formatDate(date)}`}</span>;
}
export function TodayRow({company:c,settings,today,contactDecision}:{company:Company;settings:Settings;today:string;contactDecision?:string}) {
  const q=evaluateQualification(c,settings,today);
  return <CampaignProvider id={c.campaignId||'initial'} revision={c.participationRevision}><article className="today-row"><div className="company-monogram" aria-hidden="true">{c.name.slice(0,2).toUpperCase()}</div><div className="today-company"><Link href={`/prospects/${c.id}${c.campaignId?`?campagne=${c.campaignId}`:''}`} className="company-name">{c.name}</Link><p className="small muted">{c.campaignName}</p><p>{c.plan?.motive||q.reasons.slice(0,3).join(' · ')||q.nextInformation}</p><span className="small muted">{c.readiness&&contactDecision?contactDecision:q.score!==null?`${q.score}/100 · ${q.priority}`:q.evaluated?`${q.confirmedPoints} points confirmés · ${q.completedCount}/5 critères`:'Non évalué'} · {[c.city,c.business].filter(Boolean).join(' · ')||'Informations à compléter'}</span></div><div className="today-action">{c.nextAction?<><strong>{c.nextAction.text}</strong><ActionDate date={c.nextAction.date}/></>:<><span className="small muted">Pas encore d’action planifiée</span><PlanAction company={c} compact/></>}</div><div className="today-row-controls"><Link href={`/prospects/${c.id}${c.campaignId?`?campagne=${c.campaignId}`:''}`} className="open-link">Ouvrir la fiche<ArrowUpRight size={14}/></Link>{c.nextAction&&<ActionButtons company={c}/>}</div></article></CampaignProvider>;
}
export function EmptyIcon() {return <div className="empty-icon"><Sprout size={34} strokeWidth={1.4}/></div>;}
