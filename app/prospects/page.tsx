import {Suspense} from 'react';
import {requireAuthenticated} from '@/lib/auth';
import Link from 'next/link';
import {Search,ArrowUpRight,SlidersHorizontal} from 'lucide-react';
import {getStore} from '@/lib/db';
import {getCampaignRepository} from '@/lib/campaign-runtime';
import {CampaignProvider} from '@/components/campaign-context';
import {parisToday} from '@/lib/domain';
import {evaluateQualification} from '@/lib/qualification';
import {evaluateContactReadiness} from '@/lib/contact-preparation';
import {AddCompany} from '@/components/forms';
import {ActionDate,EmptyIcon} from '@/components/presentation';
import {ScoreCell} from '@/components/qualification-summary';
import {SectionLoadingSkeleton} from '@/components/page-loading';
import {UI_LABELS} from '@/lib/labels';
import type {Campaign} from '@/lib/campaign-types';
import type {Company} from '@/lib/types';

export const metadata={title:UI_LABELS.entities.prospects};

export default async function Prospects({searchParams}:{searchParams:Promise<{q?:string;filter?:string;campagne?:string}>}){
  await requireAuthenticated();
  const {q='',filter='all',campagne}=await searchParams,repo=await getCampaignRepository(),campaigns=await repo.listCampaigns();
  if(!campagne&&campaigns.length>1){
    const shared=getStore().listCompanies();
    return <><div className="page-heading"><div><h1>{UI_LABELS.entities.prospects}</h1><p className="page-subtitle">Une fiche commune par {UI_LABELS.entities.prospect.toLocaleLowerCase('fr')}. Choisissez une campagne pour son suivi.</p></div><Link href="/campagnes" className="button primary">{UI_LABELS.steps.search}</Link></div><nav className="filter-tabs" aria-label="Campagnes">{campaigns.map(c=><Link key={c.id} href={`/prospects?campagne=${c.id}`}>{c.name}</Link>)}</nav><Suspense fallback={<SectionLoadingSkeleton/>}><SharedProspects companies={shared}/></Suspense></>;
  }
  const campaignId=campagne||campaigns[0].id,settings=campaigns.find(campaign=>campaign.id===campaignId)||campaigns[0],data=loadProspectData(campaignId);
  return <CampaignProvider id={campaignId}><div className="page-heading"><div><h1>{UI_LABELS.entities.prospects}<Suspense fallback={<span className="heading-count" aria-label="Chargement">…</span>}><ProspectCount data={data}/></Suspense></h1><p className="page-subtitle">{settings.name} · Qui contacter, pourquoi, et quelle est la suite.</p></div><div className="button-row"><Link href={`/campagnes/${campaignId}?onglet=research`} className="button secondary"><Search size={16}/>{UI_LABELS.steps.search}</Link><AddCompany settings={settings}/></div></div>
    <nav className="filter-tabs" aria-label="Choisir une campagne">{campaigns.map(c=><Link key={c.id} href={`/prospects?campagne=${c.id}`} className={c.id===campaignId?'selected':''}>{c.name}</Link>)}</nav>
    <Suspense fallback={<SectionLoadingSkeleton/>}><ProspectsTable data={data} campaignId={campaignId} settings={settings} q={q} filter={filter}/></Suspense>
  </CampaignProvider>;
}

async function loadProspectData(campaignId:string){
  const repo=await getCampaignRepository(),companiesByCampaign=await repo.listCompaniesByCampaign([campaignId]),all=companiesByCampaign[campaignId]||[];
  return {all,reports:await repo.getCompanyReports(campaignId,all.map(company=>company.id))};
}

async function ProspectCount({data}:{data:ReturnType<typeof loadProspectData>}){const {all}=await data;return <span className="heading-count">{all.filter(company=>!company.archived).length}</span>;}

async function SharedProspects({companies}:{companies:Company[]|Promise<Company[]>}){const shared=await companies;return <section className="panel section-panel">{shared.map(c=><Link className="campaign-run-link" key={c.id} href={`/prospects/${c.id}`}><strong>{c.name}</strong><span>{c.city} · {c.business}</span></Link>)}</section>;}

async function ProspectsTable({data,campaignId,settings,q,filter}:{data:ReturnType<typeof loadProspectData>;campaignId:string;settings:Campaign;q:string;filter:string}){
  const {all,reports}=await data,today=parisToday(),search=q.toLocaleLowerCase('fr');
  const readiness=new Map(all.map(c=>[c.id,evaluateContactReadiness(c,settings,reports.get(c.id)||null,today)] as const)),evaluations=new Map(all.map(c=>[c.id,evaluateQualification(c,settings,today)]));
  const rows=all.filter(c=>{
    const evaluation=evaluations.get(c.id)!,ready=readiness.get(c.id)!.ready&&readiness.get(c.id)!.firstContact;
    const matches=filter==='archived'?c.archived:!c.archived&&(['ready','good'].includes(filter)?ready:['verify','check'].includes(filter)?!readiness.get(c.id)!.ready:filter==='high'?evaluation.priority==='Priorité haute':filter==='contact'?evaluation.decision==='Contact à trouver':filter==='outside'?evaluation.decision==='Hors cible':filter==='evaluated'?evaluation.complete:filter==='exchange'?c.stage==='En échange':filter==='qualified'?c.stage==='Opportunité qualifiée':filter==='opposed'?c.oppositionActive:filter==='won'?c.stage==='Gagné':filter==='lost'?c.stage==='Perdu':true);
    return matches&&[c.name,c.city,c.business,c.contact.name,c.contact.email,c.contact.phone,c.contact.role].join(' ').toLocaleLowerCase('fr').includes(search);
  });
  if(['ready','good'].includes(filter))rows.sort((a,b)=>(evaluations.get(b.id)!.score??-1)-(evaluations.get(a.id)!.score??-1)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const filters=[['all','Toutes'],['verify','À vérifier'],['ready','Prêts à contacter'],['high','Priorité haute'],['contact','Contact à trouver']],otherFilters=[['outside','Hors cible'],['opposed','Ne plus contacter'],['evaluated','Score complet'],['exchange','En échange'],['qualified','Opportunités qualifiées'],['won','Gagnées'],['lost','Perdues'],['archived','Archivées']];
  return <section className="panel prospects-panel"><div className="prospects-toolbar"><form method="get" className="search-form"><input type="hidden" name="campagne" value={campaignId}/><Search size={18}/><label htmlFor="search" className="sr-only">{UI_LABELS.steps.search} un {UI_LABELS.entities.prospect.toLocaleLowerCase('fr')}</label><input type="search" id="search" name="q" defaultValue={q} placeholder="Nom, ville, activité ou contact…"/><input type="hidden" name="filter" value={filter}/><button type="submit" className="button text-button small-button">{UI_LABELS.steps.search}</button></form><details className="more-filters"><summary><SlidersHorizontal size={16}/>Autres filtres</summary><div className="filter-menu">{otherFilters.map(([key,label])=><Link href={`/prospects?campagne=${campaignId}&filter=${key}&q=${encodeURIComponent(q)}`} key={key} aria-current={filter===key?'page':undefined}>{label}</Link>)}</div></details></div>
    <nav className="filter-tabs" aria-label={`Filtrer les ${UI_LABELS.entities.prospects.toLocaleLowerCase('fr')}`}>{filters.map(([key,label])=><Link href={`/prospects?campagne=${campaignId}&filter=${key}&q=${encodeURIComponent(q)}`} key={key} className={filter===key?'selected':''} aria-current={filter===key?'page':undefined}>{label}</Link>)}</nav>
    {otherFilters.some(([key])=>key===filter)&&<p className="field-help">Filtre : {otherFilters.find(([key])=>key===filter)?.[1]}</p>}
    {rows.length?<div className="prospects-table-wrap"><table className="prospects-table"><thead><tr><th>{UI_LABELS.entities.prospect}</th><th>Priorité / score</th><th>Pourquoi le contacter ?</th><th>Étape</th><th>Prochaine action</th></tr></thead><tbody>{rows.map(c=>{const evaluation=evaluations.get(c.id)!;return <tr key={c.id}><td data-label={UI_LABELS.entities.prospect}><Link href={`/prospects/${c.id}?campagne=${campaignId}`} className="company-name">{c.name}<ArrowUpRight size={13}/></Link><span className="table-subtext">{[c.city,c.business].filter(Boolean).join(' · ')||'À compléter'}</span></td><td data-label="Priorité / score"><ScoreCell company={c} settings={settings} today={today} contactDecision={readiness.get(c.id)!.decision}/></td><td data-label="Pourquoi le contacter ?"><p className="table-reason">{c.plan?.motive||evaluation.reasons.slice(0,3).join(' · ')||evaluation.nextInformation}</p>{evaluation.decision!=='Prêt à contacter'&&evaluation.reasons.length>0&&<span className="table-subtext">{evaluation.nextInformation}</span>}</td><td data-label="Étape"><span className="stage-label">{c.stage}</span>{c.archived&&<span className="table-subtext">Archivé</span>}</td><td data-label="Prochaine action">{c.oppositionActive?<span className="small muted">Relances bloquées</span>:c.nextAction?<><span className="action-text">{c.nextAction.text}</span><ActionDate date={c.nextAction.date}/></>:<span className="small muted">À planifier</span>}</td></tr>;})}</tbody></table></div>:<div className="empty-state"><EmptyIcon/><h2>{all.length?`Aucun ${UI_LABELS.entities.prospect.toLocaleLowerCase('fr')} ici pour le moment.`:'Ajoutez votre premier prospect.'}</h2><p>{all.length?'Essayez une autre recherche ou un autre filtre.':'La qualification et la prochaine action se complètent ensuite sur sa fiche.'}</p>{all.length?<Link href="/prospects" className="button secondary">Voir tous les {UI_LABELS.entities.prospects.toLocaleLowerCase('fr')}</Link>:<AddCompany settings={settings}/>}</div>}
    <div className="table-footer">{rows.length} {rows.length>1?UI_LABELS.entities.prospects.toLocaleLowerCase('fr'):UI_LABELS.entities.prospect.toLocaleLowerCase('fr')} affiché{rows.length>1?'s':''}</div></section>;
}
