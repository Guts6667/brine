import { requireAuthenticated } from '@/lib/auth';
import Link from 'next/link';
import { ArrowRight, CalendarClock, CircleCheck, Clock3, Sprout, MapPin, Pencil, Coffee } from 'lucide-react';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { CampaignProvider } from '@/components/campaign-context';
import { dueStatus, isEligible, parisToday } from '@/lib/domain';
import { evaluateQualification } from '@/lib/qualification';
import { evaluateContactReadiness } from '@/lib/contact-preparation';
import { AddCompany } from '@/components/forms';
import { TodayRow } from '@/components/presentation';
import type { Company } from '@/lib/types';
import { LearningTodayCard } from '@/components/learning-today-card';
export default async function Today({searchParams}:{searchParams:Promise<{view?:string;campagne?:string}>}) {
  await requireAuthenticated();
  const {view,campagne}=await searchParams, upcoming=view==='upcoming';
  const repo=await getCampaignRepository(),[campaigns,learning]=await Promise.all([repo.listCampaigns(),repo.getLearningProgress()]);
  const active=campaigns.filter(c=>c.status==='active'&&(!campagne||c.id===campagne));
  const all=(await Promise.all(active.map(c=>repo.listCompanies(c.id)))).flat(),settings=campaigns.find(c=>c.id===campagne)||campaigns[0],eligible=all.filter(isEligible);
  const campaignSettings=(c:Company)=>campaigns.find(x=>x.id===c.campaignId)||settings;
  const currentDay=parisToday();
  const evaluations=new Map(all.map(c=>[`${c.campaignId}:${c.id}`,evaluateQualification(c,campaignSettings(c),currentDay)]));
  const byPriority=(a:Company,b:Company)=>(evaluations.get(`${b.campaignId}:${b.id}`)!.score??-1)-(evaluations.get(`${a.campaignId}:${a.id}`)!.score??-1)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
  const byDate=(a:Company,b:Company)=>(a.nextAction?.date||'9999').localeCompare(b.nextAction?.date||'9999')||a.name.localeCompare(b.name,'fr');
  const late=eligible.filter(c=>c.nextAction&&dueStatus(c.nextAction.date,currentDay)==='late').sort(byDate);
  const today=eligible.filter(c=>c.nextAction&&dueStatus(c.nextAction.date,currentDay)==='today').sort(byDate);
  const readiness=new Map(await Promise.all(all.map(async c=>[c.campaignId+':'+c.id,evaluateContactReadiness(c,campaignSettings(c),await repo.getCompanyReport(c.campaignId!,c.id),currentDay)] as const)));
  const good=eligible.filter(c=>readiness.get(c.campaignId+':'+c.id)?.ready&&readiness.get(c.campaignId+':'+c.id)?.firstContact&&(!c.nextAction||!c.nextAction.date)).sort(byPriority);
  const preparing=eligible.filter(c=>!readiness.get(c.campaignId+':'+c.id)?.ready&&(!c.nextAction||!c.nextAction.date)&&['À étudier','À contacter'].includes(c.stage));
  const reviewRuns=(await Promise.all(active.map(c=>repo.listRuns(c.id)))).flat();
  const reviewCounts=await Promise.all(reviewRuns.map(async r=>({run:r,count:(await repo.listCandidates(r.id)).filter(c=>['review','needs_site','verify'].includes(c.status)).length})));
  const future=eligible.filter(c=>c.nextAction&&dueStatus(c.nextAction.date,currentDay)==='upcoming').sort(byDate);
  const unplanned=eligible.filter(c=>c.nextAction&&!c.nextAction.date&&!(readiness.get(c.campaignId+':'+c.id)?.ready&&readiness.get(c.campaignId+':'+c.id)?.firstContact)).sort(byDate);
  const due=late[0]||today[0],ready=good[0],review=reviewCounts.find(item=>item.count>0),toPrepare=preparing[0];
  const nextStep=due?{title:due.nextAction!.text,context:`${due.name} · action ${late.includes(due)?'en retard':'prévue aujourd’hui'}. Relisez le contexte avant de la réaliser.`,href:`/campagnes/${due.campaignId}?etape=suivre&prospect=${due.id}`,label:'Reprendre cette action'}
    :ready?{title:'Relire une approche avant de contacter.',context:`${ready.name} · la cible, le motif et le canal sont confirmés. Le contact reste manuel.`,href:`/campagnes/${ready.campaignId}?etape=preparer&prospect=${ready.id}`,label:'Relire mon approche'}
    :review?{title:'Examiner mon prochain lot.',context:`${review.count} résultat(s) à examiner dans ${review.run.target.name}. Commencez par un constat précis et sa preuve.`,href:`/campagnes/${review.run.campaignId}/qualification`,label:'Examiner les entreprises'}
    :toPrepare?{title:'Préparer une approche documentée.',context:`${toPrepare.name} · vérifiez le motif et le contact professionnel avant de préparer un message.`,href:`/campagnes/${toPrepare.campaignId}?etape=preparer&prospect=${toPrepare.id}`,label:'Préparer mon approche'}
    :{title:'Trouver une prochaine bonne piste.',context:`Votre cible : ${settings.targetBusiness||'à préciser'}${settings.targetCity?` · ${settings.targetCity}`:''}. Lancez une recherche à votre rythme.`,href:`/campagnes/${settings.id}?etape=rechercher`,label:'Ouvrir ma campagne'};
  const date=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Paris'}).format(new Date(`${currentDay}T12:00:00Z`));
  const groups=upcoming?[{title:'Actions à venir',icon:<CalendarClock size={18}/>,list:future,empty:'Aucune action à venir. Une date peut être ajoutée depuis chaque fiche.'},{title:'Actions à planifier',icon:<Clock3 size={18}/>,list:unplanned,empty:'Toutes vos actions ont une date, ou vous n’en avez pas encore.'}]:[
    {title:'En retard',icon:<Clock3 size={18}/>,list:late,empty:'Aucune action en retard. Vous pouvez avancer sereinement.'},
    {title:'Aujourd’hui',icon:<CircleCheck size={18}/>,list:today,empty:'Votre journée est libre pour le moment.'},
    {title:'Prêts à contacter sans date planifiée',icon:<Sprout size={18}/>,list:good,empty:'Les prospects prêts pour un premier contact apparaîtront ici, par priorité.'}
  ];
  const hasPreparation=preparing.length>0||reviewCounts.some(item=>item.count>0),emptyGroups=groups.filter(group=>!group.list.length);
  return <><div className="page-heading today-heading"><div><p className="eyebrow">{date}</p><h1 className="editorial-title">{upcoming?'La suite se prépare.':<>Aujourd’hui,<br/><em>un pas à la fois.</em></>}</h1><p className="page-subtitle">{upcoming?'Un peu d’avance pour vos prochaines conversations.':'Les bonnes conversations commencent par une petite action.'}</p></div><div className="button-row"><Link href="/campagnes" className="button secondary">Mes campagnes</Link><CampaignProvider id={settings.id}><AddCompany settings={settings}/></CampaignProvider></div></div>
    <nav className="filter-tabs" aria-label="Filtrer les campagnes"><Link href="/" className={!campagne?'selected':''}>Toutes les campagnes</Link>{campaigns.filter(c=>c.status==='active').map(c=><Link key={c.id} href={`/?campagne=${c.id}${upcoming?'&view=upcoming':''}`} className={campagne===c.id?'selected':''}>{c.name}</Link>)}</nav><div className="today-layout"><div className="today-main">
      {!upcoming&&<section className="today-next-action" aria-label="Votre prochaine action"><span className="eyebrow">VOTRE PROCHAINE ACTION</span><h2>{nextStep.title}</h2><p>{nextStep.context}</p><Link href={nextStep.href} className="button primary">{nextStep.label}<ArrowRight size={18} aria-hidden="true"/></Link></section>}
      <div className="list-caption"><span>{upcoming?'À votre rythme':'Votre programme'}</span><Link href={upcoming?'/':'/?view=upcoming'}>{upcoming?'Revenir à aujourd’hui':'Voir les actions à venir'}<ArrowRight size={14}/></Link></div>
      {!upcoming&&hasPreparation&&<section className="panel today-section"><div className="today-section-heading"><h2><Sprout size={18}/>À examiner et préparer</h2><span className="count">{preparing.length+reviewCounts.reduce((sum,r)=>sum+r.count,0)}</span></div>{reviewCounts.filter(r=>r.count>0).map(({run,count})=><div className="preparation-waiting" key={run.id}><div><strong>{run.target.name}</strong><span className="small muted">{count} résultat(s) à examiner</span></div><Link href={'/campagnes/lots/'+run.id}>Examiner →</Link></div>)}{preparing.map(c=><div className="preparation-waiting" key={c.campaignId+':'+c.id}><div><strong>{c.name}</strong><span className="small muted">{c.campaignName} · {readiness.get(c.campaignId+':'+c.id)?.stale?'Préparation à revalider':'Motif et contact à préparer'}</span></div><Link href={'/campagnes/'+c.campaignId+'?etape=preparer&prospect='+c.id}>Préparer →</Link></div>)}</section>}
      {groups.filter(g=>g.list.length>0).map(g=><section key={g.title} className="panel today-section"><div className="today-section-heading"><h2>{g.icon}{g.title}</h2><span className="count">{g.list.length}</span></div>{g.list.map(c=><TodayRow key={`${c.campaignId}:${c.id}`} company={c} settings={campaignSettings(c)} today={currentDay} contactDecision={readiness.get(c.campaignId+':'+c.id)?.decision}/>)}</section>)}
      {upcoming&&emptyGroups.length===groups.length&&<p className="section-empty">Aucune action datée dans cette vue pour le moment.</p>}
      {(emptyGroups.length>0||(!upcoming&&!hasPreparation))&&<details className="today-empty-groups"><summary>Voir les rubriques sans action</summary>{!upcoming&&!hasPreparation&&<div><strong>À examiner et préparer</strong><p>Vos nouvelles pistes apparaîtront ici après la recherche.</p></div>}{emptyGroups.map(g=><div key={g.title}><strong>{g.title}</strong><p>{g.empty}</p></div>)}</details>}
      {!upcoming&&unplanned.length>0&&<p className="muted small"><Link href="/?view=upcoming">{unplanned.length} autre(s) action(s) à planifier</Link></p>}
      {!upcoming&&<LearningTodayCard progress={learning}/>}
    </div><aside className="today-aside"><section className="target-card"><div className="aside-label"><span>VOTRE CAMPAGNE</span><MapPin size={16}/></div><h2>{settings.targetBusiness||'À définir'}</h2><p>{settings.targetCity||'Zone à définir'}</p><span className="target-rule"/><p className="small muted">Un point de départ, à ajuster au fil de vos découvertes.</p><Link href={`/campagnes/${settings.id}`} className="open-link"><Pencil size={13}/>Modifier ma cible</Link></section><section className="gentle-guide"><Sprout size={21}/><h3>Une bonne piste, c’est…</h3><ul><li>Une entreprise dans votre cible</li><li>Un motif documenté lié à votre offre</li><li>Un contact professionnel</li></ul><p>Confirmez la cible, le motif documenté et le contact professionnel. La qualification détaillée aide ensuite à approfondir.</p></section><div className="slow-note"><Coffee size={17}/><span>La régularité compte<br/>plus que la quantité.</span></div></aside></div>
  </>;
}
