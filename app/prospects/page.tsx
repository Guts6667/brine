import { requireAuthenticated } from '@/lib/auth';
import Link from 'next/link';
import { Search, ArrowUpRight, SlidersHorizontal, Building2 } from 'lucide-react';
import { getStore } from '@/lib/db';
import { qualify, isEligible } from '@/lib/domain';
import { AddCompany } from '@/components/forms';
import { QualificationBadge, ActionDate, EmptyIcon } from '@/components/presentation';
export const metadata={title:'Prospects'};
export default async function Prospects({searchParams}:{searchParams:Promise<{q?:string;filter?:string}>}) {
  await requireAuthenticated();
  const {q='',filter='all'}=await searchParams,store=getStore(), [all,settings]=await Promise.all([store.listCompanies(),store.getSettings()]);
  const search=q.toLocaleLowerCase('fr');
  const rows=all.filter(c=>{
    const qualification=qualify(c).label;
    const matches=filter==='archived'?c.archived:!c.archived&&(filter==='good'?qualification==='Bonne piste'&&isEligible(c):filter==='check'?qualification==='À vérifier':filter==='exchange'?c.stage==='En échange':filter==='opposed'?c.oppositionActive:filter==='won'?c.stage==='Gagné':filter==='lost'?c.stage==='Perdu':true);
    return matches&&[c.name,c.city,c.business,c.contact.name,c.contact.email,c.contact.phone,c.contact.role].join(' ').toLocaleLowerCase('fr').includes(search);
  });
  const filters=[['all','Toutes'],['good','Bonnes pistes'],['check','À vérifier'],['exchange','En échange'],['archived','Archivées']];
  return <><div className="page-heading"><div><p className="eyebrow">UNE CONVERSATION À LA FOIS</p><h1>Prospects<span className="heading-count">{all.filter(c=>!c.archived).length}</span></h1><p className="page-subtitle">Qui contacter, pourquoi, et quelle est la suite.</p></div><AddCompany settings={settings}/></div>
    <section className="panel prospects-panel"><div className="prospects-toolbar"><form method="get" className="search-form"><Search size={18}/><label htmlFor="search" className="sr-only">Rechercher une entreprise</label><input type="search" id="search" name="q" defaultValue={q} placeholder="Nom, ville, activité ou contact…"/><input type="hidden" name="filter" value={filter}/><button type="submit" className="button text-button small-button">Rechercher</button></form><details className="more-filters"><summary><SlidersHorizontal size={16}/>Autres filtres</summary><div className="filter-menu">{[['opposed','Ne plus contacter'],['won','Gagnées'],['lost','Perdues']].map(([key,label])=><Link href={`/prospects?filter=${key}&q=${encodeURIComponent(q)}`} key={key}>{label}</Link>)}</div></details></div>
    <nav className="filter-tabs" aria-label="Filtrer les prospects">{filters.map(([key,label])=><Link href={`/prospects?filter=${key}&q=${encodeURIComponent(q)}`} key={key} className={filter===key?'selected':''} aria-current={filter===key?'page':undefined}>{label}</Link>)}</nav>
    {rows.length?<div className="prospects-table-wrap"><table className="prospects-table"><thead><tr><th>Entreprise</th><th>Pourquoi la contacter ?</th><th>Qualification</th><th>Étape</th><th>Prochaine action</th></tr></thead><tbody>{rows.map(c=><tr key={c.id}><td data-label="Entreprise"><Link href={`/prospects/${c.id}`} className="company-name">{c.name}<ArrowUpRight size={13}/></Link><span className="table-subtext">{[c.city,c.business].filter(Boolean).join(' · ')||'À compléter'}</span></td><td data-label="Pourquoi la contacter ?"><p className="table-reason">{c.observation||qualify(c).explanation}</p>{c.trigger&&<span className="table-subtext">Maintenant : {c.trigger}</span>}</td><td data-label="Qualification"><QualificationBadge company={c}/></td><td data-label="Étape"><span className="stage-label">{c.stage}</span>{c.archived&&<span className="table-subtext">Archivée</span>}</td><td data-label="Prochaine action">{c.oppositionActive?<span className="small muted">Relances bloquées</span>:c.nextAction?<><span className="action-text">{c.nextAction.text}</span><ActionDate date={c.nextAction.date}/></>:<span className="small muted">À planifier</span>}</td></tr>)}</tbody></table></div>:<div className="empty-state"><EmptyIcon/><h2>{all.length?'Aucune entreprise ici pour le moment.':'Un nom, et c’est parti.'}</h2><p>{all.length?'Essayez une autre recherche ou un autre filtre.':'Ajoutez votre première entreprise. La qualification et la prochaine action se complètent ensuite, sur sa fiche.'}</p>{all.length?<Link href="/prospects" className="button secondary">Voir toutes les entreprises</Link>:<AddCompany settings={settings}/>}</div>}
    <div className="table-footer">{rows.length} entreprise{rows.length>1?'s':''} affichée{rows.length>1?'s':''}<span>Vos observations. Vos décisions.</span></div></section>
  </>;
}
