import { requireAuthenticated } from '@/lib/auth';
import Link from 'next/link';
import { Search, ArrowUpRight, SlidersHorizontal } from 'lucide-react';
import { getStore } from '@/lib/db';
import { getCampaignContext, getCampaignRepository } from '@/lib/campaign-runtime';
import { CampaignProvider } from '@/components/campaign-context';
import { parisToday } from '@/lib/domain';
import { evaluateQualification, isFirstContactCandidate } from '@/lib/qualification';
import { AddCompany } from '@/components/forms';
import { ActionDate, EmptyIcon } from '@/components/presentation';
import { ScoreCell } from '@/components/qualification-summary';
export const metadata={title:'Prospects'};
export default async function Prospects({searchParams}:{searchParams:Promise<{q?:string;filter?:string;campagne?:string}>}) {
  await requireAuthenticated();
  const {q='',filter='all',campagne}=await searchParams,repo=await getCampaignRepository(),campaigns=await repo.listCampaigns();
  if(!campagne&&campaigns.length>1){const shared=await getStore().listCompanies();return <><div className="page-heading"><div><h1>Prospects</h1><p className="page-subtitle">Une fiche commune par entreprise. Choisissez une campagne pour son suivi.</p></div><Link href="/campagnes" className="button primary">Trouver des entreprises</Link></div><nav className="filter-tabs" aria-label="Campagnes">{campaigns.map(c=><Link key={c.id} href={`/prospects?campagne=${c.id}`}>{c.name}</Link>)}</nav><section className="panel section-panel">{shared.map(c=><Link className="campaign-run-link" key={c.id} href={`/prospects/${c.id}`}><strong>{c.name}</strong><span>{c.city} · {c.business}</span></Link>)}</section></>;}
  const campaignId=campagne||campaigns[0].id,store=await getCampaignContext(campaignId),[all,settings]=await Promise.all([store.listCompanies(),store.getSettings()]);
  const today=parisToday(),search=q.toLocaleLowerCase('fr');
  const evaluations=new Map(all.map(c=>[c.id,evaluateQualification(c,settings,today)]));
  const rows=all.filter(c=>{
    const evaluation=evaluations.get(c.id)!;
    const ready=isFirstContactCandidate(c,settings,today);
    const matches=filter==='archived'?c.archived:!c.archived&&(
      ['ready','good'].includes(filter)?ready:
      ['verify','check'].includes(filter)?!evaluation.complete||evaluation.targetNeedsRevalidation:
      filter==='high'?evaluation.priority==='Priorité haute':
      filter==='contact'?evaluation.decision==='Contact à trouver':
      filter==='outside'?evaluation.decision==='Hors cible':
      filter==='evaluated'?evaluation.complete:
      filter==='exchange'?c.stage==='En échange':
      filter==='qualified'?c.stage==='Opportunité qualifiée':
      filter==='opposed'?c.oppositionActive:
      filter==='won'?c.stage==='Gagné':filter==='lost'?c.stage==='Perdu':true);
    return matches&&[c.name,c.city,c.business,c.contact.name,c.contact.email,c.contact.phone,c.contact.role].join(' ').toLocaleLowerCase('fr').includes(search);
  });
  if(['ready','good'].includes(filter))rows.sort((a,b)=>(evaluations.get(b.id)!.score??-1)-(evaluations.get(a.id)!.score??-1)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const filters=[['all','Toutes'],['verify','À vérifier'],['ready','Prêts à contacter'],['high','Priorité haute'],['contact','Contact à trouver']];
  const otherFilters=[['outside','Hors cible'],['opposed','Ne plus contacter'],['evaluated','Score complet'],['exchange','En échange'],['qualified','Opportunités qualifiées'],['won','Gagnées'],['lost','Perdues'],['archived','Archivées']];
  return <CampaignProvider id={campaignId}><div className="page-heading"><div><p className="eyebrow">UNE CONVERSATION À LA FOIS</p><h1>Prospects<span className="heading-count">{all.filter(c=>!c.archived).length}</span></h1><p className="page-subtitle">{settings.name} · Qui contacter, pourquoi, et quelle est la suite.</p></div><div className="button-row"><Link href={`/campagnes/${campaignId}?onglet=research`} className="button secondary"><Search size={16}/>Trouver des entreprises</Link><AddCompany settings={settings}/></div></div>
    <nav className="filter-tabs" aria-label="Choisir une campagne">{campaigns.map(c=><Link key={c.id} href={`/prospects?campagne=${c.id}`} className={c.id===campaignId?'selected':''}>{c.name}</Link>)}</nav>
    <section className="panel prospects-panel"><div className="prospects-toolbar"><form method="get" className="search-form"><input type="hidden" name="campagne" value={campaignId}/><Search size={18}/><label htmlFor="search" className="sr-only">Rechercher une entreprise</label><input type="search" id="search" name="q" defaultValue={q} placeholder="Nom, ville, activité ou contact…"/><input type="hidden" name="filter" value={filter}/><button type="submit" className="button text-button small-button">Rechercher</button></form><details className="more-filters"><summary><SlidersHorizontal size={16}/>Autres filtres</summary><div className="filter-menu">{otherFilters.map(([key,label])=><Link href={`/prospects?campagne=${campaignId}&filter=${key}&q=${encodeURIComponent(q)}`} key={key} aria-current={filter===key?'page':undefined}>{label}</Link>)}</div></details></div>
    <nav className="filter-tabs" aria-label="Filtrer les prospects">{filters.map(([key,label])=><Link href={`/prospects?campagne=${campaignId}&filter=${key}&q=${encodeURIComponent(q)}`} key={key} className={filter===key?'selected':''} aria-current={filter===key?'page':undefined}>{label}</Link>)}</nav>
    {otherFilters.some(([key])=>key===filter)&&<p className="field-help">Filtre : {otherFilters.find(([key])=>key===filter)?.[1]}</p>}
    {rows.length?<div className="prospects-table-wrap"><table className="prospects-table"><thead><tr><th>Entreprise</th><th>Priorité / score</th><th>Pourquoi la contacter ?</th><th>Étape</th><th>Prochaine action</th></tr></thead><tbody>{rows.map(c=>{const evaluation=evaluations.get(c.id)!;return <tr key={c.id}><td data-label="Entreprise"><Link href={`/prospects/${c.id}?campagne=${campaignId}`} className="company-name">{c.name}<ArrowUpRight size={13}/></Link><span className="table-subtext">{[c.city,c.business].filter(Boolean).join(' · ')||'À compléter'}</span></td><td data-label="Priorité / score"><ScoreCell company={c} settings={settings} today={today}/></td><td data-label="Pourquoi la contacter ?"><p className="table-reason">{evaluation.reasons.slice(0,3).join(' · ')||evaluation.nextInformation}</p>{evaluation.decision!=='Prêt à contacter'&&evaluation.reasons.length>0&&<span className="table-subtext">{evaluation.nextInformation}</span>}</td><td data-label="Étape"><span className="stage-label">{c.stage}</span>{c.archived&&<span className="table-subtext">Archivée</span>}</td><td data-label="Prochaine action">{c.oppositionActive?<span className="small muted">Relances bloquées</span>:c.nextAction?<><span className="action-text">{c.nextAction.text}</span><ActionDate date={c.nextAction.date}/></>:<span className="small muted">À planifier</span>}</td></tr>;})}</tbody></table></div>:<div className="empty-state"><EmptyIcon/><h2>{all.length?'Aucune entreprise ici pour le moment.':'Un nom, et c’est parti.'}</h2><p>{all.length?'Essayez une autre recherche ou un autre filtre.':'Ajoutez votre première entreprise. La qualification et la prochaine action se complètent ensuite, sur sa fiche.'}</p>{all.length?<Link href="/prospects" className="button secondary">Voir toutes les entreprises</Link>:<AddCompany settings={settings}/>}</div>}
    <div className="table-footer">{rows.length} entreprise{rows.length>1?'s':''} affichée{rows.length>1?'s':''}<span>Vos observations. Vos décisions.</span></div></section>
  </CampaignProvider>;
}
