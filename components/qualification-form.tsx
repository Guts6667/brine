'use client';
import { CampaignFields } from './campaign-context';

import { createContext, useActionState, useContext, useEffect, useId, useRef, useState } from 'react';
import type { HTMLInputTypeAttribute, ReactNode } from 'react';
import { ArrowUpRight, Check, ChevronDown, ClipboardList, MessageSquare, Link2, Info } from 'lucide-react';
import { saveQualificationAction, saveObservationsAction, saveAfterExchangeAction, qualifyOpportunityAction } from '@/app/actions';
import { captureTarget, emptyQualification, evaluateQualification, evaluateAfterExchange, QUALIFICATION_RULES, OBSERVATION_LABELS, OBSERVATION_HELP, OBSERVATION_OPTIONS, AFTER_EXCHANGE_OPTIONS } from '@/lib/qualification';
import { restoreQualificationAnswers } from './qualification-draft';
import { manualObservationKeys } from '@/lib/qualification-types';
import { QualificationSuggestionPanel } from './qualification-enrichment';
import type { QualificationSuggestion } from '@/lib/qualification-enrichment';
import type { ProspectReport } from '@/lib/research-types';
import type { DiscoveryCandidate } from '@/lib/campaign-types';
import type { ActionState, Company, Settings } from '@/lib/types';
import type { AfterExchangeData, CriterionKey, DetailedObservations, ManualObservationKey, QualificationAnswers, QualificationData, TargetSnapshot } from '@/lib/qualification-types';

type QualifiedCompany = Company & { qualification?: QualificationData };
type QualificationProps = { company: QualifiedCompany; settings: Settings; today: string };
type Mutation = (state: ActionState, data: FormData) => Promise<ActionState>;
type EditableExchange = Omit<AfterExchangeData, 'qualifiedAt'>;
const FormState = createContext<ActionState>({});
const criterionKeys: CriterionKey[] = ['fit', 'problem', 'trigger', 'references', 'access'];
const criterionHelp: Record<CriterionKey, string> = {
  fit: 'Vérifiez l’activité réelle, la zone et le type d’entreprise. Le jugement reste manuel.',
  problem: 'Décrivez un défaut vérifié : prestation mal expliquée, information contradictoire, navigation ou contact difficile. Un goût personnel ou une absence dans ChatGPT ne suffisent pas.',
  trigger: 'Un besoin exprimé vient d’une déclaration vérifiée. Un changement doit avoir un lien avec une intervention pertinente.',
  references: 'Identifiez des projets, cas clients ou références concrets, avec ce qui pourrait être mieux présenté.',
  access: 'Réutilisez le contact de la fiche. Un canal ne prouve ni sa délivrabilité ni un accord de contact.',
};

function Feedback({ state }: { state: ActionState }) {
  return <>{state.error && <p className="form-error" role="alert">{state.error}</p>}{state.ok && state.message && <p className="form-success" role="status"><Check size={15} aria-hidden="true"/>{state.message}</p>}</>;
}

function PayloadForm({ action, payload, children, submit, testId, candidateId }: { action: Mutation; payload: unknown; children: ReactNode; submit: string; testId: string; candidateId?: string }) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.fields) return;
    const invalid = ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    let parent: HTMLElement | null | undefined = invalid?.parentElement;
    while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
    invalid?.focus();
  }, [state]);
  return <FormState.Provider value={state}><form ref={ref} action={dispatch} className="qualification-payload-form stack" data-testid={testId} noValidate onReset={event => event.preventDefault()}><CampaignFields/>
    <input type="hidden" name="payload" value={JSON.stringify(payload)}/>
    {candidateId && <input type="hidden" name="candidateId" value={candidateId}/>}
    {children}<Feedback state={state}/><button className="button primary" type="submit" disabled={pending}>{pending ? 'Enregistrement…' : submit}<Check size={15} aria-hidden="true"/></button>
  </form></FormState.Provider>;
}

function useFieldError(name: string) {
  const state = useContext(FormState);
  return state.fields?.[name] || state.fields?.['payload.' + name];
}

function TextField({ name, label, value, onChange, type = 'text', help, textarea = false, placeholder, min, max, step, maxLength = 5000 }: { name: string; label: string; value: string | number | null; onChange: (value: string) => void; type?: HTMLInputTypeAttribute; help?: string; textarea?: boolean; placeholder?: string; min?: number; max?: number | string; step?: number; maxLength?: number }) {
  const id = useId(), error = useFieldError(name);
  const props = { id, name, value: value ?? '', onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), placeholder, 'aria-invalid': !!error, 'aria-describedby': error || help ? id + '-help' : undefined };
  return <div className="field"><label htmlFor={id}>{label}</label>{textarea ? <textarea {...props} rows={2} maxLength={maxLength}/> : <input {...props} type={type} min={min} max={max} step={step} maxLength={type === 'number' || type === 'date' ? undefined : maxLength}/>}
    {(error || help) && <span className={error ? 'field-error' : 'field-help'} id={id + '-help'}>{error || help}</span>}
  </div>;
}

function SelectField({ name, label, value, onChange, options, help }: { name: string; label: string; value: string; onChange: (value: string) => void; options: readonly { value: string; label: string }[]; help?: string }) {
  const id = useId(), error = useFieldError(name);
  return <div className="field"><label htmlFor={id}>{label}</label><select id={id} name={name} value={value} onChange={event => onChange(event.target.value)} aria-invalid={!!error} aria-describedby={error || help ? id + '-help' : undefined}>{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select>{(error || help) && <span className={error ? 'field-error' : 'field-help'} id={id + '-help'}>{error || help}</span>}</div>;
}

function AnswerChoices({ criterion, value, onChange }: { criterion: CriterionKey; value: string; onChange: (value: string) => void }) {
  const error = useFieldError('answers.' + criterion + '.answer');
  return <><div className="qual-choice-list">{QUALIFICATION_RULES.criteria[criterion].options.map(option => <label key={option.value} className={'qual-choice' + (value === option.value ? ' selected' : '')}>
    <input type="radio" name={'qualification.' + criterion + '.answer'} value={option.value} aria-label={option.label} checked={value === option.value} onChange={() => onChange(option.value)}/><span>{option.label}</span><small>{option.points === null ? '?' : option.points + ' pts'}</small>
  </label>)}</div>{error && <p className="field-error" role="alert">{error}</p>}</>;
}

function TargetReminder({ target, title = 'Rappel de ma cible' }: { target: TargetSnapshot; title?: string }) {
  const entries = [['Activité', target.targetBusiness], ['Zone', target.targetCity], ['Type d’entreprise', target.targetCompanyType], ['Offre', target.targetOffer], ['Exclusions', target.targetExclusions]] as const;
  return <div className="qual-target-reminder"><h3>{title}</h3><dl>{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || (label === 'Exclusions' ? 'Aucune exclusion renseignée' : 'À définir')}</dd></div>)}</dl></div>;
}

function ObservationLinks({ criterion, selected, observations, onChange, onReuse }: { criterion: CriterionKey; selected: ManualObservationKey[]; observations: DetailedObservations; onChange: (keys: ManualObservationKey[]) => void; onReuse: () => void }) {
  const [copied, setCopied] = useState(false);
  const available = manualObservationKeys.filter(key => {
    const item = observations.items[key];
    return selected.includes(key) || item.answer !== 'unknown' || !!item.notes || !!item.sourceUrl || !!item.observedOn || (key === 'inactivity' && !!observations.companySize) || (key === 'googleReviews' && (observations.googleReviewCount !== null || observations.googleRating !== null));
  });
  return <details className="qual-observation-links">
    <summary><Link2 size={14} aria-hidden="true"/>Relier mes observations{selected.length > 0 && <span className="count">{selected.length}</span>}<ChevronDown size={14} aria-hidden="true"/></summary>
    <div className="stack"><p className="field-help">Ces liens facilitent la lecture des preuves. Vous choisissez séparément la réponse du critère ; aucune observation n’attribue de points.</p>
      {!available.length && <p className="field-help">Renseignez d’abord un constat dans <a href="#observations-heading">Ce que j’ai observé</a>.</p>}
      {available.map(key => <label className="check-label qual-observation-check" key={key}><input type="checkbox" name={'qualification.' + criterion + '.observationKeys'} value={key} checked={selected.includes(key)} onChange={event => { setCopied(false); onChange(event.target.checked ? [...selected, key] : selected.filter(item => item !== key)); }}/><span>{OBSERVATION_LABELS[key]}{observations.items[key].notes && <small>{observations.items[key].notes}</small>}</span></label>)}
      {!!available.length && <button type="button" className="button secondary small-button" disabled={!selected.length} onClick={() => { onReuse(); setCopied(true); }}>Reprendre les notes sélectionnées</button>}
      {copied && <p className="field-help" role="status">Notes reprises. Vérifiez leur sens et les dates avant d’enregistrer.</p>}
    </div>
  </details>;
}

function replaceEntry(entries: string[], index: number, value: string): string[] {
  const next = Array.from({ length: Math.max(entries.length, index + 1) }, (_, item) => entries[item] ?? '');
  next[index] = value;
  return next;
}

function appendNotes(existing: string, notes: string): string {
  return !notes || existing.includes(notes) ? existing : [existing, notes].filter(Boolean).join('\n');
}

export function QualificationForm({ company, settings, today, suggestedFinding, suggestions = [], report, candidate }: QualificationProps & { suggestedFinding?:{note:string;sourceUrl:string;analyzedOn:string}; suggestions?:QualificationSuggestion[]; report?:ProspectReport; candidate?:DiscoveryCandidate }) {
  const stored = company.qualification ?? emptyQualification();
  const [answers, setAnswers] = useState<QualificationAnswers>(stored.answers);
  const [confirmTarget, setConfirmTarget] = useState(false);
  const storedAnswersKey = JSON.stringify(stored.answers);
  const storedTargetKey = JSON.stringify(stored.targetSnapshot);
  const target = captureTarget(settings);
  const currentTargetKey = JSON.stringify(target);
  const draftKey = `brine:qualification:${company.campaignId || ''}:${company.id}`;
  const [restoredDraftKey, setRestoredDraftKey] = useState('');
  useEffect(() => { setAnswers(JSON.parse(storedAnswersKey) as QualificationAnswers); }, [storedAnswersKey]);
  useEffect(() => { setConfirmTarget(false); }, [storedAnswersKey, storedTargetKey, currentTargetKey]);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        const draft = JSON.parse(saved);
        const restoredAnswers = restoreQualificationAnswers(draft.answers);
        if (draft.base === storedAnswersKey && restoredAnswers) {
          setAnswers(restoredAnswers);
          setConfirmTarget(draft.target === currentTargetKey && draft.confirmTarget === true);
        } else sessionStorage.removeItem(draftKey);
      }
    } catch { /* Browser storage is optional; the form remains editable. */ }
    setRestoredDraftKey(draftKey + storedAnswersKey);
  }, [draftKey, storedAnswersKey, currentTargetKey]);
  useEffect(() => {
    if (restoredDraftKey !== draftKey + storedAnswersKey) return;
    try {
      if (JSON.stringify(answers) === storedAnswersKey && !confirmTarget) sessionStorage.removeItem(draftKey);
      else sessionStorage.setItem(draftKey, JSON.stringify({ base: storedAnswersKey, answers, target: currentTargetKey, confirmTarget }));
    } catch { /* A full or disabled session store must not block saving to Brine. */ }
  }, [answers, confirmTarget, currentTargetKey, draftKey, restoredDraftKey, storedAnswersKey]);
  function change<K extends CriterionKey>(key: K, patch: Partial<QualificationAnswers[K]>) { setAnswers(previous => ({ ...previous, [key]: { ...previous[key], ...patch } })); }
  let evaluation: ReturnType<typeof evaluateQualification> | null = null;
  try { evaluation = evaluateQualification({ ...company, qualification: { ...stored, answers, targetSnapshot: confirmTarget ? target : stored.targetSnapshot } }, settings, today); }
  catch { /* A partially typed URL is editable; structural validation belongs to submission. */ }
  const targetNeedsRevalidation = answers.fit.answer !== 'unknown' && (!stored.targetSnapshot || (Object.keys(target) as (keyof TargetSnapshot)[]).some(key => stored.targetSnapshot?.[key] !== target[key]));
  const problemPositive = answers.problem.answer === 'one' || answers.problem.answer === 'multiple_or_blocking';
  const triggerPositive = answers.trigger.answer === 'explicit' || answers.trigger.answer === 'recent_change';
  const referencesPositive = answers.references.answer === 'one' || answers.references.answer === 'multiple';
  function reuseNotes(key: CriterionKey) {
    const linked = answers[key].observationKeys.map(observationKey => stored.observations.items[observationKey]);
    const notes = linked.map(item => item.notes).filter(Boolean).join('\n');
    const source = linked.find(item => item.sourceUrl)?.sourceUrl || '';
    const date = linked.find(item => item.observedOn)?.observedOn || '';
    if (key === 'fit') change(key, { note: appendNotes(answers.fit.note, notes) });
    if (key === 'problem') change(key, { description: appendNotes(answers.problem.description, notes), proofUrl: answers.problem.proofUrl || source, observedOn: answers.problem.observedOn || date });
    if (key === 'trigger') change(key, { description: appendNotes(answers.trigger.description, notes), source: answers.trigger.source || source, verifiedOn: answers.trigger.verifiedOn || date, eventOn: answers.trigger.eventOn || (answers.trigger.observationKeys.includes('recentActivity') ? stored.observations.recentEventOn : '') });
    if (key === 'references') change(key, { improvement: appendNotes(answers.references.improvement, notes), sourceUrl: answers.references.sourceUrl || source });
    if (key === 'access') change(key, { channelAssociation: appendNotes(answers.access.channelAssociation, notes) });
  }
  return <section className="panel section-panel qualification-block" aria-labelledby="qualification-heading" data-qualification-dirty={JSON.stringify(answers) !== storedAnswersKey || confirmTarget ? 'true' : 'false'}>
    <div className="section-title"><span className="section-number">01</span><div><h2 id="qualification-heading">Mes cinq critères de qualification</h2><p className="muted">Vérifiez les preuves de l’analyse, puis confirmez vos réponses et leurs points.</p></div></div>
    <>{suggestedFinding&&<button type="button" className="button secondary" onClick={()=>change('problem',{description:answers.problem.description||suggestedFinding.note,proofUrl:answers.problem.proofUrl||suggestedFinding.sourceUrl,observedOn:answers.problem.observedOn||suggestedFinding.analyzedOn})}>Reprendre le constat retenu comme preuve</button>}<PayloadForm action={saveQualificationAction.bind(null, company.id)} candidateId={company.candidateId} payload={{ answers }} submit="Enregistrer la qualification" testId="qualification-form">
      <input type="hidden" name="expectedTarget" value={currentTargetKey}/>
      <details className="qualification-target-details"><summary>Rappel de la cible et de l’offre</summary><TargetReminder target={target}/></details>
      <p className="qual-known-company"><strong>Informations de la fiche</strong>{company.business || 'Activité non renseignée'} · {company.city || 'Zone non renseignée'}</p>
      {criterionKeys.map((key, index) => {
        const criterion = evaluation?.criteria.find(item => item.key === key);
        const current = evaluateQualification(company, settings, today).criteria.find(item => item.key === key);
        return <fieldset className="qual-question" id={'qualification-criterion-' + key} key={key} data-testid={'qualification-question-' + key}>
          <legend><span className="qual-letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span>{QUALIFICATION_RULES.criteria[key].label}</legend>
          <p className="field-help">{criterionHelp[key]}</p>
          <div className="qualification-current-answer"><span><strong>Ma réponse enregistrée</strong>{current?.answerLabel || 'À vérifier'}</span><strong>{current?.complete ? `${current.points} / ${current.maxPoints} pts confirmés` : 'Points à confirmer'}</strong></div>
          {company.qualificationEnrichment?.revalidate?.includes(key) && <p className="qualification-revalidate"><Info size={16} aria-hidden="true"/> Nouvelle analyse : revérifiez ce critère. Votre réponse est conservée.</p>}
          {report && candidate && suggestions.filter(suggestion => suggestion.criterion === key).map(suggestion => <QualificationSuggestionPanel key={suggestion.id} suggestion={suggestion} report={report} candidateId={candidate.id} revision={company.participationRevision ?? candidate.revision} findingRevision={candidate.revision} currentAnswer={answers[key].answer} hasSavedResponse={JSON.stringify(stored.answers[key]) !== JSON.stringify(emptyQualification().answers[key])} dirty={JSON.stringify(answers) !== storedAnswersKey} onModify={() => {
            setAnswers(previous => ({ ...previous, [key]: { ...suggestion.response, observationKeys: previous[key].observationKeys } }));
            document.getElementById('qualification-answer-' + key)?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
          }}/>) }
          <div className="qualification-answer-heading" id={'qualification-answer-' + key}><strong>{JSON.stringify(answers[key]) !== JSON.stringify(stored.answers[key]) ? 'Ma réponse à enregistrer' : 'Choisir ou modifier ma réponse'}</strong><span>Maximum {QUALIFICATION_RULES.criteria[key].maxPoints} points</span></div>
          <AnswerChoices criterion={key} value={answers[key].answer} onChange={value => change(key, { answer: value } as Partial<QualificationAnswers[typeof key]>)}/>
          {key === 'fit' && <>
            {answers.fit.answer !== 'unknown' && <TextField name="answers.fit.note" label="Précision sur l’adéquation (facultative)" value={answers.fit.note} onChange={note => change('fit', { note })} placeholder="Un cas partiel ou une exclusion à expliquer…"/>}
            {targetNeedsRevalidation && <div className="qual-target-validation stack">
              <p><strong>Adéquation à revérifier</strong>{stored.targetSnapshot ? 'La cible actuelle diffère de celle de cette évaluation. Les réponses précédentes sont conservées.' : 'Validez la cible utilisée pour cette première évaluation.'}</p>
              {stored.targetSnapshot && <details><summary>Cible de l’évaluation précédente</summary><TargetReminder target={stored.targetSnapshot} title="Cible utilisée précédemment"/></details>}
              <label className="check-label"><input type="checkbox" name="confirmTarget" value="yes" checked={confirmTarget} onChange={event => setConfirmTarget(event.target.checked)}/>Je confirme cette évaluation par rapport à la cible actuelle.</label>
            </div>}
          </>}
          {key === 'problem' && problemPositive && <div className="qual-justification stack">
            <TextField name="answers.problem.description" label="Le problème concret observé" value={answers.problem.description} onChange={description => change('problem', { description })} textarea placeholder="Ce qui ne fonctionne pas ou ce qui manque, précisément."/>
            <div className="form-grid"><TextField name="answers.problem.observedOn" label="Date d’observation du problème" type="date" max={today} value={answers.problem.observedOn} onChange={observedOn => change('problem', { observedOn })}/><TextField name="answers.problem.proofUrl" label="Lien de preuve du problème (facultatif)" type="url" value={answers.problem.proofUrl} onChange={proofUrl => change('problem', { proofUrl })} maxLength={2000} placeholder="https://…"/></div>
            {answers.problem.answer === 'multiple_or_blocking' && <>
              <SelectField name="answers.problem.majorReason" label="Motif des points maximum" value={answers.problem.majorReason} onChange={value => change('problem', { majorReason: value as QualificationAnswers['problem']['majorReason'] })} options={[{ value: 'unknown', label: 'À préciser' }, { value: 'multiple', label: 'Plusieurs problèmes distincts' }, { value: 'blocking', label: 'Blocage important' }]}/>
              {answers.problem.majorReason === 'multiple' && <><div className="form-grid">{Array.from({ length: Math.max(2, answers.problem.distinctProblems.length) }, (_, entry) => <TextField key={entry} name={'answers.problem.distinctProblems.' + entry} label={'Problème distinct ' + (entry + 1)} value={answers.problem.distinctProblems[entry] || ''} onChange={value => change('problem', { distinctProblems: replaceEntry(answers.problem.distinctProblems, entry, value) })} maxLength={2000}/>)}</div><p className="field-help">Deux formulations d’un même défaut ne font pas deux problèmes. Une action confuse et un contact difficile peuvent décrire le même problème.</p></>}
              {answers.problem.majorReason === 'blocking' && <TextField name="answers.problem.blockingExplanation" label="Pourquoi ce blocage est-il important ?" value={answers.problem.blockingExplanation} onChange={blockingExplanation => change('problem', { blockingExplanation })} textarea/>}
            </>}
          </div>}
          {key === 'trigger' && triggerPositive && <div className="qual-justification stack">
            <TextField name="answers.trigger.description" label="Le déclencheur vérifié" value={answers.trigger.description} onChange={description => change('trigger', { description })} textarea/>
            <TextField name="answers.trigger.source" label="Origine de l’information" value={answers.trigger.source} onChange={source => change('trigger', { source })} maxLength={2000} help="Un lien ou une note d’échange réel avec l’entreprise."/>
            <div className="form-grid"><TextField name="answers.trigger.verifiedOn" label="Date de vérification du déclencheur" type="date" max={today} value={answers.trigger.verifiedOn} onChange={verifiedOn => change('trigger', { verifiedOn })}/>{answers.trigger.answer === 'recent_change' && <TextField name="answers.trigger.eventOn" label="Date de l’événement ou de l’annonce" type="date" max={today} value={answers.trigger.eventOn} onChange={eventOn => change('trigger', { eventOn })}/>}</div>
            {answers.trigger.answer === 'recent_change' && <><TextField name="answers.trigger.relevance" label="Lien avec l’intervention proposée" value={answers.trigger.relevance} onChange={relevance => change('trigger', { relevance })} textarea/><p className="field-help">Convention V1 : l’événement doit se situer dans les {QUALIFICATION_RULES.recentDays} jours précédant sa vérification. La date de saisie ne remplace pas celle de l’événement.</p></>}
          </div>}
          {key === 'references' && referencesPositive && <div className="qual-justification stack">
            <div className="form-grid">{Array.from({ length: Math.max(answers.references.answer === 'multiple' ? 2 : 1, answers.references.examples.length) }, (_, entry) => <TextField key={entry} name={'answers.references.examples.' + entry} label={'Exemple ' + (entry + 1) + ' · réalisation ou référence'} value={answers.references.examples[entry] || ''} onChange={value => change('references', { examples: replaceEntry(answers.references.examples, entry, value) })} maxLength={2000}/>)}</div>
            <TextField name="answers.references.improvement" label="Ce qui pourrait être mieux présenté" value={answers.references.improvement} onChange={improvement => change('references', { improvement })} textarea/>
            <TextField name="answers.references.sourceUrl" label="Source des réalisations (facultative)" type="url" value={answers.references.sourceUrl} onChange={sourceUrl => change('references', { sourceUrl })} maxLength={2000} placeholder="https://…"/>
            <p className="field-help">Plusieurs signifie au moins deux exemples distincts. Ils peuvent se trouver sur une même page ; le nombre d’avis ne prouve pas un budget.</p>
          </div>}
          {key === 'access' && (answers.access.answer === 'generic' || answers.access.answer === 'decision_maker') && <div className="qual-justification stack">
            <div className="qual-contact-reuse"><strong>Contact déjà renseigné sur la fiche</strong><p>{[company.contact.name, company.contact.role].filter(Boolean).join(' · ') || 'Interlocuteur non identifié'}</p><p>{[company.contact.email, company.contact.phone, company.contact.formUrl, company.contact.profileUrl].filter(Boolean).join(' · ') || 'Aucun canal professionnel renseigné'}</p><a href="#contact-heading" className="open-link">Compléter ou corriger le contact<ArrowUpRight size={13} aria-hidden="true"/></a></div>
            {answers.access.answer === 'decision_maker' && <TextField name="answers.access.channelAssociation" label="Lien entre ce décideur et son canal professionnel" value={answers.access.channelAssociation} onChange={channelAssociation => change('access', { channelAssociation })} textarea help="Indiquez pourquoi ce canal permet de joindre cet interlocuteur."/>}
          </div>}
          <ObservationLinks criterion={key} selected={answers[key].observationKeys} observations={stored.observations} onChange={observationKeys => change(key, { observationKeys })} onReuse={() => reuseNotes(key)}/>
          {answers[key].answer !== 'unknown' && criterion && !criterion.complete && <p className="qual-draft-missing"><strong>À compléter :</strong> {criterion.missing.join(' ')}</p>}
        </fieldset>;
      })}
      <div className="qual-draft-progress" aria-live="polite"><strong>Aperçu avant enregistrement</strong>{evaluation ? `${evaluation.confirmedPoints}/100 points confirmés · ${evaluation.completedCount}/5 critères validés${evaluation.complete ? ' · Qualification complète' : ' · Qualification en cours'}` : 'Vérifiez le format des liens et des dates avant de calculer ce brouillon.'}</div>
      <p className="field-help">Vous pouvez enregistrer sans tout compléter. Une inconnue reste à vérifier ; elle ne vaut pas zéro. Les points et la priorité sont recalculés à l’enregistrement.</p>
    </PayloadForm></>
  </section>;
}

export function ObservationsForm({ company, today }: { company: QualifiedCompany; settings?: Settings; today: string }) {
  const storedObservations = (company.qualification ?? emptyQualification()).observations;
  const [observations, setObservations] = useState<DetailedObservations>(storedObservations);
  const storedObservationsKey = JSON.stringify(storedObservations);
  useEffect(() => setObservations(JSON.parse(storedObservationsKey) as DetailedObservations), [storedObservationsKey]);
  function changeItem(key: ManualObservationKey, patch: Partial<DetailedObservations['items'][ManualObservationKey]>) { setObservations(previous => ({ ...previous, items: { ...previous.items, [key]: { ...previous.items[key], ...patch } } })); }
  function changeExtra<K extends Exclude<keyof DetailedObservations, 'items'>>(key: K, value: DetailedObservations[K]) { setObservations(previous => ({ ...previous, [key]: value })); }
  return <section className="panel section-panel observations-block" aria-labelledby="observations-heading">
    <div className="section-title"><ClipboardList size={20} aria-hidden="true"/><div><h2 id="observations-heading">Ce que j’ai observé</h2><p className="muted">Une checklist manuelle pour garder vos constats, sans points supplémentaires.</p></div></div>
    <PayloadForm action={saveObservationsAction.bind(null, company.id)} candidateId={company.candidateId} payload={observations} submit="Enregistrer les observations" testId="observation-form">
      <p className="field-help">Renseignez seulement ce que vous avez examiné. Notes, sources et dates sont facultatives. « Non pertinent » s’utilise uniquement si l’observation ne s’applique pas.</p>
      {manualObservationKeys.map((key, index) => {
        const item = observations.items[key];
        return <div className="observation-row" id={'observation-' + key} key={key} data-testid={'observation-' + key}>
          <div className="observation-question"><span className="qual-letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span><SelectField name={'items.' + key + '.answer'} label={OBSERVATION_LABELS[key]} value={item.answer} onChange={value => changeItem(key, { answer: value as typeof item.answer })} options={OBSERVATION_OPTIONS}/></div>
          <p className="field-help">{OBSERVATION_HELP[key]}</p>
          {key === 'googleReviews' && <div className="form-grid observation-extra"><TextField name="googleReviewCount" label="Nombre d’avis Google observé (facultatif)" type="number" min={0} step={1} value={observations.googleReviewCount} onChange={value => changeExtra('googleReviewCount', value === '' ? null : Number(value))}/><TextField name="googleRating" label="Note Google affichée sur 5 (facultative)" type="number" min={0} max={5} step={0.1} value={observations.googleRating} onChange={value => changeExtra('googleRating', value === '' ? null : Number(value))}/></div>}
          {key === 'siteAge' && <div className="form-grid observation-extra"><SelectField name="siteAgeBasis" label="Sur quoi repose ce constat d’ancienneté ?" value={observations.siteAgeBasis} onChange={value => changeExtra('siteAgeBasis', value as DetailedObservations['siteAgeBasis'])} options={[{ value: 'unknown', label: 'À préciser' }, { value: 'dated_evidence', label: 'Un élément daté' }, { value: 'visual_impression', label: 'Une impression visuelle' }]}/>{observations.siteAgeBasis === 'dated_evidence' && <TextField name="siteDate" label="Date connue du site ou de son contenu" type="date" max={today} value={observations.siteDate} onChange={value => changeExtra('siteDate', value)}/>}</div>}
          {key === 'recentActivity' && <div className="observation-extra"><TextField name="recentEventOn" label="Date de l’événement observé (si connue)" type="date" max={today} value={observations.recentEventOn} onChange={value => changeExtra('recentEventOn', value)} help="À distinguer de la date à laquelle vous faites ce relevé."/></div>}
          {key === 'inactivity' && <div className="observation-extra"><TextField name="companySize" label="Taille de l’entreprise (si connue et utile)" value={observations.companySize} onChange={value => changeExtra('companySize', value)} maxLength={300} help="La taille et une éventuelle cessation sont deux informations distinctes."/></div>}
          <details className="observation-notes" open={!!(item.notes || item.sourceUrl || item.observedOn)}>
            <summary>Note, source et date (facultatives)<ChevronDown size={14} aria-hidden="true"/></summary>
            <div className="stack"><TextField name={'items.' + key + '.notes'} label={'Note · ' + OBSERVATION_LABELS[key]} value={item.notes} onChange={notes => changeItem(key, { notes })} textarea placeholder={key === 'mobile' ? 'Le défaut observé sur mobile, précisément…' : key === 'services' ? 'Information ou prestation manquante, si Non…' : key === 'recentActivity' ? 'Exemple d’activité daté et vérifiable…' : key === 'siteSatisfactory' ? 'Ce qui fonctionne pour les besoins examinés…' : 'Votre constat, en quelques mots…'}/>
              <div className="form-grid"><TextField name={'items.' + key + '.sourceUrl'} label={'Source · ' + OBSERVATION_LABELS[key]} type="url" value={item.sourceUrl} onChange={sourceUrl => changeItem(key, { sourceUrl })} maxLength={2000} placeholder="https://…"/><TextField name={'items.' + key + '.observedOn'} label={'Date du relevé · ' + OBSERVATION_LABELS[key]} type="date" max={today} value={item.observedOn} onChange={observedOn => changeItem(key, { observedOn })}/></div>
            </div>
          </details>
        </div>;
      })}
      <p className="field-help">Ces constats restent indépendants du score. Reliez-les aux cinq critères puis validez vos réponses manuellement. Une absence dans les IA reste une mesure distincte.</p>
    </PayloadForm>
  </section>;
}

function editableExchange(data: AfterExchangeData): EditableExchange {
  const { qualifiedAt: _qualifiedAt, ...editable } = data;
  return editable;
}

export function AfterExchangeForm({ company }: { company: QualifiedCompany }) {
  const stored = company.qualification ?? emptyQualification();
  const [exchange, setExchange] = useState<EditableExchange>(editableExchange(stored.afterExchange));
  const [opportunityState, opportunityDispatch, qualifying] = useActionState<ActionState, FormData>(qualifyOpportunityAction.bind(null, company.id), {});
  const storedExchangeKey = JSON.stringify(editableExchange(stored.afterExchange));
  useEffect(() => setExchange(JSON.parse(storedExchangeKey) as EditableExchange), [storedExchangeKey]);
  function change<K extends keyof EditableExchange>(key: K, value: EditableExchange[K]) { setExchange(previous => ({ ...previous, [key]: value })); }
  function choose<K extends keyof typeof AFTER_EXCHANGE_OPTIONS>(key: K, value: string) { change(key, value as EditableExchange[K]); }
  const storedEvaluation = evaluateAfterExchange(company);
  const draftEvaluation = evaluateAfterExchange({ ...company, qualification: { ...stored, afterExchange: { ...exchange, qualifiedAt: stored.afterExchange.qualifiedAt } } });
  const changed = JSON.stringify(exchange) !== JSON.stringify(editableExchange(stored.afterExchange));
  const used = JSON.stringify(editableExchange(stored.afterExchange)) !== JSON.stringify(editableExchange(emptyQualification().afterExchange));
  return <details className="panel after-exchange-block" open={used}>
    <summary><MessageSquare size={19} aria-hidden="true"/><span><strong>Après l’échange</strong><small>Le besoin reconnu et la possibilité concrète d’avancer.</small></span><ChevronDown size={16} aria-hidden="true"/></summary>
    <div className="after-exchange-body stack">
      <p className="field-help">Enregistrez les propos réellement échangés. Cette qualification ne modifie pas le score avant contact et ne crée pas un second score.</p>
      {storedEvaluation.reevaluationRequired && <p className="form-error" role="alert"><strong>Qualification à réévaluer.</strong> De nouvelles informations contredisent la qualification passée. L’étape et l’historique sont conservés.</p>}
      <PayloadForm action={saveAfterExchangeAction.bind(null, company.id)} candidateId={company.candidateId} payload={exchange} submit="Enregistrer après l’échange" testId="after-exchange-form">
        <div className="exchange-criteria">
          <section className="exchange-criterion"><SelectField name="need" label="Besoin reconnu" value={exchange.need} onChange={value => choose('need', value)} options={AFTER_EXCHANGE_OPTIONS.need}/><TextField name="needNote" label="Les propos du prospect sur son besoin" value={exchange.needNote} onChange={value => change('needNote', value)} textarea help="Une courte reformulation de ce qui a été dit."/></section>
          <section className="exchange-criterion"><SelectField name="timing" label="Priorité et calendrier" value={exchange.timing} onChange={value => choose('timing', value)} options={AFTER_EXCHANGE_OPTIONS.timing}/><TextField name="timingNote" label="Précision sur le calendrier (facultative)" value={exchange.timingNote} onChange={value => change('timingNote', value)}/><TextField name="timingDate" label="Échéance évoquée (facultative)" type="date" value={exchange.timingDate} onChange={value => change('timingDate', value)}/></section>
          <section className="exchange-criterion"><SelectField name="budget" label="Budget envisageable" value={exchange.budget} onChange={value => choose('budget', value)} options={AFTER_EXCHANGE_OPTIONS.budget}/>{(exchange.budget !== 'not_discussed' || exchange.budgetNote || exchange.budgetScope) && <><TextField name="budgetScope" label="Solution ou périmètre discuté pour ce budget" value={exchange.budgetScope} onChange={value => change('budgetScope', value)} maxLength={500}/><TextField name="budgetNote" label="Informations de budget réellement discutées" value={exchange.budgetNote} onChange={value => change('budgetNote', value)} help="Montant ou fourchette facultatifs. Un montant inconnu ne vaut pas zéro."/></>}<p className="field-help">Le budget se rapporte à la solution discutée, jamais à une taille supposée ou au nombre d’avis.</p></section>
          <section className="exchange-criterion"><SelectField name="decision" label="Décision" value={exchange.decision} onChange={value => choose('decision', value)} options={AFTER_EXCHANGE_OPTIONS.decision}/><TextField name="decisionNote" label="Personne ou chemin de décision" value={exchange.decisionNote} onChange={value => change('decisionNote', value)} help="Un nom ou une explication du processus réellement identifié."/></section>
          <section className="exchange-criterion"><SelectField name="ability" label="Capacité à avancer" value={exchange.ability} onChange={value => choose('ability', value)} options={AFTER_EXCHANGE_OPTIONS.ability}/><TextField name="abilityNote" label="Précision sur la capacité à avancer" value={exchange.abilityNote} onChange={value => change('abilityNote', value)} textarea help="Accès au site, prestataire actuel, disponibilités ou contenus. Aucun mot de passe."/>{exchange.ability === 'obstacle' && <label className="check-label"><input type="checkbox" name="obstacleBlocking" checked={exchange.obstacleBlocking} onChange={event => change('obstacleBlocking', event.target.checked)}/>Cet obstacle empêche explicitement la solution à ce stade.</label>}</section>
        </div>
        <section className="exchange-solution stack"><h3>Solution envisagée</h3><div className="form-grid"><SelectField name="solution" label="Intervention envisagée" value={exchange.solution} onChange={value => choose('solution', value)} options={AFTER_EXCHANGE_OPTIONS.solution}/><SelectField name="solutionFit" label="Adéquation de la solution au besoin" value={exchange.solutionFit} onChange={value => choose('solutionFit', value)} options={AFTER_EXCHANGE_OPTIONS.solutionFit}/></div><TextField name="solutionNote" label="Pourquoi cette solution répond au besoin" value={exchange.solutionNote} onChange={value => change('solutionNote', value)} textarea/></section>
        <section className="exchange-next-step stack"><h3>Prochaine étape convenue</h3><div className="form-grid"><TextField name="nextStep.description" label="Description de l’étape convenue" value={exchange.nextStep.description} onChange={description => change('nextStep', { ...exchange.nextStep, description })}/><TextField name="nextStep.date" label="Date convenue (facultative)" type="date" value={exchange.nextStep.date} onChange={date => change('nextStep', { ...exchange.nextStep, date })}/></div><label className="check-label"><input type="checkbox" name="nextStep.accepted" checked={exchange.nextStep.accepted} onChange={event => change('nextStep', { ...exchange.nextStep, accepted: event.target.checked })}/>Cette étape a été explicitement acceptée par l’interlocuteur.</label><p className="field-help">Une tâche interne ou un rendez-vous réservé ne suffit pas à confirmer un besoin. L’enregistrement ne crée aucune relance.</p></section>
        <div className="exchange-evaluation"><span className="field-help">Lecture du brouillon</span><strong>{draftEvaluation.label}</strong>{!!draftEvaluation.blockers.length && <ul>{draftEvaluation.blockers.map(item => <li key={item}>{item}</li>)}</ul>}{!!draftEvaluation.missing.length && <details><summary>Ce qui reste à clarifier<ChevronDown size={13} aria-hidden="true"/></summary><ul>{draftEvaluation.missing.map(item => <li key={item}>{item}</li>)}</ul></details>}{!!draftEvaluation.toVerify.length && <ul className="field-help">{draftEvaluation.toVerify.map(item => <li key={item}>{item}</li>)}</ul>}</div>
      </PayloadForm>
      {storedEvaluation.possible && company.stage !== 'Opportunité qualifiée' && <form action={opportunityDispatch} className="exchange-qualify-action"><CampaignFields/><button type="submit" className="button secondary" disabled={qualifying || changed}>{qualifying ? 'Vérification…' : 'Passer à Opportunité qualifiée'}<Check size={15} aria-hidden="true"/></button><p className="field-help">{changed ? 'Enregistrez d’abord les informations modifiées.' : 'Cette action explicite vérifie les faits enregistrés avant de changer l’étape.'}</p><Feedback state={opportunityState}/></form>}
      {company.stage === 'Opportunité qualifiée' && !storedEvaluation.reevaluationRequired && <p className="form-success"><Check size={15} aria-hidden="true"/>L’opportunité est qualifiée. Le score avant contact reste distinct.</p>}
    </div>
  </details>;
}
