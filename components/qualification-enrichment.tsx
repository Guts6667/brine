'use client';

import { startTransition, useActionState, useState } from 'react';
import { ArrowDownRight, Check, CircleAlert, ExternalLink, Eye, Info, Pencil, ShieldCheck, Sparkles, X } from 'lucide-react';
import { reviewFindingAction, decideQualificationSuggestionAction } from '@/app/enrichment-actions';
import { FactVisualEvidence, reportDate } from './prospect-report';
import { QUALIFICATION_RULES } from '@/lib/qualification';
import { isConfirmedFact } from '@/lib/qualification-enrichment';
import type { QualificationSuggestion } from '@/lib/qualification-enrichment';
import type { CriterionKey } from '@/lib/qualification-types';
import type { ProspectReport, ResearchFact } from '@/lib/research-types';
import type { ActionState } from '@/lib/types';

const criterionNames: Record<CriterionKey, string> = { fit: 'Adéquation à la cible', problem: 'Problème concret', trigger: 'Déclencheur', references: 'Réalisations', access: 'Interlocuteur' };
const natureLabels = { measurement: 'Mesure', observation: 'Observation', appraisal: 'Appréciation à vérifier' };
function shortText(text: string, maximum = 240) { if (text.length <= maximum) return text; const prefix = text.slice(0, maximum); return prefix.slice(0, Math.max(prefix.lastIndexOf(' '), maximum - 35)).trim() + '…'; }

export function FindingBadge({ fact }: { fact: ResearchFact }) {
  const status = fact.review?.state === 'proposed' ? ' · à confirmer' : fact.review?.state === 'confirmed' ? ' · confirmé' : '';
  if (fact.corrected || fact.review?.state === 'rejected') return <span className="finding-badge finding-incomplete"><X size={14} aria-hidden="true"/>Rejeté</span>;
  if (fact.sentiment === 'positive') return <span className="finding-badge finding-positive"><Check size={14} aria-hidden="true"/>Point positif{status}</span>;
  if (fact.kind === 'hypothesis' && fact.review?.provenance !== 'vision') return <span className="finding-badge finding-incomplete"><Info size={14} aria-hidden="true"/>À vérifier</span>;
  if (fact.section === 'visibility') return <span className="finding-badge finding-visibility"><Eye size={14} aria-hidden="true"/>Visibilité{status}</span>;
  if (fact.sentiment === 'issue' && (fact.visual?.category === 'interaction' || (fact.review?.nature === 'measurement' && /\bHTTP\s*[45]\d\d\b/i.test(fact.text)))) return <span className="finding-badge finding-important"><CircleAlert size={14} aria-hidden="true"/>{fact.review?.state === 'confirmed' ? 'Problème fonctionnel' : 'Fonctionnement à vérifier'}{status}</span>;
  if (fact.sentiment === 'issue' && fact.visual && fact.visual.category !== 'other') return <span className="finding-badge finding-important"><CircleAlert size={14} aria-hidden="true"/>Défaut d’affichage{status}</span>;
  if (fact.sentiment === 'issue') return <span className="finding-badge finding-improvement"><Sparkles size={14} aria-hidden="true"/>Amélioration{status}</span>;
  return <span className="finding-badge finding-incomplete"><Info size={14} aria-hidden="true"/>Information</span>;
}

function Feedback({ state }: { state: ActionState }) {
  return <>{state.error && <p className="form-error" role="alert">{state.error}</p>}{state.ok && state.message && <p className="form-success" role="status">{state.message}</p>}</>;
}

export function FindingReview({ fact, report, candidateId, revision, readOnly = false, hideVisual = false }: { fact: ResearchFact; report: ProspectReport; candidateId: string; revision: number; readOnly?: boolean; hideVisual?:boolean }) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(reviewFindingAction, {});
  const [note, setNote] = useState(fact.review?.note || '');
  const sources = fact.sourceIds.flatMap(id => { const source = report.sources.find(item => item.id === id); return source ? [source] : []; });
  const reliableSources = fact.sourceIds.length > 0 && sources.length === fact.sourceIds.length;
  const reviewable = fact.kind !== 'hypothesis' || (fact.review?.provenance === 'vision' && Boolean(fact.visual?.assetId || fact.visual?.screenshot));
  const confirmed = isConfirmedFact(fact), rejected = fact.corrected || fact.review?.state === 'rejected';
  const decision = (value: 'confirmed' | 'rejected') => {
    const data = new FormData();
    data.set('candidateId', candidateId); data.set('revision', String(revision)); data.set('factId', fact.id); data.set('decision', value); data.set('note', note);
    startTransition(() => dispatch(data));
  };
  return <article className={'qualification-finding' + (rejected ? ' qualification-finding-rejected' : '')} data-testid="qualification-finding" data-fact-id={fact.id}>
    <div className="qualification-finding-meta"><FindingBadge fact={fact}/><span>{fact.review ? natureLabels[fact.review.nature] : fact.kind === 'observed' ? 'Observation' : 'Information publiée'} · {reportDate(fact.observedOn)}</span></div>
    {fact.text.length > 240 ? <details className="qualification-finding-content"><summary>{shortText(fact.text)} <span>Lire le constat entier</span></summary><p className="qualification-finding-text">{fact.text}</p></details> : <p className="qualification-finding-text">{fact.text}</p>}
    <p className="qualification-finding-scope">{fact.scope}</p>
    {!hideVisual && <FactVisualEvidence fact={fact}/>}
    <details className="qualification-proof"><summary><ExternalLink size={14} aria-hidden="true"/>Sources et contexte ({sources.length})</summary><div className="stack">{sources.map(source => <div key={source.id}>{/^https?:\/\//i.test(source.url) ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url} <ExternalLink size={14} aria-hidden="true"/></a> : <p>{source.title}</p>}<p className="field-help">{reportDate(source.collectedAt)}</p>{source.excerpt && <p className="qualification-source-excerpt">{source.excerpt}</p>}</div>)}{!reliableSources && <p className="field-help">Une source manque. Complétez la preuve avant de confirmer ce constat.</p>}</div></details>
    {fact.review?.note && <p className="qualification-finding-scope"><strong>Votre précision :</strong> {fact.review.note}</p>}
    {confirmed && <p className="finding-confirmed"><ShieldCheck size={15} aria-hidden="true"/>{fact.review ? 'Constat confirmé' : 'Constat enregistré dans le dossier'} · les points se valident séparément.</p>}
    {!readOnly && !rejected && <><details className="qualification-proof"><summary><Pencil size={14} aria-hidden="true"/>Préciser mon appréciation</summary><label className="field">Votre précision<textarea value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={2}/></label></details><div className="button-row"><button type="button" className="button secondary" disabled={pending || !reliableSources || !reviewable} onClick={() => decision('confirmed')}><Check size={15} aria-hidden="true"/>{pending ? 'Enregistrement…' : confirmed ? 'Confirmer ma précision' : 'Confirmer le constat'}</button><button type="button" className="button text-button" disabled={pending} onClick={() => decision('rejected')}><X size={15} aria-hidden="true"/>Rejeter</button></div></>}
    <Feedback state={state}/>
  </article>;
}

export function QualificationHighlights({ report, suggestions }: { report: ProspectReport; suggestions: QualificationSuggestion[] }) {
  const relevant = report.facts.filter(fact => !fact.corrected && fact.review?.state !== 'rejected' && fact.origin !== 'qualification' && fact.origin !== 'exchange' && (fact.kind !== 'hypothesis' || fact.review?.provenance === 'vision') && fact.sentiment === 'issue' && suggestions.some(suggestion => suggestion.state !== 'rejected' && suggestion.evidenceIds.includes(fact.id)));
  const findings = [...new Map(relevant.map(fact => [fact.visual ? `${fact.visual.pageUrl}:${fact.visual.element}:${fact.visual.category}` : fact.text, fact])).values()].sort((a, b) => Number(Boolean(b.visual)) - Number(Boolean(a.visual))).slice(0, 3);
  if (!findings.length) return null;
  return <section className="qualification-highlights" aria-labelledby="qualification-highlights-heading"><div className="review-block-heading"><h3 id="qualification-highlights-heading">À regarder en priorité</h3><p>Ouvrez la preuve, confirmez le constat, puis choisissez les points dans le critère.</p></div><div className="qualification-highlight-grid">{findings.map(fact => {
    const criterion = suggestions.find(suggestion => suggestion.state !== 'rejected' && suggestion.evidenceIds.includes(fact.id))!.criterion;
    return <a key={fact.id} className="qualification-highlight" href={'#qualification-criterion-' + criterion}><FindingBadge fact={fact}/><strong>{shortText(fact.text, 180)}</strong><span>{criterionNames[criterion]} <ArrowDownRight size={15} aria-hidden="true"/></span></a>;
  })}</div></section>;
}

export function QualificationSuggestionPanel({ suggestion, report, candidateId, revision, findingRevision, currentAnswer, hasSavedResponse = false, dirty, onModify, readOnly = false, compact = false }: {
  suggestion: QualificationSuggestion; report: ProspectReport; candidateId: string; revision: number; findingRevision: number; currentAnswer: string; hasSavedResponse?: boolean; dirty: boolean; onModify: () => void; readOnly?: boolean; compact?:boolean;
}) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(decideQualificationSuggestionAction, {});
  const [overwrite, setOverwrite] = useState(false);
  const facts = suggestion.evidenceIds.flatMap(id => { const fact = report.facts.find(item => item.id === id); return fact ? [fact] : []; });
  const confirmed = facts.length === suggestion.evidenceIds.length && facts.length > 0 && facts.every(isConfirmedFact);
  const existingAnswer = hasSavedResponse || currentAnswer !== 'unknown';
  const answerLabel = QUALIFICATION_RULES.criteria[suggestion.criterion].options.find(option => option.value === suggestion.answer)?.label || suggestion.answer;
  function decide(value: 'accept' | 'reject') {
    const data = new FormData(); data.set('candidateId', candidateId); data.set('revision', String(revision)); data.set('suggestionId', suggestion.id); data.set('decision', value); if (overwrite) data.set('overwrite', 'yes');
    startTransition(() => dispatch(data));
  }
  if (suggestion.state === 'rejected') return <details className="qualification-rejected-proposal"><summary>Proposition rejetée · {answerLabel}</summary><p>{suggestion.rationale}</p><p className="field-help">Vous pouvez renseigner le critère manuellement.</p></details>;
  const content = <section className="qualification-suggestion" aria-label={'Analyse pour ' + criterionNames[suggestion.criterion]}>
    <div className="qualification-suggestion-heading"><span><Sparkles size={15} aria-hidden="true"/>{suggestion.state === 'accepted' ? 'Proposition acceptée' : 'Proposition de l’analyse'}</span><strong>{suggestion.points === null ? 'À compléter' : `${suggestion.points} points proposés`}</strong></div>
    <p className="qualification-suggestion-answer">{answerLabel}</p><p>{suggestion.rationale}</p>
    <p className="field-help">Proposée le {reportDate(suggestion.proposedAt)}. Les points deviennent confirmés après votre choix et les justifications requises.</p>
    <div className="qualification-suggestion-facts">{compact?facts.map(fact=><button type="button" className="button text-button" key={fact.id} onClick={()=>window.dispatchEvent(new CustomEvent('brine:view-proof',{detail:fact.id}))}>Voir la preuve · {shortText(fact.text,90)}</button>):facts.map(fact => <FindingReview key={fact.id} fact={fact} report={report} candidateId={candidateId} revision={findingRevision} readOnly={readOnly}/>)}</div>
    {!readOnly && suggestion.state === 'proposed' && <div className="qualification-suggestion-decision">
      {!confirmed && <p className="field-help">Confirmez les constats ci-dessus avant d’accepter les points proposés.</p>}
      {dirty && <p className="field-help">Enregistrez vos modifications du critère avant d’accepter ou de rejeter la proposition.</p>}
      {existingAnswer && <label className="check-label"><input type="checkbox" checked={overwrite} onChange={event => setOverwrite(event.target.checked)}/>Je choisis de remplacer ma réponse enregistrée par cette proposition.</label>}
      <div className="button-row"><button className="button primary" type="button" disabled={pending || dirty || !confirmed || (existingAnswer && !overwrite)} onClick={() => decide('accept')}><Check size={15} aria-hidden="true"/>{pending ? 'Enregistrement…' : 'Accepter la proposition'}</button><button className="button secondary" type="button" disabled={pending || (existingAnswer && !overwrite)} onClick={onModify}><Pencil size={15} aria-hidden="true"/>Modifier avant de valider</button><button className="button text-button" type="button" disabled={pending || dirty} onClick={() => decide('reject')}><X size={15} aria-hidden="true"/>Rejeter la proposition</button></div>
    </div>}
    <Feedback state={state}/>
  </section>;
  return compact&&suggestion.state!=='accepted'?<details className="qualification-accepted-proposal"><summary>Proposition de l’analyse · {answerLabel} · {suggestion.points??'—'} points</summary>{content}</details>:suggestion.state === 'accepted' ? <details className="qualification-accepted-proposal"><summary><ShieldCheck size={16} aria-hidden="true"/>Proposition acceptée · revoir les preuves</summary>{content}</details> : content;
}
