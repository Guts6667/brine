'use client';

import { useActionState, useState } from 'react';
import { ArrowUpRight, Check, ScanSearch } from 'lucide-react';
import { analyzeSiteAction, applySiteAnalysisAction } from '@/app/automation-actions';
import { formatDate } from '@/lib/domain';
import type { AnalysisState } from '@/lib/automation-types';
import type { SiteAnalysis as Analysis } from '@/lib/site-analysis';
import type { ActionState, Company } from '@/lib/types';

function AnalysisPreview({ company, analysis, token }: { company: Company; analysis: Analysis; token: string }) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(applySiteAnalysisAction.bind(null, company.id), {});
  const [contactSelections, setContactSelections] = useState<Partial<Record<'email'|'phone'|'formUrl', number>>>({});
  const labels = { email: 'Email', phone: 'Téléphone', formUrl: 'Formulaire' };
  return <div className="stack audit-preview">
    <p className="small muted">Relevé du {formatDate(analysis.analyzedOn)} · {analysis.pages.length} page(s) consultée(s)</p>
    {analysis.warnings.length > 0 && <ul className="audit-warnings">{analysis.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    <details className="inline-details"><summary>Pages consultées</summary><ul className="small">{analysis.pages.map(page => <li key={page.url}><a href={page.url} target="_blank" rel="noopener noreferrer">{page.title || page.url}</a></li>)}</ul></details>
    <form action={dispatch} className="stack" onReset={event => event.preventDefault()}><input type="hidden" name="previewToken" value={token}/>
      {!!analysis.contacts.length && <fieldset className="audit-fieldset"><legend>Coordonnées publiées à ajouter</legend>
        {analysis.contacts.map((contact, index) => <div className="audit-item" key={`${contact.kind}:${contact.value}`}><label className="check-label"><input type="checkbox" name="contactIndex" value={index} checked={contactSelections[contact.kind] === index} onChange={event => setContactSelections(current => ({...current, [contact.kind]: event.target.checked ? index : undefined}))} disabled={pending || !!state.ok || !!company.contact[contact.kind]}/><span>{labels[contact.kind]} : <strong>{contact.value}</strong>{company.contact[contact.kind] && <span className="field-help">Ce champ est déjà renseigné.</span>}</span></label><a href={contact.sourceUrl} target="_blank" rel="noopener noreferrer" className="open-link">Source<ArrowUpRight size={12}/></a></div>)}
      </fieldset>}
      {!!analysis.findings.length && <fieldset className="audit-fieldset"><legend>Constats et angles d’approche</legend>
        <p className="field-help">Choisissez les constats à conserver dans les notes. Chaque angle reste limité aux pages et aux tests indiqués.</p>
        {analysis.findings.map(finding => <div className="audit-item" key={finding.id}><label className="check-label"><input type="checkbox" name="findingId" value={finding.id} disabled={pending || !!state.ok}/><span>{finding.note}</span></label>
          <a href={finding.sourceUrl} target="_blank" rel="noopener noreferrer" className="open-link">Vérifier la page<ArrowUpRight size={12}/></a>
          {finding.approach && <div className="audit-approach"><span className="eyebrow">ANGLE À ADAPTER</span><p>{finding.approach}</p></div>}
        </div>)}
      </fieldset>}
      {!analysis.contacts.length && !analysis.findings.length && <p className="inline-empty">Aucun constat ou canal exploitable trouvé dans les pages accessibles.</p>}
      {(!!analysis.contacts.length || !!analysis.findings.length) && !state.ok && <button className="button primary" type="submit" disabled={pending}><Check size={15}/>{pending ? 'Enregistrement…' : 'Conserver la sélection'}</button>}
      {state.error && <p className="form-error" role="alert">{state.error}</p>}{state.ok && <p className="form-success" role="status"><Check size={15}/>{state.message}</p>}
    </form>
  </div>;
}
export function SiteAnalysisPanel({ company }: { company: Company }) {
  const [state, dispatch, pending] = useActionState<AnalysisState, FormData>(analyzeSiteAction.bind(null, company.id), {});
  const [auditType, setAuditType] = useState('pages');
  return <section className="panel section-panel" aria-labelledby="site-analysis-heading">
    <div className="section-title"><ScanSearch size={22}/><div><h2 id="site-analysis-heading">Vérifier le site et préparer l’approche</h2><p className="muted">Des coordonnées et des constats reliés aux pages consultées.</p></div></div>
    <form action={dispatch} className="stack"><p className="field-help">{company.website ? `Site renseigné : ${company.website}` : 'Renseignez et enregistrez le site officiel dans les informations de la fiche pour lancer l’analyse.'}</p>
      <div className="button-row"><button type="submit" name="auditType" value="pages" onClick={() => setAuditType('pages')} className="button secondary" disabled={pending || !company.website}><ScanSearch size={16}/>{pending && auditType === 'pages' ? 'Analyse des pages…' : 'Analyser le site'}</button>
        <button type="submit" name="auditType" value="mobile" onClick={() => setAuditType('mobile')} className="button secondary" disabled={pending || !company.website}>{pending && auditType === 'mobile' ? 'Test mobile en cours…' : 'Tester sur mobile (PageSpeed)'}</button></div>
      <p className="field-help">PageSpeed mesure un chargement mobile simulé et certains défauts techniques. Le rendu visuel, les formulaires et l’ancienneté du site peuvent demander une vérification complémentaire.</p>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
    </form>
    {state.analysis && state.previewToken && <AnalysisPreview key={state.previewToken} company={company} analysis={state.analysis} token={state.previewToken}/>}
  </section>;
}
