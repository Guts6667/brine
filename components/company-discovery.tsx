'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Plus, Search } from 'lucide-react';
import { importCompanyAction, searchCompaniesAction } from '@/app/automation-actions';
import type { CompanyCandidate, CompanySearchInput } from '@/lib/company-search';
import type { SearchState, ImportState } from '@/lib/automation-types';
import type { Settings } from '@/lib/types';

const activities = [
  ['43.32A,43.33Z,43.34Z', 'Second œuvre : menuiserie, revêtements et peinture'],
  ['43.21A', 'Installation électrique'],
  ['43.22A,43.22B', 'Plomberie, chauffage et climatisation'],
  ['custom', 'Choisir d’autres codes d’activité NAF'],
] as const;
function CandidateCard({ company }: { company: CompanyCandidate }) {
  const [state, dispatch, pending] = useActionState<ImportState, FormData>(importCompanyAction, {});
  return <article className="discovery-card">
    <div><h3>{company.name}</h3><p className="small muted">{company.business} · {company.city}</p><p className="small">{company.address}</p>
      <a className="open-link" href={company.sourceUrl} target="_blank" rel="noopener noreferrer">Voir la source officielle<ArrowUpRight size={13}/></a>
    </div>
    <div className="stack">
      {state.companyId ? <><p className="form-success" role="status"><Check size={15}/>{state.message}</p><Link href={`/prospects/${state.companyId}`} className="button secondary">Ouvrir la fiche<ArrowUpRight size={15}/></Link></> :
        <form action={dispatch}><input type="hidden" name="siren" value={company.siren}/><input type="hidden" name="siret" value={company.siret}/><button className="button primary" type="submit" disabled={pending}><Plus size={15}/>{pending ? 'Ajout…' : 'Ajouter à Brine'}</button></form>}
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
    </div>
  </article>;
}
function PageForm({ request, page, dispatch, pending, children }: { request: CompanySearchInput; page: number; dispatch: (data: FormData) => void; pending: boolean; children: React.ReactNode }) {
  return <form action={dispatch}><input type="hidden" name="city" value={request.city}/><input type="hidden" name="activityCodes" value={request.activityCodes}/><input type="hidden" name="query" value={request.query}/><input type="hidden" name="page" value={page}/><button type="submit" className="button secondary" disabled={pending}>{children}</button></form>;
}
export function CompanyDiscovery({ settings }: { settings: Settings }) {
  const renovation = /r[eé]novation|peinture|second œuvre/i.test(settings.targetBusiness);
  const [activity, setActivity] = useState(renovation ? activities[0][0] as string : 'custom');
  const [state, dispatch, pending] = useActionState<SearchState, FormData>(searchCompaniesAction, {});
  return <div className="stack discovery-layout">
    <section className="panel section-panel"><form action={dispatch} className="stack" onReset={event => event.preventDefault()}>
      <div className="form-grid"><div className="field"><label htmlFor="discovery-city">Commune</label><input id="discovery-city" name="city" required maxLength={180} defaultValue={settings.targetCity} placeholder="Ex. Montpellier"/></div>
        <div className="field"><label htmlFor="discovery-activity">Activité</label><select id="discovery-activity" value={activity} onChange={event => setActivity(event.target.value)}>{activities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </div>
      {activity === 'custom' ? <div className="field"><label htmlFor="discovery-codes">Codes d’activité NAF</label><input id="discovery-codes" name="activityCodes" required maxLength={200} placeholder="Ex. 43.34Z, 43.33Z"/><span className="field-help">Un ou plusieurs codes séparés par une virgule. <a href="https://www.insee.fr/fr/information/2120875" target="_blank" rel="noopener noreferrer">Consulter la nomenclature INSEE</a>.</span></div> : <input type="hidden" name="activityCodes" value={activity}/>}
      <div className="field"><label htmlFor="discovery-query">Nom de l’entreprise (facultatif)</label><input id="discovery-query" name="query" maxLength={180} placeholder="Pour retrouver une entreprise précise"/></div>
      <p className="field-help">Source : <a href="https://recherche-entreprises.api.gouv.fr/docs/" target="_blank" rel="noopener noreferrer">API publique Recherche d’entreprises</a>. La sélection utilise l’activité déclarée et les établissements actifs de la commune. Le site et les coordonnées ne sont pas fournis par ce registre.</p>
      <button type="submit" name="page" value="1" className="button primary" disabled={pending}><Search size={16}/>{pending ? 'Recherche…' : 'Rechercher des entreprises'}</button>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
    </form></section>
    {state.result && <section className="stack" aria-live="polite" aria-busy={pending}>
      <div><h2>{state.result.commune.name} · {state.result.companies.length} entreprise(s) sur cette page</h2><p className="field-help">{state.result.total} résultat(s) dans le registre. Les établissements fermés sont écartés ; certaines pages peuvent contenir moins de résultats. Chaque ajout conserve une source datée.</p></div>
      {!state.result.companies.length && <div className="panel section-panel"><p>Aucun établissement actif sur cette page. Essayez une autre page, activité ou commune.</p></div>}
      {state.result.companies.map(company => <CandidateCard key={`${company.siren}:${company.siret}`} company={company}/>)}
      {state.request && <div className="button-row discovery-pagination">
        {state.result.page > 1 && <PageForm request={state.request} page={state.result.page - 1} dispatch={dispatch} pending={pending}>Page précédente</PageForm>}
        <span className="small muted">Page {state.result.page} / {Math.max(1, state.result.totalPages)}</span>
        {state.result.page < state.result.totalPages && <PageForm request={state.request} page={state.result.page + 1} dispatch={dispatch} pending={pending}>Page suivante</PageForm>}
      </div>}
    </section>}
  </div>;
}
