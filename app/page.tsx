import { requireAuthenticated } from '@/lib/auth';
import Link from 'next/link';
import { ArrowRight, CalendarClock, CircleCheck, Clock3, Sprout, MapPin, Pencil, Coffee } from 'lucide-react';
import { getStore } from '@/lib/db';
import { dueStatus, isEligible, parisToday, qualify } from '@/lib/domain';
import { AddCompany } from '@/components/forms';
import { TodayRow } from '@/components/presentation';
import type { Company } from '@/lib/types';
export default async function Today({searchParams}:{searchParams:Promise<{view?:string}>}) {
  await requireAuthenticated();
  const {view}=await searchParams, upcoming=view==='upcoming';
  const store=getStore(),[all,settings]=await Promise.all([store.listCompanies(),store.getSettings()]),eligible=all.filter(isEligible);
  const byDate=(a:Company,b:Company)=>(a.nextAction?.date||'9999').localeCompare(b.nextAction?.date||'9999')||a.name.localeCompare(b.name,'fr');
  const late=eligible.filter(c=>c.nextAction&&dueStatus(c.nextAction.date)==='late').sort(byDate);
  const today=eligible.filter(c=>c.nextAction&&dueStatus(c.nextAction.date)==='today').sort(byDate);
  const good=eligible.filter(c=>qualify(c).label==='Bonne piste'&&(!c.nextAction||!c.nextAction.date)).sort(byDate);
  const future=eligible.filter(c=>c.nextAction&&dueStatus(c.nextAction.date)==='upcoming').sort(byDate);
  const unplanned=eligible.filter(c=>c.nextAction&&!c.nextAction.date&&qualify(c).label!=='Bonne piste').sort(byDate);
  const date=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Paris'}).format(new Date(`${parisToday()}T12:00:00Z`));
  const groups=upcoming?[{title:'Actions à venir',icon:<CalendarClock size={18}/>,list:future,empty:'Aucune action à venir. Une date peut être ajoutée depuis chaque fiche.'},{title:'Actions à planifier',icon:<Clock3 size={18}/>,list:unplanned,empty:'Toutes vos actions ont une date, ou vous n’en avez pas encore.'}]:[
    {title:'En retard',icon:<Clock3 size={18}/>,list:late,empty:'Aucune action en retard. Vous pouvez avancer sereinement.'},
    {title:'Aujourd’hui',icon:<CircleCheck size={18}/>,list:today,empty:'Votre journée est libre pour le moment.'},
    {title:'Bonnes pistes sans date planifiée',icon:<Sprout size={18}/>,list:good,empty:'Les entreprises qualifiées sans échéance apparaîtront ici.'}
  ];
  return <><div className="page-heading"><div><p className="eyebrow">{date}</p><h1>{upcoming?'La suite se prépare.':'Aujourd’hui'}</h1><p className="page-subtitle">{upcoming?'Un peu d’avance pour vos prochaines conversations.':'Les bonnes conversations commencent par une petite action.'}</p></div><AddCompany settings={settings}/></div>
    <div className="today-layout"><div className="today-main">
      {!all.length&&!upcoming&&<section className="welcome-card"><div><span className="eyebrow">BIENVENUE DANS VOTRE ESPACE</span><h2>Votre première bonne piste<br/><em>commence ici.</em></h2><p>Ajoutez une entreprise, notez ce qui mérite une conversation,<br className="desktop-only"/> puis choisissez votre prochaine action.</p><Link href="/prospects" className="button primary">Découvrir mes prospects<ArrowRight size={16}/></Link></div><span className="welcome-doodle" aria-hidden="true"/></section>}
      <div className="list-caption"><span>{upcoming?'À votre rythme':'Votre programme'}</span><Link href={upcoming?'/':'/?view=upcoming'}>{upcoming?'Revenir à aujourd’hui':'Voir les actions à venir'}<ArrowRight size={14}/></Link></div>
      {groups.map(g=><section key={g.title} className="panel today-section"><div className="today-section-heading"><h2>{g.icon}{g.title}</h2><span className="count">{g.list.length}</span></div>{g.list.length?g.list.map(c=><TodayRow key={c.id} company={c}/>):<p className="section-empty">{g.empty}</p>}</section>)}
      {!upcoming&&unplanned.length>0&&<p className="muted small"><Link href="/?view=upcoming">{unplanned.length} autre(s) action(s) à planifier</Link></p>}
    </div><aside className="today-aside"><section className="target-card"><div className="aside-label"><span>VOTRE CIBLE DU MOMENT</span><MapPin size={16}/></div><h2>{settings.targetBusiness||'À définir'}</h2><p>{settings.targetCity||'Zone à définir'}</p><span className="target-rule"/><p className="small muted">Un point de départ, à ajuster au fil de vos découvertes.</p><Link href="/sauvegarde#cible" className="open-link"><Pencil size={13}/>Modifier ma cible</Link></section><section className="gentle-guide"><Sprout size={21}/><h3>Une bonne piste, c’est…</h3><ul><li>Une entreprise dans votre cible</li><li>Un problème concret à améliorer</li><li>Un contact professionnel</li></ul><p>Pas de score. Juste de bonnes raisons de commencer une conversation.</p></section><div className="slow-note"><Coffee size={17}/><span>La régularité compte<br/>plus que la quantité.</span></div></aside></div>
  </>;
}
