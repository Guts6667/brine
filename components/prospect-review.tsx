'use client';

import Link from 'next/link';
import { useActionState, useState, type ReactNode } from 'react';
import { ArrowRight, Check, ExternalLink, Mail, Phone } from 'lucide-react';
import { reviewCandidateAction } from '@/app/campaign-actions';
import { FactVisualEvidence, ProspectReport, reportDate } from '@/components/prospect-report';
import type { ProspectInsight, ProspectInsights } from '@/lib/prospect-insights';
import type { ProspectReport as Report, ResearchContact } from '@/lib/research-types';
import { UI_LABELS } from '@/lib/labels';

const contactLabels = { email: 'Email public', phone: 'Téléphone public', formUrl: 'Formulaire', profileUrl: 'Profil professionnel' };

type Props = {
  candidateId: string;
  revision: number;
  report: Report;
  insights: ProspectInsights;
  contacts: ResearchContact[];
  selectedIds: string[];
  selectedContactIndexes: number[];
  eligibleIds: string[];
  initialApproach: string;
  campaignId: string;
  prepareHref?: string;
  companyHref?: string;
  savedContactValues?: Partial<Record<ResearchContact['kind'], string>>;
  retained: boolean;
  archived: boolean;
  canReview: boolean;
  offerEditor?: ReactNode;
  visualObservation?: ReactNode;
  qualification?: ReactNode;
  decisionReturnTo?: string;
};

function InsightCard({ insight, report, selectedIds, eligibleIds, editable, pending, onSelect }: {
  insight: ProspectInsight;
  report: Report;
  selectedIds: string[];
  eligibleIds: string[];
  editable: boolean;
  pending: boolean;
  onSelect: (insight: ProspectInsight) => void;
}) {
  const selected = insight.evidenceIds.some(id => selectedIds.includes(id));
  const eligible = insight.evidenceIds.some(id => eligibleIds.includes(id));
  const visualFacts = report.facts.filter(fact => insight.evidenceIds.includes(fact.id) && fact.visual);
  const proofUrl = visualFacts[0]?.visual?.pageUrl || insight.sources[0]?.url;
  return <article className={'review-insight' + (selected ? ' review-insight-selected' : '')} data-testid="priority-insight">
    <div className="review-insight-heading"><h4>{insight.title}</h4>{selected && <span className="review-selected-label"><Check size={14} aria-hidden="true" /> Choisi</span>}</div>
    <p className="review-observation">{insight.observation}</p>
    <div className="review-proof-line"><span>{insight.confidence === 'observed' ? `${UI_LABELS.evidence.finding} direct` : 'Information publiée'} · {reportDate(insight.observedOn)}</span>{proofUrl && <a href={proofUrl} target="_blank" rel="noopener noreferrer">Vérifier la page <ExternalLink size={14} aria-hidden="true" /></a>}</div>
    {visualFacts.map(fact => <FactVisualEvidence key={fact.id} fact={fact} />)}
    {insight.possibleEffect && <div className="review-insight-meaning"><strong>Ce que cela peut gêner</strong><p>{insight.possibleEffect}</p></div>}
    {insight.proportionateHelp && <div className="review-insight-meaning"><strong>L’aide à envisager</strong><p>{insight.proportionateHelp}</p></div>}
    <div className="review-insight-footer">
      {editable && eligible && <button className={'button ' + (selected ? 'secondary' : 'primary')} type="button" aria-pressed={selected} disabled={pending} onClick={() => onSelect(insight)}>{selected ? 'Retirer ce choix' : `Choisir ce ${UI_LABELS.evidence.finding.toLocaleLowerCase('fr')}`}</button>}
      <details className="review-insight-sources"><summary>{UI_LABELS.evidence.finding} entier et sources</summary><div className="details-body">{insight.supportingObservations.map((text, index) => <p key={index}>{text}</p>)}<p className="small muted">{insight.scope}</p>{insight.sources.map(source => <p key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} <ExternalLink size={13} aria-hidden="true" /></a><span className="small muted"> · {reportDate(source.collectedAt)}</span></p>)}</div></details>
    </div>
  </article>;
}

export function ProspectReview({ candidateId, revision, report, insights, contacts, selectedIds: initialIds, selectedContactIndexes, eligibleIds, initialApproach, campaignId, prepareHref, companyHref, savedContactValues, retained, archived, canReview, offerEditor, visualObservation, qualification, decisionReturnTo }: Props) {
  const [state, dispatch, pending] = useActionState(reviewCandidateAction, {});
  const [unsavedError, setUnsavedError] = useState('');
  const [editing, setEditing] = useState(!retained);
  const [draftIds, setSelectedIds] = useState(initialIds);
  const validFacts = new Set(report.facts.filter(fact => !fact.corrected && fact.review?.state !== 'rejected' && fact.kind !== 'hypothesis' && fact.sourceIds.length && fact.sourceIds.every(id => report.sources.some(source => source.id === id))).map(fact => fact.id));
  const selectedIds = draftIds.filter(id => validFacts.has(id));
  const [contactIndexes, setContactIndexes] = useState(selectedContactIndexes);
  const [note, setNote] = useState(initialApproach);
  const savedChoices = JSON.stringify([initialIds, selectedContactIndexes, initialApproach, retained]);
  const [previousSavedChoices, setPreviousSavedChoices] = useState(savedChoices);
  // A collection refresh changes revision, but must preserve unfinished choices.
  // Only a change in the saved decision resets the local review state.
  if (savedChoices !== previousSavedChoices) {
    setPreviousSavedChoices(savedChoices);
    setSelectedIds(initialIds);
    setContactIndexes(selectedContactIndexes);
    setNote(initialApproach);
    setEditing(!retained);
  }
  const editable = canReview && !archived && editing;
  const primaryInsights = insights.highlights.slice(0, 3);
  const otherInsights = [...insights.highlights.slice(3), ...insights.otherInsights];
  const offerHref = `/campagnes/${campaignId}?etape=cibler#campaign-offer`;
  const chooseInsight = (insight: ProspectInsight) => {
    if (pending) return;
    const ids = insight.evidenceIds;
    if (ids.some(id => selectedIds.includes(id))) setSelectedIds(selectedIds.filter(id => !ids.includes(id)));
    else {
      const id = ids.find(value => eligibleIds.includes(value));
      if (id) setSelectedIds([...selectedIds, id]);
    }
  };
  const chooseContact = (index: number, checked: boolean) => setContactIndexes(checked
    ? [...contactIndexes.filter(value => contacts[value]?.kind !== contacts[index].kind), index]
    : contactIndexes.filter(value => value !== index));
  const storedContacts = Object.entries(savedContactValues || {}).filter(([, value]) => Boolean(value)).map(([kind, value]) => ({ kind: kind as ResearchContact['kind'], value: value!, sourceUrl: contacts.find(contact => contact.kind === kind && contact.value === value)?.sourceUrl || '' }));
  const topContacts = (['email', 'phone'] as const).flatMap(kind => {
    const stored = storedContacts.find(contact => contact.kind === kind);
    if (stored) return [stored];
    const chosen = contacts.find((contact, index) => contact.kind === kind && contactIndexes.includes(index));
    const contact = chosen || contacts.find(item => item.kind === kind);
    return contact ? [contact] : [];
  });
  const newContacts = contacts.flatMap((contact, index) => savedContactValues?.[contact.kind] ? [] : [{ contact, index }]);
  const contactSummary = [...storedContacts.map(contact => contact.value), ...contactIndexes.filter(index => contacts[index] && !savedContactValues?.[contacts[index].kind]).map(index => contacts[index]?.value)].filter(Boolean).join(' · ');

  return <div className={'prospect-review'+(qualification?' prospect-review-compact':'')} data-testid="prospect-review">
    <div className="review-identity-section"><div className="review-identity-links">
      {insights.identity.website ? <a className="button secondary" href={insights.identity.website} target="_blank" rel="noopener noreferrer">Ouvrir le site <ExternalLink size={15} aria-hidden="true" /></a> : <span className="review-unknown">Site non confirmé</span>}
      {topContacts.map(contact => <div className="review-public-contact" key={contact.kind}>{contact.kind === 'email' ? <Mail size={15} aria-hidden="true" /> : <Phone size={15} aria-hidden="true" />}<span>{contact.value}</span>{contact.sourceUrl ? <a href={contact.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Source du ${contact.kind === 'email' ? 'courriel' : 'téléphone'} public`}>Source <ExternalLink size={12} aria-hidden="true" /></a> : <span className="review-unknown">Sur la fiche</span>}</div>)}
      {!topContacts.length && <span className="review-unknown">Email et téléphone à compléter</span>}
    </div>

    {retained && !archived && <div className="review-saved-state"><div><strong><Check size={17} aria-hidden="true" /> {qualification?`${UI_LABELS.entities.prospect} retenu`:`${UI_LABELS.entities.prospect} validé dans la campagne`}</strong><p className="retained-details">{initialIds.length ? `${initialIds.length} ${initialIds.length>1?UI_LABELS.evidence.findings.toLocaleLowerCase('fr'):UI_LABELS.evidence.finding.toLocaleLowerCase('fr')} enregistré${initialIds.length>1?'s':''}.` : `Aucun ${UI_LABELS.evidence.finding.toLocaleLowerCase('fr')} choisi pour le moment.`} Vous pouvez continuer la qualification ou préparer le premier contact.</p></div><div className="button-row">{prepareHref && <Link className="button primary" href={prepareHref}>{UI_LABELS.steps.contact} <ArrowRight size={16} aria-hidden="true" /></Link>}<button type="button" className="button text-button" onClick={() => setEditing(!editing)}>{editing ? qualification?'Fermer':'Fermer la modification' : 'Modifier mes choix'}</button></div></div>}
    </div>
    {archived && <p className="review-status-note">Ce {UI_LABELS.entities.prospect.toLocaleLowerCase('fr')} a été retiré de la campagne. Son dossier reste consultable ; vous pouvez le réintégrer en bas de la fiche.</p>}
    {insights.offer.status !== 'ready' && <details className="review-secondary-detail"><summary>Spécialiser l’offre pour cette campagne (facultatif)</summary><p>Pickles Studio : sites internet, refontes, améliorations UX/UI et applications.</p>{offerEditor || <Link href={offerHref} className="button secondary">Personnaliser la campagne <ArrowRight size={15} aria-hidden="true" /></Link>}</details>}

    {qualification}

    <form action={dispatch} className="review-form" aria-busy={pending} onSubmit={event => {
      const dirty = document.querySelector<HTMLElement>('[data-qualification-dirty="true"]');
      if (dirty) {
        event.preventDefault(); setUnsavedError('Enregistrez d’abord vos modifications pour les conserver avec cette décision.');
        window.dispatchEvent(new CustomEvent('brine:qualification-focus',{detail:dirty.classList.contains('observations-block')?'observations-heading':dirty.classList.contains('after-exchange-block')?'exchange':'answers.fit'}));
        requestAnimationFrame(()=>dirty.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus());
      } else setUnsavedError('');
    }}>
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="selectionComplete" value="yes" />
      {decisionReturnTo ? <input type="hidden" name="returnTo" value={decisionReturnTo}/> : retained && <input type="hidden" name="returnTo" value="candidate" />}
      {selectedIds.filter(id => report.facts.some(fact => fact.id === id)).map(id => <input type="hidden" name="findingId" key={id} value={id} />)}
      {contactIndexes.map(index => <input type="hidden" name="contactIndex" key={index} value={index} />)}
      <details className="review-legacy-details" open={!qualification}><summary>Autres analyses et pistes d’intervention</summary><div className="review-priorities" id={'review-points-' + candidateId}>
        <div className="review-block-heading"><h3>{primaryInsights.length ? 'Les points à regarder en premier' : 'Ce que le dossier permet de savoir'}</h3><p>{insights.nextAction.explanation}</p></div>
        {primaryInsights.length ? primaryInsights.map(insight => <InsightCard key={insight.id} insight={insight} report={report} selectedIds={selectedIds} eligibleIds={eligibleIds} editable={editable} pending={pending} onSelect={chooseInsight} />) : <div className="review-no-finding"><p>Aucun défaut précis n’est documenté pour l’instant.</p><p>{insights.identity.website ? 'Ouvrez le site et regardez si ses pages sont lisibles, si les réalisations s’affichent et si l’accès au contact fonctionne.' : 'Confirmez leur site ou consultez leur profil public pour comprendre comment ils présentent leur activité.'}</p></div>}
        {otherInsights.length > 0 && <details className="review-more-insights"><summary>Autres {UI_LABELS.evidence.findings.toLocaleLowerCase('fr')} ({otherInsights.length})</summary><div className="details-body">{otherInsights.map(insight => <InsightCard key={insight.id} insight={insight} report={report} selectedIds={selectedIds} eligibleIds={eligibleIds} editable={editable} pending={pending} onSelect={chooseInsight} />)}</div></details>}
        {insights.positives.length > 0 && <details className="review-positives"><summary>Ce qui fonctionne ou est déjà présenté ({insights.positives.length})</summary><div className="details-body">{insights.positives.map(insight => <InsightCard key={insight.id} insight={insight} report={report} selectedIds={selectedIds} eligibleIds={eligibleIds} editable={editable} pending={pending} onSelect={chooseInsight} />)}</div></details>}
      </div></details>

      {editable && <div className="review-choice-area" id={'review-decision-'+candidateId}>
        <div className="review-block-heading"><h3>{retained ? 'Mettre à jour mes choix' : `${UI_LABELS.steps.qualify} cette ${UI_LABELS.entities.company.toLocaleLowerCase('fr')}`}</h3><p>{selectedIds.length ? `${selectedIds.length} ${selectedIds.length>1?UI_LABELS.evidence.findings.toLocaleLowerCase('fr'):UI_LABELS.evidence.finding.toLocaleLowerCase('fr')} choisi${selectedIds.length>1?'s':''} pour préparer l’approche.` : `Choisissez un ${UI_LABELS.evidence.finding.toLocaleLowerCase('fr')} utile, ou gardez la fiche pour approfondir. Vous pourrez compléter la préparation ensuite.`}</p></div>
        <details className="review-contact-choices" id={'review-contact-choices-'+candidateId}><summary>Coordonnées à garder <span>{contactSummary || 'Aucune sélectionnée'}</span></summary><div className="details-body">{storedContacts.length > 0 && <><p className="field-help">Ces coordonnées sont déjà enregistrées et seront conservées.</p>{storedContacts.map(contact => <p key={contact.kind}>{contactLabels[contact.kind]} : {contact.value}{contact.sourceUrl && <> · <a href={contact.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a></>}</p>)}</>}{companyHref && <Link href={companyHref} className="open-link">Modifier les coordonnées sur la fiche →</Link>}{newContacts.length > 0 ? <><p className="field-help">Informations publiques à confirmer avant un contact. Un contact par type sera conservé sur la fiche.</p>{newContacts.map(({ contact, index }) => <label className="review-contact-choice" key={`${contact.kind}:${index}`}><input type="checkbox" checked={contactIndexes.includes(index)} disabled={pending} onChange={event => chooseContact(index, event.target.checked)} /><span><strong>{contactLabels[contact.kind]}</strong>{contact.value}<a href={contact.sourceUrl} target="_blank" rel="noopener noreferrer">Voir la source <ExternalLink size={12} aria-hidden="true" /></a></span></label>)}</> : !storedContacts.length && <p>Aucune coordonnée extraite. Vous pourrez en ajouter sur la fiche.</p>}</div></details>
        <details className="review-personal-note"><summary>Ajouter une note personnelle (facultatif)</summary><div className="field"><label htmlFor={'candidate-approach-' + candidateId}>Ce que je veux approfondir</label><textarea id={'candidate-approach-' + candidateId} name="approach" value={note} onChange={event => setNote(event.target.value)} maxLength={4000} disabled={pending} placeholder="Ex. Vérifier le comparateur de photos sur téléphone avant de proposer une correction." /></div></details>
        {state.error && <p className="form-error" role="alert">{state.error}</p>}
        {unsavedError && <p className="form-error" role="alert">{unsavedError} <a href="#qualification-heading">Revenir à la qualification</a></p>}
        {pending && <p role="status" className="field-help">Enregistrement de votre décision…</p>}
        <div className="button-row review-decisions"><button type="submit" name="decision" value="accept" className="button primary" disabled={pending}>{retained ? 'Enregistrer mes choix' : `Valider le ${UI_LABELS.entities.prospect.toLocaleLowerCase('fr')}`}</button><button type="submit" name="decision" value="verify" className="button secondary" disabled={pending}>Plus tard</button><button type="submit" name="decision" value="reject" className="button text-button" disabled={pending}>{retained ? 'Écarter ce résultat' : 'Écarter'}</button></div>
        <p className="review-decision-help">La validation est votre décision. Elle conserve la qualification, les {UI_LABELS.evidence.proofs.toLocaleLowerCase('fr')} et vos choix dans la campagne, même si des critères restent à compléter.</p>
      </div>}
    </form>

    {canReview && !archived && visualObservation && <div className="review-add-observation">{visualObservation}</div>}
    {insights.unknowns.length > 0 && <details className="review-unknowns"><summary>Ce qui reste à vérifier ({insights.unknowns.length})</summary><ul>{insights.unknowns.map((text, index) => <li key={index}>{text}</li>)}</ul></details>}
    <div className="review-complete-dossier"><ProspectReport report={report} selectionName={editable ? 'findingId' : undefined} selectedIds={selectedIds} selectableIds={eligibleIds} onSelectionChange={ids => { if (!pending) setSelectedIds(ids); }} selectionDisabled={pending} renderSelectionInputs={false} showSummary={false} printHref={'/campagnes/rapports/candidat/' + candidateId} /></div>
  </div>;
}
