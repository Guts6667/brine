'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Check, CircleHelp, LoaderCircle, ShieldCheck } from 'lucide-react';
import { saveLearningProgressAction } from '@/app/learning-actions';
import type { LearningMutation } from '@/lib/learning-schema';
import type { LearningProgress } from '@/lib/learning-types';
import { questionFeedback, type TeachingQuestion } from '@/lib/learning-exercises';

type Command = LearningMutation extends infer T ? T extends { revision: number } ? Omit<T, 'revision'> : never : never;

/** Serial saves avoid racing a text draft against a step or preference change. */
export function useLearningSession(initial: LearningProgress) {
  const [progress, setProgress] = useState(initial);
  const current = useRef(initial);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const failed = useRef<Command | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(0);
  function save(command: Command): Promise<boolean> {
    pending.current++;
    setSaving(true);
    const task = tail.current.then(async () => {
      if (failed.current) {
        if (command.operation === 'answers') failed.current = command;
        return false;
      }
      const form = new FormData();
      form.set('revision', String(current.current.revision));
      for (const [key, value] of Object.entries(command)) form.set(key, typeof value === 'object' && value !== null ? JSON.stringify(value) : typeof value === 'boolean' ? value ? 'yes' : 'no' : String(value ?? ''));
      try {
        const state = await saveLearningProgressAction({}, form);
        if (state.progress) { current.current = state.progress; setProgress(state.progress); }
        if (!state.ok) {
          failed.current = command;
          setError(state.error || 'La progression n’a pas pu être enregistrée. Ton brouillon reste affiché.');
          return false;
        }
        setError('');
        return true;
      } catch {
        failed.current = command;
        setError('Enregistrement indisponible. Ton brouillon reste affiché ; réessaie avant de quitter.');
        return false;
      }
    }).finally(() => { pending.current--; if (!pending.current) setSaving(false); });
    tail.current = task;
    return task;
  }
  async function retry() { const command = failed.current; failed.current = null; if (command) return save(command); return true; }
  async function flush() { await tail.current; return !failed.current; }
  return { progress, saving, error, save, retry, flush };
}

export function LearningSaveStatus({ saving, error, retry, dirty = false }: { saving: boolean; error: string; retry: () => unknown; dirty?: boolean }) {
  return <div className={`learn-save ${error ? 'learn-save-error' : ''}`} aria-live="polite">
    {error ? <><AlertCircle size={16} aria-hidden="true"/><span>{error} Les réponses affichées sont conservées. Réessaie pour enregistrer ce brouillon.</span><button type="button" className="learn-button learn-button-quiet" onClick={retry}>Réessayer</button></>
      : saving || dirty ? <><LoaderCircle size={15} aria-hidden="true"/><span>Enregistrement…</span></>
        : <><Check size={15} aria-hidden="true"/><span>Progression enregistrée</span></>}
  </div>;
}

export function LearningSafety() {
  return <div className="learn-safety"><ShieldCheck size={18} aria-hidden="true"/><span>Entraînement fictif · Aucun prospect modifié, aucun contact envoyé, aucune analyse payante.</span></div>;
}

export function LearningFeedback({ good, children }: { good: boolean; children: React.ReactNode }) {
  return <div className={`learn-feedback ${good ? 'is-good' : 'needs-review'}`} role="status"><span>{good ? <Check size={19} aria-hidden="true"/> : <CircleHelp size={19} aria-hidden="true"/>}</span><div><strong>{good ? 'Bien vu' : 'À revoir'}</strong><div>{children}</div></div></div>;
}

export function LearningQuestion({ question, value, onChange }: { question: TeachingQuestion; value: unknown; onChange: (value: string) => void }) {
  const feedback = questionFeedback(question, value);
  return <div className="learn-question">
    <fieldset><legend>{question.title}</legend>{question.context && <p className="learn-source">{question.context}</p>}
      <div className="learn-choices">{question.choices.map((choice, i) => <label key={choice.value} className={`learn-choice ${choice.value === value ? 'selected' : ''}`}><input type="radio" name={question.key} value={choice.value} checked={choice.value === value} onChange={() => onChange(choice.value)}/><span><span className="learn-choice-letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>{choice.label}</span></label>)}</div>
    </fieldset>
    {feedback && <LearningFeedback good={feedback.correct}>{feedback.text}</LearningFeedback>}
  </div>;
}

/** An authored teaching illustration, never presented as a screenshot of a real company. */
export function TeachingCapture({ satisfactory = false }: { satisfactory?: boolean }) {
  return <figure className="learn-capture"><div className="learn-phone" role="img" aria-label={satisfactory ? 'Illustration fictive : galerie et contact lisibles sur téléphone.' : 'Illustration fictive : le bouton Contact masque la légende et le bas de la photo de réalisation.'}>
    <div className="learn-phone-bar"><span>9:41</span><span aria-hidden="true">● ● ▰</span></div><div className="learn-phone-site"><strong>{satisfactory ? 'Maison Orme' : 'Atelier Sillage'}</strong><span aria-hidden="true">☰</span></div>
    <div className="learn-phone-body"><span className="learn-mini-label">NOS RÉALISATIONS</span><h4>Des intérieurs<br/>qui respirent.</h4><div className="learn-room"><div className="learn-room-window"/><div className="learn-room-table"/><div className="learn-room-pot"/></div><p>Une cuisine repensée, du sol au plafond.</p><div className={satisfactory ? 'learn-mock-contact good' : 'learn-mock-contact bad'}>Contact</div></div>
    {!satisfactory && <div className="learn-capture-mark"><span aria-hidden="true">↖</span>Photo masquée</div>}
  </div><figcaption>Illustration pédagogique · entreprise fictive<br/>Vue mobile 390 px · 5 octobre 2026</figcaption></figure>;
}
