import Link from 'next/link';
import { ArrowUpRight, CalendarDays, CircleCheck, CircleHelp, Sprout } from 'lucide-react';
import type { Company } from '@/lib/types';
import { dueStatus, formatDate, qualify } from '@/lib/domain';
import { ActionButtons, PlanAction } from './forms';
export function QualificationBadge({company}:{company:Company}) {
  const q=qualify(company);
  return <span className={`badge ${q.label==='Bonne piste'?'badge-good':''} ${q.label==='Ne plus contacter'?'badge-blocked':''}`}>{q.label==='Bonne piste'?<CircleCheck size={13}/>:q.label==='À vérifier'?<CircleHelp size={13}/>:null}{q.label}</span>;
}
export function ActionDate({date}:{date:string}) {
  const status=dueStatus(date);
  return <span className={`date-label ${status==='late'?'late':''}`}><CalendarDays size={13}/>{status==='unplanned'?'À planifier':status==='today'?'Aujourd’hui':status==='late'?`En retard · ${formatDate(date)}`:`À venir · ${formatDate(date)}`}</span>;
}
export function TodayRow({company:c}:{company:Company}) {
  return <article className="today-row"><div className="company-monogram" aria-hidden="true">{c.name.slice(0,2).toUpperCase()}</div><div className="today-company"><Link href={`/prospects/${c.id}`} className="company-name">{c.name}</Link><p>{c.observation||qualify(c).explanation}</p><span className="small muted">{[c.city,c.business].filter(Boolean).join(' · ')||'Informations à compléter'}</span></div><div className="today-action">{c.nextAction?<><strong>{c.nextAction.text}</strong><ActionDate date={c.nextAction.date}/></>:<><span className="small muted">Pas encore d’action planifiée</span><PlanAction company={c} compact/></>}</div><div className="today-row-controls"><Link href={`/prospects/${c.id}`} className="open-link">Ouvrir la fiche<ArrowUpRight size={14}/></Link>{c.nextAction&&<ActionButtons company={c}/>}</div></article>;
}
export function EmptyIcon() {return <div className="empty-icon"><Sprout size={34} strokeWidth={1.4}/></div>;}
