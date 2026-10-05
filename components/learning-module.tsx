'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock3, Copy, Download, FileText, RotateCcw } from 'lucide-react';
import { LEARNING_MODULES, LEARNING_STEPS, learningCampaignHref, learningModule } from '@/lib/learning-curriculum';
import { CRITERION_EVIDENCE, CRITERION_EXPECTED, CRITERION_NAMES, CRITERION_ORDER, EMAIL_CHECKS, EMAIL_QUESTION, EXCHANGE_QUESTION, FOLLOWUP_QUESTIONS, OCCASION_QUESTIONS, TARGET_QUESTION, TEACHING_EMAIL, emailWordCount, exerciseReady, questionFeedback, teachingExchange, teachingQualification, teachingSequence, type ExerciseAnswers } from '@/lib/learning-exercises';
import { QUALIFICATION_RULES } from '@/lib/qualification';
import type { LearningAnswers, LearningCampaignOption, LearningJson, LearningModuleId, LearningProgress, LearningStep } from '@/lib/learning-types';
import { LearningFeedback, LearningQuestion, LearningSafety, LearningSaveStatus, TeachingCapture, useLearningSession } from './learning-shared';

type ExerciseProps = { answers: LearningAnswers; change: (key: string, value: LearningJson) => void };

function QuizSequence({ moduleId, answers, change }: ExerciseProps & { moduleId: 'occasion' | 'suivi' }) {
  const questions = moduleId === 'occasion' ? OCCASION_QUESTIONS : FOLLOWUP_QUESTIONS;
  const index = Math.min(Math.max(Number(answers.exerciseIndex) || 0, 0), questions.length - 1);
  const question = questions[index];
  const good = questionFeedback(question, answers[question.key])?.correct;
  const sequence = teachingSequence(index === 0 ? 'not_sent' : index === 1 ? 'no_response' : index === 2 ? 'not_interested' : index === 3 ? 'opposition' : 'conversation');
  return <><div className="learn-exercise-counter">{moduleId === 'occasion' ? 'Entreprise' : 'Situation'} {index + 1}/{questions.length}</div>
    {moduleId === 'occasion' && index !== 1 && <TeachingCapture satisfactory={index === 2}/>}
    <LearningQuestion key={question.key} question={question} value={answers[question.key]} onChange={value => change(question.key, value)}/>
    {moduleId === 'suivi' && <div className="learn-sequence"><strong>Suivi de cette simulation</strong>{sequence.state === 'not_started' ? <p>Pas encore de contact enregistré : aucune date de relance.</p> : sequence.state === 'stopped' ? <p><Check size={16} aria-hidden="true"/>Séquence interrompue{index === 3 ? ' · opposition : ne plus contacter' : index === 2 ? ' · refus enregistré' : ' · réponse reçue'}.</p> : <ol>{sequence.steps.map(step => <li key={step.label}><strong>{step.label}</strong><span>{step.date.split('-').reverse().join('/')}</span></li>)}</ol>}</div>}
    <div className="learn-exercise-nav">{index > 0 && <button className="learn-button learn-button-quiet" type="button" onClick={() => change('exerciseIndex', index - 1)}><ArrowLeft size={16} aria-hidden="true"/>Précédent</button>}{index < questions.length - 1 && <button className="learn-button" type="button" disabled={!good} onClick={() => change('exerciseIndex', index + 1)}>{moduleId === 'occasion' ? 'Entreprise suivante' : 'Situation suivante'}<ArrowRight size={16} aria-hidden="true"/></button>}</div>
  </>;
}

function QualificationPractice({ answers, change }: ExerciseProps) {
  const index = Math.min(Math.max(Number(answers.qualificationIndex) || 0, 0), 6);
  const { evaluation } = teachingQualification(answers);
  const key = CRITERION_ORDER[index - 1];
  const [attempt, setAttempt] = useState('');
  const criteria = evaluation.criteria;
  return <><div className="learn-sandbox-heading"><span className="learn-kicker">ATELIER SILLAGE · ENTREPRISE FICTIVE</span><span>Rénovation · Montpellier</span></div>
    <div className="learn-sandbox-score" data-testid="learning-qualification-score"><div><span>Score de qualification</span><strong>{evaluation.score ?? evaluation.confirmedPoints}<small>/100</small></strong></div><div><strong>{evaluation.complete ? 'Qualification complète · 5/5 critères validés' : `Qualification en cours · ${evaluation.completedCount}/5 critères validés`}</strong><p>{evaluation.priority || 'Une inconnue reste à vérifier, pas à zéro.'}</p><div className="learn-score-dots" aria-hidden="true">{criteria.map(criterion => <span key={criterion.key} className={criterion.complete ? 'done' : ''}/>)}</div></div></div>
    <nav className="learn-criterion-tabs" aria-label="Critères de cette simulation">{criteria.map((criterion, i) => <button key={criterion.key} type="button" onClick={() => { change('qualificationIndex', i + 1); setAttempt(''); }} aria-current={index === i + 1 ? 'step' : undefined}><span>{CRITERION_NAMES[criterion.key]}</span><strong>{criterion.complete ? criterion.points : '—'}<small>/{criterion.maxPoints}</small></strong></button>)}</nav>
    {index === 0 ? <div className="learn-proof-practice"><span className="learn-exercise-counter">1. Vérifier le constat</span><h3>Le bouton masque la photo sur mobile.</h3><div className="learn-proof-layout"><TeachingCapture/><div><p>{CRITERION_EVIDENCE.problem}</p><p className="learn-source">Preuve pédagogique inventée pour l’exercice. Aucun site réel n’a été analysé.</p><div className="learn-actions"><button className="learn-button learn-button-dark" type="button" onClick={() => change('proof', 'confirmed')}><Check size={17} aria-hidden="true"/>Confirmer le constat</button><button className="learn-button learn-button-quiet" type="button" onClick={() => change('proof', 'rejected')}>Rejeter</button></div>{answers.proof && <LearningFeedback good={answers.proof === 'confirmed'}>{answers.proof === 'confirmed' ? 'Le constat est confirmé. Regarde le score : aucun point de critère n’a été attribué par cette action. Les réponses acceptées précédemment, s’il y en a, restent conservées.' : 'Dans cette illustration, le défaut est bien visible. Le rejet ne donne pas de points. Relis la preuve avant de reprendre.'}</LearningFeedback>}</div></div><button className="learn-button" type="button" disabled={answers.proof !== 'confirmed'} onClick={() => change('qualificationIndex', 1)}>Passer aux critères<ArrowRight size={17} aria-hidden="true"/></button></div>
      : index <= 5 ? <div className="learn-criterion-practice" key={key}><span className="learn-exercise-counter">Critère {index}/5 · {CRITERION_NAMES[key]}</span><h3>{QUALIFICATION_RULES.criteria[key].label}</h3><div className="learn-source"><strong>Justification et source pédagogiques</strong><p>{CRITERION_EVIDENCE[key]}</p></div><fieldset><legend>Choisis une réponse, puis accepte-la explicitement.</legend><div className="learn-choices">{QUALIFICATION_RULES.criteria[key].options.map(option => <label className={`learn-choice ${answers[`proposal_${key}`] === option.value ? 'selected' : ''}`} key={option.value}><input type="radio" name={`criterion-${key}`} value={option.value} checked={answers[`proposal_${key}`] === option.value} onChange={() => { change(`proposal_${key}`, option.value); setAttempt(''); }}/><span>{option.label}</span><small>{option.points === null ? 'À vérifier' : `${option.points} pts`}</small></label>)}</div></fieldset><button className="learn-button learn-button-dark" type="button" disabled={!answers[`proposal_${key}`]} onClick={() => {
        if (answers[`proposal_${key}`] !== CRITERION_EXPECTED[key]) { setAttempt(answers[`proposal_${key}`] === 'unknown' ? 'Dans une vraie fiche, cette réponse conserve le critère incomplet. Ici, la preuve pédagogique permet de répondre : relis-la avant de choisir.' : key === 'problem' ? 'Un seul défaut est documenté. Aucun blocage important n’est démontré : choisis « Un problème concret vérifié ».' : key === 'trigger' ? 'La recherche pédagogique a été faite et aucun déclencheur trouvé : cela valide une réponse à zéro, distincte d’une inconnue.' : 'Cette réponse ne correspond pas aux informations du cas. Reprends la justification avant de l’accepter.'); return; }
        change(key, CRITERION_EXPECTED[key]); setAttempt('');
      }}>Accepter la réponse et ses points<Check size={17} aria-hidden="true"/></button>{attempt && <LearningFeedback good={false}>{attempt}</LearningFeedback>}{answers[key] === CRITERION_EXPECTED[key] && !attempt && <LearningFeedback good>Réponse acceptée : {criteria[index - 1].points} points confirmés. Le total est recalculé avec l’évaluateur habituel de Brine. Tu peux modifier ton choix et relire la preuve.</LearningFeedback>}<div className="learn-exercise-nav"><button className="learn-button learn-button-quiet" type="button" onClick={() => { change('qualificationIndex', index - 1); setAttempt(''); }}><ArrowLeft size={16} aria-hidden="true"/>Précédent</button><button className="learn-button" type="button" disabled={answers[key] !== CRITERION_EXPECTED[key] || Boolean(attempt)} onClick={() => { change('qualificationIndex', index + 1); setAttempt(''); }}>{index === 5 ? 'Décider pour ce prospect' : 'Critère suivant'}<ArrowRight size={16} aria-hidden="true"/></button></div></div>
        : <div><span className="learn-exercise-counter">Ta décision reste distincte du score</span><h3>Que choisis-tu pour Atelier Sillage ?</h3><p>Le dossier est complet : {evaluation.score}/100, {evaluation.priority?.toLowerCase()}. Ce score aide à prioriser ; il ne prouve pas un besoin d’achat.</p><fieldset><legend>Tu gardes la main sur la validation.</legend><div className="learn-choices">{[{ value: 'keep', label: 'Valider le prospect pour préparer une approche' }, { value: 'later', label: 'Garder pour plus tard' }, { value: 'reject', label: 'Écarter ce prospect' }].map(choice => <label className={`learn-choice ${answers.decision === choice.value ? 'selected' : ''}`} key={choice.value}><input type="radio" name="prospect-decision" checked={answers.decision === choice.value} onChange={() => change('decision', choice.value)}/><span>{choice.label}</span></label>)}</div></fieldset>{answers.decision && <LearningFeedback good>Décision enregistrée dans l’exercice uniquement. {answers.decision === 'keep' ? 'Tu peux préparer une approche liée au défaut confirmé, sans présumer un projet de refonte.' : 'La note ne t’oblige pas à contacter cette entreprise. Conserve le motif de ta décision dans une vraie fiche.'}</LearningFeedback>}<button className="learn-button learn-button-quiet" type="button" onClick={() => change('qualificationIndex', 5)}><ArrowLeft size={16} aria-hidden="true"/>Revoir les critères</button></div>}
  </>;
}

function EmailPractice({ answers, change }: ExerciseProps) {
  const [copyState, setCopyState] = useState('');
  const index = Number(answers.exerciseIndex) === 1 ? 1 : 0;
  const text = typeof answers.emailText === 'string' ? answers.emailText : '';
  const count = emailWordCount(text);
  return index === 0 ? <><LearningQuestion question={EMAIL_QUESTION} value={answers.emailChoice} onChange={value => change('emailChoice', value)}/><div className="learn-exercise-nav"><button className="learn-button" type="button" disabled={answers.emailChoice !== 'useful'} onClick={() => { if (!text) change('emailText', TEACHING_EMAIL); change('exerciseIndex', 1); }}>Préparer mon email d’essai<ArrowRight size={16} aria-hidden="true"/></button></div></>
    : <><span className="learn-exercise-counter">ATELIER SILLAGE · EMAIL D’ENTRAÎNEMENT</span><div className="learn-email-evidence"><span className="learn-finding-badge"><FileText size={15} aria-hidden="true"/>Constat confirmé dans le cas fictif</span><p>Sur la page Réalisations à 390 px, le bouton Contact masque une photo avant/après. Une amélioration ciblée de la galerie peut être proposée.</p></div><div className="learn-email-header"><label htmlFor="learn-email-text">Ton premier email</label><span className={count > 120 ? 'learn-over-limit' : ''}>{count}/120 mots</span></div><textarea id="learn-email-text" className="learn-email-text" value={text} onChange={event => { change('emailText', event.target.value); setCopyState(''); }} maxLength={12000} aria-describedby="learn-email-count"/><p id="learn-email-count" className="learn-source">{count > 120 ? 'Réduis ton message avant de terminer l’exercice.' : 'Relis le texte avec la checklist. Aucun outil ne juge sa qualité commerciale à ta place.'}</p><fieldset className="learn-review-checks"><legend>Ma relecture</legend>{EMAIL_CHECKS.map(check => <label className="learn-check" key={check.key}><input type="checkbox" checked={answers[check.key] === true} onChange={event => change(check.key, event.target.checked)}/><span>{check.label}</span></label>)}</fieldset><div className="learn-actions"><button className="learn-button" type="button" disabled={!count || count > 120} onClick={async () => { try { await navigator.clipboard.writeText(text); setCopyState('Email d’essai copié. Aucun contact n’a été enregistré ni envoyé.'); } catch { setCopyState('La copie n’est pas disponible. Tu peux sélectionner le texte dans le champ.'); } }}><Copy size={17} aria-hidden="true"/>Copier cet email d’essai</button><button className="learn-button learn-button-quiet" type="button" onClick={() => change('exerciseIndex', 0)}>Revoir les exemples</button></div>{copyState && <p className="learn-source" role="status">{copyState}</p>}<details className="learn-extra"><summary><FileText size={18} aria-hidden="true"/>Un bilan PDF en complément, si utile</summary><div><p>Le bilan partage un point positif, jusqu’à trois constats confirmés et des améliorations utiles. Il ne contient ni score interne ni notes personnelles.</p><a className="learn-button" href="/api/learning/example-brief" target="_blank" rel="noopener noreferrer"><Download size={17} aria-hidden="true"/>Voir l’exemple fictif de deux pages</a><p className="learn-source">PDF pédagogique « Pickles Studio — par Brine ». L’ouverture ne déclenche aucune collecte ni IA. Pour un prospect réel, tu choisis les points et relis le bilan avant de générer le PDF à ta demande.</p></div></details><details className="learn-extra"><summary>L’appel, une alternative facultative</summary><p>« Bonjour, je suis Rayan de Pickles Studio. J’ai remarqué qu’un bouton masque une photo dans votre galerie sur téléphone. Est-ce un sujet que vous souhaitez regarder ? » Présente le constat calmement, puis laisse la place à la réponse.</p></details></>;
}

function ExchangePractice({ answers, change }: ExerciseProps) {
  const index = Number(answers.exerciseIndex) === 1 ? 1 : 0;
  const evaluation = teachingExchange(answers);
  return index === 0 ? <><LearningQuestion question={EXCHANGE_QUESTION} value={answers.openQuestion} onChange={value => change('openQuestion', value)}/><button className="learn-button" type="button" disabled={answers.openQuestion !== 'open'} onClick={() => change('exerciseIndex', 1)}>Écouter la réponse fictive<ArrowRight size={16} aria-hidden="true"/></button></>
    : <><span className="learn-exercise-counter">UNE RÉPONSE · DES INFORMATIONS À DISTINGUER</span><blockquote className="learn-example-quote">« Les clients nous disent que la galerie est difficile à lire sur téléphone. Je gère le site. Envoyez-moi vos deux pistes, je les lirai vendredi. »<cite>Interlocutrice fictive · Atelier Sillage</cite></blockquote><fieldset><legend>Que peux-tu documenter à partir de cette réponse ?</legend>{[{ key: 'need', label: 'Besoin confirmé : améliorer la lecture de la galerie sur téléphone.' }, { key: 'solution', label: 'Intervention pertinente : deux pistes d’amélioration ciblée.' }, { key: 'decision', label: 'Chemin de décision : l’interlocutrice dit gérer le site.' }, { key: 'nextStep', label: 'Prochaine étape acceptée : envoyer deux pistes, à lire vendredi.' }, { key: 'budgetUnknown', label: 'Budget : non abordé, donc à clarifier.' }].map(item => <label className="learn-check" key={item.key}><input type="checkbox" checked={answers[item.key] === true} onChange={event => change(item.key, event.target.checked)}/><span>{item.label}</span></label>)}</fieldset><div className="learn-exchange-status"><strong>{evaluation.label}</strong><p>{evaluation.possible ? 'Les quatre informations nécessaires sont documentées dans la simulation. Le budget et le calendrier restent à clarifier ; aucun statut réel n’est modifié.' : 'L’évaluateur habituel attend les informations manquantes. Les inconnues restent visibles.'}</p>{evaluation.missing.length > 0 && <ul>{evaluation.missing.map(item => <li key={item}>{item}</li>)}</ul>}{evaluation.toVerify.length > 0 && <details><summary>Ce qui reste à clarifier</summary><ul>{evaluation.toVerify.map(item => <li key={item}>{item}</li>)}</ul></details>}</div><label className="learn-input-label" htmlFor="learn-reformulation">Reformule le besoin et la suite en une ou deux phrases.</label><textarea id="learn-reformulation" value={typeof answers.reformulation === 'string' ? answers.reformulation : ''} onChange={event => change('reformulation', event.target.value)} maxLength={4000} rows={4} placeholder="Vous souhaitez rendre la galerie plus lisible sur téléphone…"/><label className="learn-check"><input type="checkbox" checked={answers.reformulationReviewed === true} onChange={event => change('reformulationReviewed', event.target.checked)}/><span>J’ai relu : ma reformulation respecte les propos, propose la suite acceptée et ne présume ni budget ni refonte complète.</span></label><p className="learn-source">Cette relecture est la tienne. Aucune IA n’évalue ton texte.</p></>;
}

function Exercise({ moduleId, answers, change }: ExerciseProps & { moduleId: LearningModuleId }) {
  if (moduleId === 'cible') return <><LearningQuestion question={TARGET_QUESTION} value={answers.target} onChange={value => change('target', value)}/><details className="learn-extra"><summary>Noter une cible pour ma prochaine campagne</summary><div><label htmlFor="learn-own-target">Mon activité, ma zone et mon point à vérifier (facultatif)</label><textarea id="learn-own-target" rows={3} maxLength={2000} value={typeof answers.ownTarget === 'string' ? answers.ownTarget : ''} onChange={event => change('ownTarget', event.target.value)} placeholder="Ex. entreprises de rénovation à Montpellier, galerie mobile à vérifier"/><p className="learn-source">Brouillon d’exercice. Aucune campagne n’est créée par cette saisie.</p></div></details></>;
  if (moduleId === 'occasion' || moduleId === 'suivi') return <QuizSequence moduleId={moduleId} answers={answers} change={change}/>;
  if (moduleId === 'qualification') return <QualificationPractice answers={answers} change={change}/>;
  if (moduleId === 'email') return <EmailPractice answers={answers} change={change}/>;
  return <ExchangePractice answers={answers} change={change}/>;
}

export function LearningModule({ moduleId, progress: initial, campaigns }: { moduleId: LearningModuleId; progress: LearningProgress; campaigns: LearningCampaignOption[] }) {
  const session = useLearningSession(initial);
  const router = useRouter();
  const module = learningModule(moduleId)!;
  const moduleIndex = LEARNING_MODULES.indexOf(module);
  const [step, setStep] = useState<LearningStep>(initial.currentModule === moduleId ? initial.currentStep : 'understand');
  const [answers, setAnswers] = useState<LearningAnswers>(initial.answers[moduleId] || {});
  const [campaignId, setCampaignId] = useState(initial.campaignId || '');
  const [moving, setMoving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const answersRef = useRef(answers); answersRef.current = answers;
  const savedAnswers = useRef(JSON.stringify(answers));
  const saveRef = useRef(session.save); saveRef.current = session.save;
  const visited = useRef(false);
  const stepIndex = LEARNING_STEPS.findIndex(item => item.id === step);
  const ready = exerciseReady(moduleId, answers as ExerciseAnswers);
  function change(key: string, value: LearningJson) {
    setDirty(true);
    setAnswers(current => ({ ...current, ...(key === 'emailText' ? Object.fromEntries(EMAIL_CHECKS.map(check => [check.key, false])) : key === 'reformulation' ? { reformulationReviewed: false } : {}), [key]: value }));
  }
  useEffect(() => {
    if (!visited.current) { visited.current = true; if (initial.currentModule !== moduleId) void saveRef.current({ operation: 'visit', moduleId, step: 'understand' }); }
  }, [initial.currentModule, moduleId]);
  useEffect(() => {
    const snapshot = JSON.stringify(answers);
    if (snapshot === savedAnswers.current) return;
    const timer = setTimeout(async () => {
      if (await saveRef.current({ operation: 'answers', moduleId, answers })) { savedAnswers.current = snapshot; if (JSON.stringify(answersRef.current) === snapshot) setDirty(false); }
    }, 500);
    return () => clearTimeout(timer);
  }, [answers, moduleId]);
  async function persistDraft() {
    const snapshot = JSON.stringify(answersRef.current);
    if (snapshot === savedAnswers.current) return true;
    if (!await session.save({ operation: 'answers', moduleId, answers: answersRef.current })) return false;
    savedAnswers.current = snapshot; setDirty(false); return true;
  }
  const leaveRef = useRef(async () => true);
  leaveRef.current = async () => await persistDraft() && await session.flush();
  useEffect(() => {
    function protectClose(event: BeforeUnloadEvent) { if (dirty || session.saving) { event.preventDefault(); event.returnValue = ''; } }
    function protectNavigation(event: MouseEvent) {
      if ((!dirty && !session.saving && !session.error) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.hash || url.pathname.startsWith('/api/')) return;
      event.preventDefault(); event.stopPropagation();
      void leaveRef.current().then(saved => { if (saved) router.push(url.pathname + url.search); });
    }
    window.addEventListener('beforeunload', protectClose);
    document.addEventListener('click', protectNavigation, true);
    return () => { window.removeEventListener('beforeunload', protectClose); document.removeEventListener('click', protectNavigation, true); };
  }, [dirty, session.saving, session.error, router]);
  async function go(next: LearningStep, complete = false) {
    if (moving) return;
    setMoving(true);
    try {
      if (!await persistDraft()) return;
      if (complete && !await session.save({ operation: 'complete', moduleId })) return;
      if (!await session.save({ operation: 'visit', moduleId, step: next })) return;
      setStep(next);
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'start' });
    } finally { setMoving(false); }
  }
  async function apply() {
    if (!campaignId || moving) return;
    setMoving(true);
    try { if (!await persistDraft()) return; if (!await session.save({ operation: 'campaign', campaignId })) return; if (!await session.save({ operation: 'guide', guideOpen: true })) return; router.push(learningCampaignHref(moduleId, campaignId)); }
    finally { setMoving(false); }
  }
  const disabled = moving || Boolean(session.error);
  return <div className="learning learn-lesson">
    <div className="learn-lesson-top"><Link className="learn-text-link" href="/apprendre"><ArrowLeft size={17} aria-hidden="true"/>Le parcours</Link><span><Clock3 size={16} aria-hidden="true"/>{module.duration} · essais illimités</span></div>
    <header className="learn-lesson-heading"><span className="learn-kicker">MODULE {moduleIndex + 1}/6</span><h1>{module.title}</h1><p>{module.goal}</p></header>
    <nav className="learn-stepper" aria-label="Étapes du module">{LEARNING_STEPS.map((item, index) => <span key={item.id} className={index === stepIndex ? 'current' : index < stepIndex ? 'passed' : ''} aria-label={item.label} aria-current={index === stepIndex ? 'step' : undefined}><span className="learn-step-number">{index < stepIndex ? <Check size={13} aria-hidden="true"/> : index + 1}</span><span className="learn-step-label">{item.label}</span></span>)}</nav>
    <LearningSafety/>
    <section className="learn-stage" aria-labelledby="learn-stage-title"><span className="learn-kicker">{LEARNING_STEPS[stepIndex].label.toUpperCase()}</span><h2 id="learn-stage-title" ref={heading} tabIndex={-1}>{step === 'understand' ? module.principle : step === 'example' ? module.example.title : step === 'practice' ? 'À toi d’essayer.' : step === 'feedback' ? 'Ce que tu peux retenir.' : 'Appliquer à ta campagne.'}</h2>
      {step === 'understand' && <><p className="learn-stage-intro">{module.explanation}</p><details className="learn-extra"><summary>Les repères à garder en tête</summary><ul>{module.essentials.map(item => <li key={item}>{item}</li>)}</ul></details><div className="learn-offer"><span>TON OFFRE EST DÉJÀ RENSEIGNÉE</span><strong>Pickles Studio</strong><p>Sites · refontes · améliorations UX/UI · applications</p></div></>}
      {step === 'example' && <><blockquote className="learn-example-quote">{module.example.text}<cite>Exemple pédagogique · entreprise fictive</cite></blockquote><div className="learn-takeaway"><Check size={20} aria-hidden="true"/><p>{module.example.takeaway}</p></div>{moduleId === 'occasion' && <TeachingCapture/>}</>}
      {step === 'practice' && <Exercise moduleId={moduleId} answers={answers} change={change}/>}
      {step === 'feedback' && <><LearningFeedback good={ready}>{ready ? 'L’exercice est terminé. Tu peux recommencer librement ou passer à une campagne réelle.' : 'Quelques réponses restent à revoir. Reprends l’exercice ; tes saisies sont conservées.'}</LearningFeedback><ul className="learn-retain">{module.essentials.map(item => <li key={item}><Check size={17} aria-hidden="true"/>{item}</li>)}</ul><div className="learn-takeaway"><strong>Dans Brine</strong><p>{module.apply.action}</p></div>{moduleId === 'email' && <p className="learn-source">La checklist est une auto-relecture. Aucune note de qualité commerciale n’a été attribuée à ton texte.</p>}</>}
      {step === 'apply' && <><div className="learn-completed"><Check size={22} aria-hidden="true"/><div><strong>Module terminé</strong><p>{session.progress.completedModules.length}/6 modules terminés · les exercices restent rejouables.</p></div></div><p className="learn-stage-intro">{module.apply.action}</p><div className="learn-success"><strong>Tu as terminé cette action quand…</strong><p>{module.apply.done}</p></div>{campaigns.length ? <div className="learn-apply-campaign"><label htmlFor="learn-apply-campaign">Ma campagne</label><select id="learn-apply-campaign" value={campaignId} onChange={event => setCampaignId(event.target.value)}><option value="">Choisir une campagne</option>{campaigns.map(campaign => <option value={campaign.id} key={campaign.id}>{campaign.name} · {campaign.targetCity}</option>)}</select><button className="learn-button learn-button-dark" type="button" disabled={!campaignId || disabled} onClick={() => void apply()}>Appliquer à ma campagne<ArrowRight size={18} aria-hidden="true"/></button><p className="learn-source">Ouvre le bon écran de ta campagne. Aucun prospect ni contact n’est créé par cette action.</p></div> : <div className="learn-apply-campaign"><p>Tu peux créer ta première campagne avec l’offre Pickles déjà renseignée.</p><Link className="learn-button learn-button-dark" href="/campagnes/nouvelle">Créer ma campagne<ArrowRight size={18} aria-hidden="true"/></Link></div>}<div className="learn-apply-next"><button className="learn-button learn-button-quiet" type="button" disabled={disabled} onClick={() => void go('understand')}><RotateCcw size={17} aria-hidden="true"/>Rejouer ce module</button>{moduleIndex < 5 ? <Link className="learn-button" href={`/apprendre/${LEARNING_MODULES[moduleIndex + 1].id}`}>Module suivant<ArrowRight size={17} aria-hidden="true"/></Link> : <Link className="learn-button" href="/apprendre">Retrouver le parcours<ArrowRight size={17} aria-hidden="true"/></Link>}</div></>}
    </section>
    {step !== 'apply' && <div className="learn-stage-footer">{stepIndex > 0 && <button className="learn-button learn-button-quiet" type="button" disabled={disabled} onClick={() => void go(LEARNING_STEPS[stepIndex - 1].id)}><ArrowLeft size={17} aria-hidden="true"/>Retour</button>}<span className="learn-footer-hint">{step === 'practice' && !ready ? 'Réponds à l’exercice pour continuer.' : 'À ton rythme. Tu peux reprendre plus tard.'}</span><button className="learn-button learn-button-dark" type="button" disabled={disabled || ((step === 'practice' || step === 'feedback') && !ready)} onClick={() => void go(LEARNING_STEPS[stepIndex + 1].id, step === 'feedback')}>{step === 'understand' ? 'Voir un exemple' : step === 'example' ? 'Essayer' : step === 'practice' ? 'Faire le point' : 'Terminer le module'}<ArrowRight size={17} aria-hidden="true"/></button></div>}
    <LearningSaveStatus saving={session.saving || moving} error={session.error} retry={async () => { if (await session.retry()) await persistDraft(); }} dirty={dirty}/>
  </div>;
}
