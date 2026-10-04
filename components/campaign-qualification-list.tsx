'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Building2, Search } from 'lucide-react';
import { QualificationScore } from './qualification-summary';
import { FindingBadge } from './qualification-enrichment';
import type { QualificationEvaluation } from '@/lib/qualification-types';
import type { ResearchFact } from '@/lib/research-types';

export type QualificationFilter = 'review' | 'accepted' | 'verify' | 'rejected';
export interface QualificationListItem {
  id: string; href: string; name: string; business: string; city: string; website: string;
  status: QualificationFilter; evaluation: QualificationEvaluation; findings: ResearchFact[]; contact: string;
}
const filters: Array<{ value: QualificationFilter; label: string }> = [{ value: 'review', label: 'À qualifier' }, { value: 'accepted', label: 'Prospects validés' }, { value: 'verify', label: 'Plus tard' }, { value: 'rejected', label: 'Écartées' }];
const short = (text: string) => text.length > 160 ? text.slice(0, 157).trimEnd() + '…' : text;

export function CampaignQualificationList({ items, campaignId, initialFilter }: { items: QualificationListItem[]; campaignId: string; initialFilter?: QualificationFilter }) {
  const [filter, setFilter] = useState<QualificationFilter>(initialFilter || 'review');
  const [query, setQuery] = useState('');
  const [restored, setRestored] = useState(false);
  const storageKey = 'brine:qualification-list:' + campaignId;
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (!initialFilter && filters.some(item => item.value === saved?.filter)) setFilter(saved.filter);
      if (typeof saved?.query === 'string') setQuery(saved.query);
    } catch { /* Browser storage does not affect the campaign data. */ }
    setRestored(true);
  }, [initialFilter, storageKey]);
  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ filter, query })); } catch { /* Optional session persistence. */ }
  }, [filter, query, restored, storageKey]);
  const normalized = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();
  const visible = items.filter(item => item.status === filter && (!normalized || [item.name, item.business, item.city].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').includes(normalized)));
  const rememberPosition = () => { try { sessionStorage.setItem(storageKey + ':position', String(window.scrollY)); } catch { /* Native browser back also restores the scroll. */ } };
  useEffect(() => {
    if (!restored) return;
    try { const position = Number(sessionStorage.getItem(storageKey + ':position')); if (position > 0) { window.scrollTo({ top: position }); sessionStorage.removeItem(storageKey + ':position'); } } catch { /* Optional position restoration. */ }
  }, [restored, storageKey]);
  return <section className="campaign-qualification-list" aria-label="Entreprises de la campagne">
    <div className="qualification-list-toolbar"><div className="qualification-list-filters" role="group" aria-label="Filtrer les entreprises">{filters.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value} className={filter === item.value ? 'selected' : ''} onClick={() => setFilter(item.value)}>{item.label}<span>{items.filter(company => company.status === item.value).length}</span></button>)}</div><label className="qualification-list-search"><Search size={18} aria-hidden="true"/><span className="sr-only">Rechercher une entreprise</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nom, activité ou ville"/></label></div>
    <p className="qualification-list-caption" role="status">{visible.length} entreprise{visible.length > 1 ? 's' : ''} · Tous les lots de cette campagne</p>
    {visible.length > 0 ? <div className="qualification-table-wrap"><table className="qualification-table"><thead><tr><th scope="col">Entreprise</th><th scope="col">Constats à examiner</th><th scope="col">Qualification</th><th scope="col">Contact disponible</th><th scope="col"><span className="sr-only">Ouvrir la fiche</span></th></tr></thead><tbody>{visible.map(item => {
      const rank = (fact: ResearchFact) => fact.sentiment === 'issue' ? (fact.visual ? 0 : 1) : fact.sentiment === 'positive' ? 2 : 3;
      const facts = item.findings.filter(fact => !fact.corrected && fact.review?.state !== 'rejected' && fact.origin !== 'qualification' && fact.origin !== 'exchange' && fact.section !== 'identity' && fact.section !== 'contact' && (fact.sentiment === 'issue' || fact.visual || (fact.sentiment === 'positive' && fact.review?.state === 'confirmed') || fact.section === 'visibility' || (fact.section === 'presence' && /aucun site officiel confirmé/i.test(fact.text))) && (fact.kind !== 'hypothesis' || fact.review?.provenance === 'vision')).sort((a, b) => rank(a) - rank(b)).slice(0, 3);
      return <tr key={item.id}><td className="qualification-list-company"><Link href={item.href} onClick={rememberPosition}><strong>{item.name}</strong></Link><p>{[item.business, item.city].filter(Boolean).join(' · ') || 'Activité et ville à vérifier'}</p><span>{item.website ? 'Site identifié' : 'Site à confirmer'}</span></td><td className="qualification-list-findings">{facts.length ? facts.map(fact => <div key={fact.id}><FindingBadge fact={fact}/><p>{short(fact.text)}</p></div>) : <p className="qualification-list-empty-findings">Constats à compléter</p>}</td><td className="qualification-list-score"><QualificationScore evaluation={item.evaluation} compact/></td><td className="qualification-list-contact"><span className="qualification-mobile-label">Contact disponible</span>{item.contact || 'À trouver'}</td><td className="qualification-list-action"><Link href={item.href} className="button secondary" onClick={rememberPosition} aria-label={'Qualifier ' + item.name}>{item.status === 'accepted' ? 'Voir la fiche' : 'Qualifier'}<ArrowRight size={16} aria-hidden="true"/></Link></td></tr>;
    })}</tbody></table></div> : <div className="qualification-list-empty"><Building2 size={28} aria-hidden="true"/><h2>{query ? 'Aucune entreprise ne correspond à cette recherche' : filter === 'accepted' ? 'Vos prospects validés apparaîtront ici' : filter === 'review' ? 'Aucune entreprise à qualifier' : 'Aucune entreprise dans cette vue'}</h2><p>{filter === 'accepted' && !query ? 'Dans « À qualifier », examinez les preuves et les cinq critères, puis choisissez « Valider le prospect ».' : query ? 'Essayez un autre nom, une activité ou une ville.' : 'Vous pouvez changer de filtre ou lancer une recherche depuis la campagne.'}</p></div>}
  </section>;
}
