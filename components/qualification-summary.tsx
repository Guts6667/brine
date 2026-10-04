import { ArrowUpRight, ChevronDown, CircleAlert, Check } from 'lucide-react';
import { formatDate } from '@/lib/domain';
import { evaluateQualification, emptyQualification, OBSERVATION_OPTIONS } from '@/lib/qualification';
import type { Company, Settings } from '@/lib/types';
import type { CriterionEvaluation, QualificationData, QualificationEvaluation, ManualObservationKey } from '@/lib/qualification-types';

type Props = { company: Company & { qualification?: QualificationData }; settings: Settings; today: string; contactDecision?:string };
const criterionNames = { fit: 'Adéquation à la cible', problem: 'Problème concret', trigger: 'Déclencheur pertinent', references: 'Réalisations à valoriser', access: 'Bon interlocuteur' };

function SourceLink({ url, label = 'Consulter la source' }: { url: string; label?: string }) {
  if (!/^https?:\/\//i.test(url)) return <p className="qual-evidence-text">{url}</p>;
  return <a className="open-link" href={url} target="_blank" rel="noopener noreferrer">{label}<ArrowUpRight size={13} aria-hidden="true"/></a>;
}

export function QualificationScore({ evaluation, compact = false }: { evaluation: QualificationEvaluation; compact?: boolean }) {
  return <div className={compact ? 'score-cell-value' : 'qual-score-value'}>
    <strong>{evaluation.score ?? evaluation.confirmedPoints}<span className="qual-score-scale">/100</span></strong>
    <span className="qual-score-caption">{evaluation.complete ? 'Qualification complète · 5/5 critères validés' : `Points confirmés · Qualification en cours · ${evaluation.completedCount}/5 critères validés`}</span>
    {evaluation.priority && <span className="qual-priority">{evaluation.priority}</span>}
  </div>;
}

export function ScoreCell({ company, settings, today,contactDecision }: Props) {
  const evaluation = evaluateQualification(company, settings, today);
  return <div className="score-cell">
    <QualificationScore evaluation={evaluation} compact/>
    <span className={`badge ${evaluation.decision === 'Prêt à contacter' ? 'badge-good' : evaluation.decision === 'Ne plus contacter' ? 'badge-blocked' : ''}`}>{evaluation.decision}</span>
    {evaluation.targetNeedsRevalidation && <span className="score-cell-alert">Adéquation à revérifier</span>}
    {evaluation.triggerNeedsReverification && <span className="score-cell-alert">Déclencheur à revérifier</span>}
    {company.readiness && contactDecision && <span className="score-cell-alert">Contact : {contactDecision}</span>}
  </div>;
}

function ObservationExtra({ observationKey, qualification }: { observationKey: ManualObservationKey; qualification: QualificationData }) {
  const observations = qualification.observations;
  if (observationKey === 'siteAge') return <>
    {observations.siteAgeBasis === 'visual_impression' && <p className="field-help">Ancienneté : impression visuelle enregistrée.</p>}
    {observations.siteAgeBasis === 'dated_evidence' && <p className="field-help">Ancienneté : élément daté{observations.siteDate ? ` du ${formatDate(observations.siteDate)}` : ', date à préciser'}.</p>}
  </>;
  if (observationKey === 'googleReviews') return <>
    {observations.googleReviewCount !== null && <p className="field-help">Nombre d’avis observé : {observations.googleReviewCount}.</p>}
    {observations.googleRating !== null && <p className="field-help">Note affichée : {observations.googleRating}/5.</p>}
  </>;
  if (observationKey === 'recentActivity' && observations.recentEventOn) return <p className="field-help">Date de l’événement : {formatDate(observations.recentEventOn)}.</p>;
  if (observationKey === 'inactivity' && observations.companySize) return <p className="field-help">Taille renseignée : {observations.companySize}.</p>;
  return null;
}

function CriterionEvidence({ criterion, qualification, company }: { criterion: CriterionEvaluation; qualification: QualificationData; company: Props['company'] }) {
  const answers = qualification.answers;
  return <div className="qual-evidence stack">
    {criterion.key === 'fit' && answers.fit.note && <p className="qual-evidence-text">{answers.fit.note}</p>}
    {criterion.key === 'problem' && <>
      {answers.problem.description && <p className="qual-evidence-text">{answers.problem.description}</p>}
      {answers.problem.majorReason === 'multiple' && answers.problem.distinctProblems.some(Boolean) && <ul>{answers.problem.distinctProblems.filter(Boolean).map((problem, index) => <li key={index}>{problem}</li>)}</ul>}
      {answers.problem.majorReason === 'blocking' && answers.problem.blockingExplanation && <p className="qual-evidence-text"><strong>Blocage important :</strong> {answers.problem.blockingExplanation}</p>}
      {answers.problem.observedOn && <p className="field-help">Observé le {formatDate(answers.problem.observedOn)}.</p>}
      {answers.problem.proofUrl && <SourceLink url={answers.problem.proofUrl} label="Consulter la preuve du problème"/>}
    </>}
    {criterion.key === 'trigger' && <>
      {answers.trigger.description && <p className="qual-evidence-text">{answers.trigger.description}</p>}
      {answers.trigger.relevance && <p className="qual-evidence-text"><strong>Lien avec l’intervention :</strong> {answers.trigger.relevance}</p>}
      {answers.trigger.source && <div><span className="field-help">Origine de l’information</span><SourceLink url={answers.trigger.source}/></div>}
      {(answers.trigger.eventOn || answers.trigger.verifiedOn) && <p className="field-help">{answers.trigger.eventOn && `Événement du ${formatDate(answers.trigger.eventOn)}.`} {answers.trigger.verifiedOn && `Vérifié le ${formatDate(answers.trigger.verifiedOn)}.`}</p>}
    </>}
    {criterion.key === 'references' && <>
      {answers.references.examples.some(Boolean) && <ul>{answers.references.examples.filter(Boolean).map((example, index) => <li key={index}>{example}</li>)}</ul>}
      {answers.references.improvement && <p className="qual-evidence-text"><strong>À mieux présenter :</strong> {answers.references.improvement}</p>}
      {answers.references.sourceUrl && <SourceLink url={answers.references.sourceUrl}/>}</>}
    {criterion.key === 'access' && <>
      {(company.contact.name || company.contact.role) && <p className="qual-evidence-text">{[company.contact.name, company.contact.role].filter(Boolean).join(' · ')}</p>}
      {(company.contact.email || company.contact.phone) && <p className="qual-evidence-text">{[company.contact.email, company.contact.phone].filter(Boolean).join(' · ')}</p>}
      {company.contact.formUrl && <SourceLink url={company.contact.formUrl} label="Formulaire professionnel"/>}
      {company.contact.profileUrl && <SourceLink url={company.contact.profileUrl} label="Profil professionnel"/>}
      {answers.access.channelAssociation && <p className="qual-evidence-text">{answers.access.channelAssociation}</p>}
    </>}
    {!!criterion.linkedObservations.length && <div className="qual-linked-evidence"><h4>Observations reliées manuellement</h4>{criterion.linkedObservations.map(({ key, label, observation }) => <div key={key} className="qual-linked-observation">
      <strong>{label}</strong><span className="field-help">{OBSERVATION_OPTIONS.find(option => option.value === observation.answer)?.label ?? observation.answer}</span>
      {observation.notes && <p className="qual-evidence-text">{observation.notes}</p>}
      <ObservationExtra observationKey={key} qualification={qualification}/>
      {observation.observedOn && <p className="field-help">Observation du {formatDate(observation.observedOn)}.</p>}
      {observation.sourceUrl && <SourceLink url={observation.sourceUrl}/>}</div>)}</div>}
  </div>;
}

export function QualificationSummary({ company, settings, today, contactDecision, criteriaHref = '' }: Props & { criteriaHref?: string }) {
  const qualification = company.qualification ?? emptyQualification();
  const evaluation = evaluateQualification(company, settings, today);
  const usesPreparation = Boolean(company.readiness && contactDecision);
  const decision = usesPreparation ? contactDecision! : evaluation.decision;
  return <section className="qual-overview panel" aria-label="Résumé de la qualification" data-testid="qualification-summary">
    <div className="qual-overview-top">
      <div className="qual-score"><span className="eyebrow">Score de qualification</span><QualificationScore evaluation={evaluation}/><div className="qual-completion" role="progressbar" aria-label="Critères validés" aria-valuenow={evaluation.completedCount} aria-valuemin={0} aria-valuemax={5}>{evaluation.criteria.map(criterion => <span key={criterion.key} className={criterion.complete ? 'complete' : ''}/>)}</div></div>
      <div className="qual-overview-decision">
        <span className={`badge ${decision === 'Prêt à contacter' ? 'badge-good' : decision === 'Ne plus contacter' ? 'badge-blocked' : ''}`}>{decision === 'Prêt à contacter' ? <Check size={13} aria-hidden="true"/> : <CircleAlert size={13} aria-hidden="true"/>}{decision}</span>
        {usesPreparation && <p className="qual-next-information">Les confirmations de la cible, du motif et du contact complètent vos cinq critères. La validation du prospect reste votre décision.</p>}
        <>
          {!!evaluation.reasons.length && <ul className="qual-main-reasons">{evaluation.reasons.slice(0, 3).map(reason => <li key={reason}>{reason}</li>)}</ul>}
          <p className="qual-next-information"><strong>{evaluation.decision === 'Prêt à contacter' ? 'Prochaine possibilité' : 'Prochaine information à vérifier'}</strong>{evaluation.nextInformation}</p>
        </>
      </div>
    </div>
    <nav className="qual-criteria-overview" aria-label="Les cinq critères de qualification">{evaluation.criteria.map((criterion, index) => <a key={criterion.key} href={criteriaHref + '#qualification-criterion-' + criterion.key}><span className="qual-letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span><span>{criterionNames[criterion.key]}<small>{criterion.complete ? 'Validé' : 'À vérifier ou compléter'}</small></span><strong>{criterion.complete ? criterion.points : '—'}<small>/{criterion.maxPoints}</small></strong></a>)}</nav>
    {!!evaluation.warnings.length && <div className="qual-summary-notice">{evaluation.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
    {!!company.qualificationEnrichment?.revalidate?.length && <div className="qual-summary-notice"><strong>Nouvelle analyse disponible.</strong> Vos réponses sont conservées. Revérifiez les critères signalés dans la fiche.</div>}
    <details className="qual-score-details">
      <summary>Pourquoi ce score ?<ChevronDown size={15} aria-hidden="true"/></summary>
      <div className="qual-score-details-body">
        {!!evaluation.blockers.length && <div className="qual-summary-notice"><strong>À vérifier avant le contact</strong><ul>{evaluation.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
        <p className="field-help">{evaluation.complete ? 'Les cinq critères sont complets. Le total additionne leurs points.' : 'Seuls les critères complets apportent des points confirmés. Le total reste en brouillon, sans priorité définitive.'}</p>
        {evaluation.criteria.map((criterion, index) => <section className="qual-criterion-detail" key={criterion.key}>
          <div className="qual-detail-heading"><h3><span className="qual-letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span>{criterion.label}</h3><strong>{criterion.complete ? `${criterion.points}/${criterion.maxPoints} points` : criterion.answerLabel === 'À vérifier' ? 'À vérifier' : 'À compléter'}</strong></div>
          <p className="qual-answer-label">{criterion.answerLabel}</p>
          <CriterionEvidence criterion={criterion} qualification={qualification} company={company}/>
          {!!criterion.missing.length && <ul className="qual-missing-list">{criterion.missing.map(item => <li key={item}>{item}</li>)}</ul>}
        </section>)}
        {!!evaluation.missing.length && <div className="qual-summary-notice"><strong>Informations restant à vérifier</strong><ul>{evaluation.missing.map(item => <li key={item}>{item}</li>)}</ul></div>}
        <p className="field-help">Barème Brine V1 : une convention de priorité interne, pas une probabilité d’achat. Le score ne prouve ni le budget, ni un besoin reconnu, ni une perte de clients. Les relevés IA restent séparés.</p>
      </div>
    </details>
  </section>;
}
