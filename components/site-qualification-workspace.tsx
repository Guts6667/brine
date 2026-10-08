'use client';

import Image from 'next/image';
import {useRef, useState, type ReactNode} from 'react';
import {FindingReview} from './qualification-enrichment';
import {ProofViewerProvider} from './proof-viewer-context';
import {useSessionChoice} from './use-session-choice';
import {isPublicVisualUrl} from '@/lib/visual-evidence';
import {reportDate} from './prospect-report';
import type {ProspectReport} from '@/lib/research-types';
import {UI_LABELS} from '@/lib/labels';

export function SiteQualificationWorkspace({report,website,candidateId,revision,observations,qualification,afterExchange,contactEditor}:{report:ProspectReport;website:string;candidateId:string;revision:number;observations:ReactNode;qualification:ReactNode;afterExchange?:ReactNode;contactEditor?:ReactNode}) {
  const [mode,setMode]=useSessionChoice(`brine:proof-viewer:${candidateId||website}`,['capture','site'] as const,'capture');
  const [embed,setEmbed]=useState(false);
  const [selected,setSelected]=useState(report.facts.find(fact=>fact.visual)?.id||'');
  const [proofOpen,setProofOpen]=useState(false);
  const workRef=useRef<HTMLElement>(null);
  const proofRef=useRef<HTMLElement>(null);
  const safeWebsite=isPublicVisualUrl(website)?website:'';
  const fact=report.facts.find(item=>item.id===selected);
  const visual=fact?.visual;
  const image=visual?.assetId?'/api/research-assets/'+visual.assetId:visual?.screenshot;

  function openProof(findingId:string) {
    setSelected(findingId);
    setMode('capture');
    setProofOpen(true);
    requestAnimationFrame(()=>proofRef.current?.focus());
  }

  function returnToWork() {
    setProofOpen(false);
    requestAnimationFrame(()=>workRef.current?.focus());
  }

  return <ProofViewerProvider openProof={openProof}><div className="site-qualification-shell">
    <details className="qualification-viewer" open={proofOpen} onToggle={event=>setProofOpen(event.currentTarget.open)}>
      <summary>Consulter le site et les {UI_LABELS.evidence.proofs.toLocaleLowerCase('fr')}</summary>
      <div className="qualification-viewer-body">
        <label className="field">Contenu affiché<select value={mode} onChange={event=>setMode(event.target.value as 'capture'|'site')}><option value="capture">Capture conservée</option><option value="site">Site navigable</option></select></label>
        {mode==='capture'?<><label className="field">{UI_LABELS.evidence.proof} à consulter<select value={selected} onChange={event=>{setSelected(event.target.value);setProofOpen(true);}}><option value="">Choisir une {UI_LABELS.evidence.proof.toLocaleLowerCase('fr')}</option>{report.facts.map(item=><option key={item.id} value={item.id}>{item.corrected?'Ancien relevé corrigé · ':item.review?.state==='rejected'?'Rejeté · ':''}{item.visual?'Capture · ':''}{item.text.slice(0,100)}</option>)}</select></label>{fact&&<p className="field-help">{visual?.element||`${UI_LABELS.evidence.finding} enregistré`} · {reportDate(fact.observedOn)}{visual?.viewport&&` · ${visual.device} ${visual.viewport.width} × ${visual.viewport.height} px`}</p>}{image?<Image className="qualification-viewer-image" src={image} alt={visual?.element||'Capture conservée'} width={visual?.viewport?.width||1280} height={visual?.viewport?.height||900} unoptimized/>:<p className="viewer-empty">{fact?`Ce ${UI_LABELS.evidence.finding.toLocaleLowerCase('fr')} comporte une source écrite, sans capture conservée.`:`Aucune capture sélectionnée. Choisissez une ${UI_LABELS.evidence.proof.toLocaleLowerCase('fr')} ou ouvrez le site.`}</p>}{visual?.pageUrl&&<a className="open-link" href={visual.pageUrl} target="_blank" rel="noopener noreferrer">Ouvrir la page source ↗</a>}<p className="field-help">Une capture figée décrit un écran et une date précis ; elle n’est pas le site actuel.</p></>:<>{safeWebsite?<><a className="open-link" href={website} target="_blank" rel="noopener noreferrer">Ouvrir le site ↗</a><p className="field-help">Adresse ouverte : {website}</p>{embed?<iframe src={safeWebsite} title={`Site public du ${UI_LABELS.entities.prospect.toLocaleLowerCase('fr')}`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" loading="lazy"/>:<button className="button secondary" onClick={()=>setEmbed(true)}>Afficher le site dans ce panneau</button>}<p className="field-help">Le site peut refuser cet affichage. Ouvrez-le dans un onglet ou revenez aux captures. Brine ne lit pas sa navigation interne ; la largeur du panneau ne simule pas un téléphone. Aucun formulaire n’est testé automatiquement.</p></>:<p className="viewer-empty">Site non identifié. Les informations et {UI_LABELS.evidence.proofs.toLocaleLowerCase('fr')} du dossier restent disponibles.</p>}</>}
        {fact&&<button className="button secondary" onClick={()=>openProof(fact.id)}>Voir le {UI_LABELS.evidence.finding.toLocaleLowerCase('fr')} et le confirmer</button>}
      </div>
    </details>
    {proofOpen&&fact&&<section ref={proofRef} tabIndex={-1} className="qualification-proof-detail"><button className="button secondary" onClick={returnToWork}>Revenir au {UI_LABELS.evidence.finding.toLocaleLowerCase('fr')}</button><FindingReview fact={fact} report={report} candidateId={candidateId} revision={revision} hideVisual readOnly={!candidateId}/></section>}
    <section ref={workRef} tabIndex={-1} className="qualification-active-work" aria-label="Travail de qualification">
      <div className="qualification-work-section">{observations}</div>
      <div className="qualification-work-section">{qualification}</div>
      {contactEditor&&<section className="qualification-work-section" aria-labelledby="candidate-contact-heading"><h2 id="candidate-contact-heading">Coordonnées</h2>{contactEditor}</section>}
      {afterExchange&&<section className="qualification-work-section" aria-labelledby="candidate-exchange-heading"><h2 id="candidate-exchange-heading">Après l’échange</h2>{afterExchange}</section>}
    </section>
  </div></ProofViewerProvider>;
}
