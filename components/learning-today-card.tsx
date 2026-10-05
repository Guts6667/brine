'use client';

import Link from 'next/link';
import { ArrowRight, GraduationCap } from 'lucide-react';
import type { LearningProgress } from '@/lib/learning-types';
import { LearningSaveStatus, useLearningSession } from './learning-shared';

export function LearningTodayCard({ progress }: { progress: LearningProgress }) {
  const session = useLearningSession(progress);
  if (!session.progress.showTodayCard) return null;
  const count = session.progress.completedModules.length;
  const started = count > 0 || Object.keys(session.progress.answers).length > 0;
  return <section className="learning learn-today" aria-label="Apprendre à prospecter"><div className="learn-today-icon"><GraduationCap size={27} aria-hidden="true"/></div><div><span className="learn-kicker">{started ? `${count}/6 MODULES TERMINÉS · À TON RYTHME` : 'NOUVEAU · À TON RYTHME'}</span><h2>{count === 6 ? 'Les bases sont parcourues. Place à ta campagne.' : started ? 'Reprendre tes repères, un exercice à la fois.' : 'Prendre tes marques, un exercice à la fois.'}</h2><p>{count === 6 ? 'Retrouve les exercices et ta mission facultative pour passer à un contact réel.' : 'Six modules courts pour comprendre Brine et préparer ton premier contact Pickles.'}</p><div className="learn-actions"><Link className="learn-button learn-button-dark" href="/apprendre">{started ? 'Retrouver le parcours' : 'Découvrir le parcours'}<ArrowRight size={17} aria-hidden="true"/></Link><button className="learn-button learn-button-quiet" type="button" disabled={session.saving} onClick={() => void session.save({ operation: 'card', showTodayCard: false })}>Plus tard</button></div>{session.error && <LearningSaveStatus {...session}/>}</div></section>;
}
