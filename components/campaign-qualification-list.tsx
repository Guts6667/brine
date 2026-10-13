'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Building2, Search } from 'lucide-react';
import { QualificationScore } from './qualification-summary';
import { FindingBadge } from './qualification-enrichment';
import type { QualificationEvaluation } from '@/lib/qualification-types';
import type { ResearchFact } from '@/lib/research-types';
import { UI_LABELS } from '@/lib/labels';

export type QualificationFilter = 'review' | 'accepted' | 'verify' | 'rejected';
export interface QualificationListItem {
  id: string; href: string; name: string; business: string; city: string; website: string;
  status: QualificationFilter; evaluation: QualificationEvaluation; findings: ResearchFact[]; contact: string;
}
const filters: Array<{ value: QualificationFilter; label: string }> = [{ value: 'review', label: UI_LABELS.steps.qualify }, { value: 'accepted', label: `${UI_LABELS.entities.prospects} validés` }, { value: 'verify', label: 'Plus tard' }, { value: 'rejected', label: 'Écartées' }];
const short = (text: string) => text.length > 160 ? text.slice(0, 157).trimEnd() + '…' : text;
const isQualificationFilter = (value: string | null): value is QualificationFilter => filters.some(item => item.value === value);
const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();

export function CampaignQualificationList({ items, campaignId, initialFilter, initialQuery }: { items: QualificationListItem[]; campaignId: string; initialFilter: QualificationFilter; initialQuery: string }) {
  const [filter, setFilter] = useState<QualificationFilter>(initialFilter);
  const [query, setQuery] = useState(initialQuery);
  const storageKey = 'brine:qualification-list:' + campaignId;

  useEffect(() => {
    const restoreKey = `${storageKey}:position:${initialFilter}:${normalizeSearch(initialQuery)}`;
    const frame = requestAnimationFrame(() => {
      try {
        const position = Number(sessionStorage.getItem(restoreKey));
        if (position > 0) window.scrollTo({ top: position });
        sessionStorage.removeItem(restoreKey);
      } catch { /* Native browser back also restores the scroll. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [initialFilter, initialQuery, storageKey]);

  useEffect(() => {
    const syncFromHistory = () => {
      const params = new URLSearchParams(window.location.search);
      setFilter(isQualificationFilter(params.get('filtre')) ? params.get('filtre') as QualificationFilter : 'review');
      setQuery(params.get('q') || '');
    };
    window.addEventListener('popstate', syncFromHistory);
    return () => window.removeEventListener('popstate', syncFromHistory);
  }, []);

  const updateUrl = (nextFilter: QualificationFilter, nextQuery: string, mode: 'push' | 'replace') => {
    const params = new URLSearchParams(window.location.search);
    params.delete('candidat');
    params.delete('decision');
    params.set('filtre', nextFilter);
    if (nextQuery) params.set('q', nextQuery); else params.delete('q');
    const href = `${window.location.pathname}?${params.toString()}`;
    if (mode === 'push') window.history.pushState(null, '', href);
    else window.history.replaceState(null, '', href);
  };
  const changeFilter = (nextFilter: QualificationFilter) => {
    setFilter(nextFilter);
    updateUrl(nextFilter, query, 'push');
  };
  const changeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    updateUrl(filter, nextQuery, 'replace');
  };
  const normalized = normalizeSearch(query);
  const visible = items.filter(item => item.status === filter && (!normalized || normalizeSearch([item.name, item.business, item.city].join(' ')).includes(normalized)));
  const rememberPosition = () => {
    try { sessionStorage.setItem(`${storageKey}:position:${filter}:${normalized}`, String(window.scrollY)); } catch { /* Native browser back also restores the scroll. */ }
  };
  const itemHref = (item: QualificationListItem) => {
    if (!item.href.startsWith(`/campagnes/${campaignId}/qualification`)) return item.href;
    const url = new URL(item.href, 'http://brine.local');
    url.searchParams.set('filtre', filter);
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    return `${url.pathname}?${url.searchParams.toString()}`;
  };
  return <section className="campaign-qualification-list" aria-label={`${UI_LABELS.entities.companies} de la campagne`}>
    <div className="qualification-list-toolbar"><div className="qualification-list-filters" role="group" aria-label={`Filtrer les ${UI_LABELS.entities.companies.toLocaleLowerCase('fr')}`}>{filters.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value} className={filter === item.value ? 'selected' : ''} onClick={() => changeFilter(item.value)}>{item.label}<span>{items.filter(company => company.status === item.value).length}</span></button>)}</div><label className="qualification-list-search"><Search size={18} aria-hidden="true"/><span className="sr-only">{UI_LABELS.steps.search} une {UI_LABELS.entities.company.toLocaleLowerCase('fr')}</span><input type="search" value={query} onChange={event => changeQuery(event.target.value)} placeholder="Nom, activité ou ville"/></label></div>
    <p className="qualification-list-caption" role="status">{visible.length} {visible.length > 1 ? UI_LABELS.entities.companies.toLocaleLowerCase('fr') : UI_LABELS.entities.company.toLocaleLowerCase('fr')} · Tous les lots de cette campagne</p>
    {visible.length > 0 ? <div className="qualification-table-wrap"><table className="qualification-table"><thead><tr><th scope="col">{UI_LABELS.entities.company}</th><th scope="col">{UI_LABELS.evidence.findings}</th><th scope="col">Qualification</th><th scope="col">Contact disponible</th><th scope="col"><span className="sr-only">Ouvrir la fiche</span></th></tr></thead><tbody>{visible.map(item => {
      const rank = (fact: ResearchFact) => fact.sentiment === 'issue' ? (fact.visual ? 0 : 1) : fact.sentiment === 'positive' ? 2 : 3;
      const facts = item.findings.filter(fact => !fact.corrected && fact.review?.state !== 'rejected' && fact.origin !== 'qualification' && fact.origin !== 'exchange' && fact.section !== 'identity' && fact.section !== 'contact' && (fact.sentiment === 'issue' || fact.visual || (fact.sentiment === 'positive' && fact.review?.state === 'confirmed') || fact.section === 'visibility' || (fact.section === 'presence' && /aucun site officiel confirmé/i.test(fact.text))) && (fact.kind !== 'hypothesis' || fact.review?.provenance === 'vision')).sort((a, b) => rank(a) - rank(b)).slice(0, 3);
      const href = itemHref(item);
      return <tr key={item.id}><td className="qualification-list-company"><Link href={href} onClick={rememberPosition}><strong>{item.name}</strong></Link><p>{[item.business, item.city].filter(Boolean).join(' · ') || 'Activité et ville à vérifier'}</p><span>{item.website ? 'Site identifié' : 'Site à confirmer'}</span></td><td className="qualification-list-findings">{facts.length ? facts.map(fact => <div key={fact.id}><FindingBadge fact={fact}/><p>{short(fact.text)}</p></div>) : <p className="qualification-list-empty-findings">{UI_LABELS.evidence.findings} à compléter</p>}</td><td className="qualification-list-score"><QualificationScore evaluation={item.evaluation} compact/></td><td className="qualification-list-contact"><span className="qualification-mobile-label">Contact disponible</span>{item.contact || 'À trouver'}</td><td className="qualification-list-action"><Link href={href} className="button secondary" onClick={rememberPosition} aria-label={`${UI_LABELS.steps.qualify} ${item.name}`}>{item.status === 'accepted' ? 'Voir la fiche' : UI_LABELS.steps.qualify}<ArrowRight size={16} aria-hidden="true"/></Link></td></tr>;
    })}</tbody></table></div> : <div className="qualification-list-empty"><Building2 size={28} aria-hidden="true"/><h2>{query ? `Aucune ${UI_LABELS.entities.company.toLocaleLowerCase('fr')} ne correspond à cette recherche` : filter === 'accepted' ? `Vos ${UI_LABELS.entities.prospects.toLocaleLowerCase('fr')} validés apparaîtront ici` : filter === 'review' ? `Aucune ${UI_LABELS.entities.company.toLocaleLowerCase('fr')} à qualifier` : `Aucune ${UI_LABELS.entities.company.toLocaleLowerCase('fr')} dans cette vue`}</h2><p>{filter === 'accepted' && !query ? `Dans « ${UI_LABELS.steps.qualify} », consultez les ${UI_LABELS.evidence.proofs.toLocaleLowerCase('fr')} et les cinq critères, puis choisissez « Valider le ${UI_LABELS.entities.prospect.toLocaleLowerCase('fr')} ». ` : query ? 'Essayez un autre nom, une activité ou une ville.' : 'Vous pouvez changer de filtre ou lancer une recherche depuis la campagne.'}</p></div>}
  </section>;
}
