import Link from 'next/link';
import {Suspense} from 'react';
import {Plus,ArrowUpRight,Target} from 'lucide-react';
import {requireAuthenticated} from '@/lib/auth';
import {getCampaignRepository} from '@/lib/campaign-runtime';
import {UI_LABELS} from '@/lib/labels';
import {SectionLoadingSkeleton} from '@/components/page-loading';

export const metadata={title:'Campagnes'};

export default async function Campaigns(){
  await requireAuthenticated();
  return <>
    <div className="page-heading"><div><p className="eyebrow">DES CIBLES, DES CONVERSATIONS</p><h1>Campagnes</h1><p className="page-subtitle">Une cible et un suivi distincts pour chaque offre.</p></div><Link href="/campagnes/nouvelle" className="button primary"><Plus size={16}/>Créer une campagne</Link></div>
    <Suspense fallback={<SectionLoadingSkeleton/>}><CampaignGrid/></Suspense>
  </>;
}

async function CampaignGrid(){
  const repo=await getCampaignRepository(),campaigns=await repo.listCampaigns(),ids=campaigns.map(campaign=>campaign.id);
  const [companiesByCampaign,runsByCampaign,reviewCounts]=await Promise.all([repo.listCompaniesByCampaign(ids),repo.listRunsByCampaign(ids),repo.countReviewCandidatesByCampaign(ids)]);
  return <div className="campaign-grid">{campaigns.map(c=>{
    const companies=companiesByCampaign[c.id]||[],runs=runsByCampaign[c.id]||[],reviewCount=reviewCounts[c.id]||0;
    return <article className="panel section-panel campaign-card" key={c.id}><div className="section-title"><Target size={20}/><span className="badge">{c.status==='active'?'Active':c.status==='paused'?'En pause':'Archivée'}</span></div><h2><Link href={`/campagnes/${c.id}`}>{c.name}</Link></h2><p>{c.targetBusiness} · {c.targetCity}</p><p className="small muted">{c.targetOffer||'Offre à préciser'}</p><div className="campaign-metrics"><span><strong>{reviewCount}</strong> à qualifier</span><span><strong>{companies.filter(company=>!company.archived).length}</strong> {UI_LABELS.entities.prospects.toLocaleLowerCase('fr')}</span><span><strong>{runs.filter(run=>run.status==='running'||run.status==='queued').length}</strong> lots en cours</span><span><strong>{companies.filter(company=>company.nextAction&&!company.oppositionActive).length}</strong> actions</span></div><Link href={`/campagnes/${c.id}`} className="open-link">Ouvrir la campagne<ArrowUpRight size={14}/></Link></article>;
  })}</div>;
}
