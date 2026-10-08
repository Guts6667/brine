'use client';

import { useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import type { ProspectReport as Report, ResearchFact } from '@/lib/research-types';
import { UI_LABELS } from '@/lib/labels';

const statusLabels = { documented: 'Documenté', partial: 'Partiel', unverified: 'Non vérifié', not_applicable: 'Non applicable' };
const kindLabels = { observed: `${UI_LABELS.evidence.finding} direct`, reported: 'Information publiée', hypothesis: 'Hypothèse à confirmer' };

export function reportDate(value: string): string {
  if (!value) return 'Date inconnue';
  const date = new Date(value.length === 10 ? value + 'T12:00:00Z' : value);
  return Number.isNaN(date.getTime()) ? 'Date inconnue' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'Europe/Paris' }).format(date);
}

export function PrintReportButton() {
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  return <div className="print-hidden"><button className="button secondary" type="button" disabled={pending} onClick={async()=>{
    setPending(true);setError('');let timer:ReturnType<typeof setTimeout>|undefined;
    try{const images=Array.from(document.querySelectorAll<HTMLImageElement>('.print-report img'));images.forEach(image=>{image.loading='eager';});await Promise.race([Promise.all(images.map(image=>image.decode())),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Capture non chargée.')),10000);})]);window.print();}
    catch{setError('Une capture n’a pas pu être chargée. Rechargez le dossier avant de l’exporter.');}
    finally{clearTimeout(timer);setPending(false);}
  }}>{pending?'Chargement des captures…':'Imprimer / enregistrer en PDF'}</button>{error&&<p role="alert" className="form-error">{error}</p>}</div>;
}

export function FactVisualEvidence({ fact, expanded = false }: { fact: ResearchFact; expanded?: boolean }) {
  if (!fact.visual) return null;
  const visual = fact.visual;
  const imageUrl=visual.assetId?`/api/research-assets/${visual.assetId}`:visual.screenshot;
  return <div className="visual-evidence">
    <p className="small muted">{visual.device === 'mobile' ? 'Sur téléphone' : 'Sur ordinateur'} · {visual.element}{visual.viewport ? ` · ${visual.viewport.width} × ${visual.viewport.height} px` : ''}</p>
    {imageUrl && <details className="visual-capture" open={expanded}><summary>Voir la capture</summary><Image className="visual-evidence-image" src={imageUrl} alt={`${UI_LABELS.evidence.finding} visuel : ${visual.element}, sur ${visual.device === 'mobile' ? 'téléphone' : 'ordinateur'}, relevé le ${reportDate(fact.observedOn)}`} width={visual.viewport?.width || 1280} height={visual.viewport?.height || 900} loading={expanded?'eager':'lazy'} unoptimized /><a className="open-link print-hidden" href={imageUrl} download={'preuve-' + fact.id.replace(/[^a-zA-Z0-9_-]/g, '-') + '.jpg'}>Télécharger la capture pour la voir en détail</a></details>}
  </div>;
}

type Props = {
  report: Report;
  selectionName?: string;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  selectableIds?: string[];
  selectionDisabled?: boolean;
  renderSelectionInputs?: boolean;
  printHref?: string;
  expanded?: boolean;
  showSummary?: boolean;
};

export function ProspectReport({ report, selectionName, selectedIds = [], onSelectionChange, selectableIds, selectionDisabled = false, renderSelectionInputs = true, printHref, expanded = false, showSummary = true }: Props) {
  const [open, setOpen] = useState(expanded);
  const [localSelection, setLocalSelection] = useState(selectedIds);
  const selected = onSelectionChange ? selectedIds : localSelection;
  const eligible = new Set(selectableIds || report.opportunities.flatMap(plan => plan.evidenceIds));
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
    if (onSelectionChange) onSelectionChange(next);
    else setLocalSelection(next);
  };

  return <div className="prospect-report" data-testid="prospect-report">
    <div className="report-opening">
      {showSummary && <p className="plain-text">{report.summary}</p>}
      <div className="report-controls print-hidden">
        <button type="button" className="button secondary" aria-expanded={open} aria-controls={'full-' + report.id} onClick={() => setOpen(!open)}>
          {open ? 'Replier le rapport' : 'Voir le rapport complet'} <ChevronDown size={16} className={open ? 'report-chevron-open' : ''} aria-hidden="true" />
        </button>
        <span className="report-count">{report.facts.length} {UI_LABELS.evidence.findings.toLocaleLowerCase('fr')} · {report.sources.length} sources</span>
        {printHref && <a className="open-link" href={printHref} target="_blank" rel="noopener noreferrer">Export complet <ExternalLink size={14} aria-hidden="true" /></a>}
      </div>
    </div>

    {selectionName && renderSelectionInputs && report.facts.filter(fact => selected.includes(fact.id)).map(fact => <input key={fact.id} type="hidden" name={selectionName} value={fact.id} />)}
    <div id={'full-' + report.id} className={open ? 'report-full' : 'report-full report-folded'}>
      {!expanded && <p className="report-detail-intro print-hidden">Ouvrez uniquement la partie qui vous intéresse. Le dossier et ses sources sont conservés en intégralité.</p>}
      {report.sections.map(section => <details key={section.key} id={'report-' + report.id + '-' + section.key} className="report-section" open={expanded}>
        <summary className="report-section-summary">
          <h3>{section.title}</h3>
          <span className="badge">{statusLabels[section.status]}</span>
          <ChevronDown size={17} className="report-section-chevron print-hidden" aria-hidden="true" />
        </summary>
        <div className="report-section-body">
          {section.notes.map((note, index) => <p className="small muted" key={index}>{note}</p>)}
          {report.facts.filter(fact => section.factIds.includes(fact.id)).map(fact => <article className={'evidence-card fact-' + fact.sentiment} key={fact.id} data-fact-id={fact.id}>
            <div className="fact-heading"><span className="eyebrow">{kindLabels[fact.kind]}</span><span className="small muted">{reportDate(fact.observedOn)}</span></div>
            <p className="plain-text">{fact.text}</p>
            <p className="small muted">{fact.scope}</p>
            <FactVisualEvidence fact={fact} expanded={expanded} />
            {fact.corrected && <p className="form-error">{UI_LABELS.evidence.finding} corrigé : ne plus utiliser la formulation précédente.</p>}
            <div className="fact-sources">{fact.sourceIds.map(id => {
              const source = report.sources.find(item => item.id === id);
              return source ? <a className="open-link small" key={id} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} · {reportDate(source.collectedAt)} <ExternalLink size={13} aria-hidden="true" /></a> : <p key={id} className="small muted">La source de ce {UI_LABELS.evidence.finding.toLocaleLowerCase('fr')} n’est pas disponible.</p>;
            })}</div>
            {selectionName && !fact.corrected && fact.kind !== 'hypothesis' && (eligible.has(fact.id) || selected.includes(fact.id)) && <button type="button" disabled={selectionDisabled} className={'button small-button print-hidden ' + (selected.includes(fact.id) ? 'primary' : 'secondary')} onClick={() => toggle(fact.id)} aria-pressed={selected.includes(fact.id)}>{selected.includes(fact.id) ? `${UI_LABELS.evidence.finding} sélectionné` : 'Utiliser pour mon approche'}</button>}
          </article>)}

          {section.key === 'presence' && report.profiles.map(url => <p key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url} ↗</a></p>)}
          {section.key === 'contact' && report.contacts.map((contact, index) => <p key={index}>{contact.kind === 'formUrl' ? 'Formulaire repéré, non testé' : contact.kind === 'profileUrl' ? 'Profil public' : contact.kind === 'email' ? 'Email public' : 'Téléphone public'} : {contact.value} · <a href={contact.sourceUrl} target="_blank" rel="noopener noreferrer">Provenance ↗</a></p>)}
          {section.key === 'visibility' && report.panel && <div className="panel-responses"><h4>Réponses des outils de recherche</h4><p className="field-help">Les réponses de ces outils portent uniquement sur les questions enregistrées.</p>{report.panel.responses.map((response, index) => <details key={index} open={expanded}><summary>{response.question} · {response.valid ? 'Réponse conservée' : 'Indisponible'}</summary><p className="small muted">{response.model} · {response.engine} · {reportDate(response.recordedAt)}</p><p className="plain-text">{response.answer || response.error}</p>{response.sources.map(source => <p key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></p>)}</details>)}</div>}
          {section.key === 'method' && <>
            <h4>Ce qui a été consulté et vérifié</h4><ul>{report.coverage.map((item, index) => <li key={index}>{item}</li>)}</ul>
            {report.warnings.map((warning, index) => <p className="field-help" key={index}>{warning}</p>)}
            {report.narrative && <><h4>Lecture assistée du dossier</h4><p className="plain-text">{report.narrative}</p></>}
            <h4>Toutes les sources et leurs extraits</h4>
            <ol className="report-sources">{report.sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><p className="small muted">{reportDate(source.collectedAt)}{source.query ? ' · Recherche : ' + source.query : ''}</p><p className="plain-text small">{source.excerpt || 'Aucun extrait conservé.'}</p></li>)}</ol>
          </>}
        </div>
      </details>)}
    </div>
  </div>;
}
