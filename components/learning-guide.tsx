'use client';

import { useId } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Compass, X } from 'lucide-react';
import { learningModule } from '@/lib/learning-curriculum';
import type { LearningModuleId, LearningProgress } from '@/lib/learning-types';
import { LearningSaveStatus, useLearningSession } from './learning-shared';

export function LearningGuide({ progress, moduleId, campaignId }: { progress: LearningProgress; moduleId: LearningModuleId; campaignId?: string }) {
  const session = useLearningSession(progress);
  const module = learningModule(moduleId)!;
  const panelId = useId();
  const open = session.progress.guideOpen;
  return <aside className={`learning learn-guide ${open ? 'is-open' : ''}`} aria-label="Guide de campagne" data-campaign={campaignId}>
    <button className="learn-guide-toggle learn-button" type="button" aria-expanded={open} aria-controls={panelId} disabled={session.saving} onClick={() => void session.save({ operation: 'guide', guideOpen: !open })}><Compass size={18} aria-hidden="true"/>{open ? 'Fermer le guide' : 'Me guider'}{open && <X size={17} aria-hidden="true"/>}</button>
    <div id={panelId} hidden={!open} className="learn-guide-panel"><span className="learn-kicker">UN PAS À LA FOIS</span><h2>{module.apply.title}</h2><div className="learn-guide-section"><span>VOTRE OBJECTIF</span><p>{module.goal}</p></div><div className="learn-guide-section"><span>LA PROCHAINE ACTION</span><p>{module.apply.action}</p></div><div className="learn-guide-done"><Check size={18} aria-hidden="true"/><div><strong>Vous avez terminé quand…</strong><p>{module.apply.done}</p></div></div><p className="learn-muted">{module.principle}</p><Link className="learn-text-link" href={`/apprendre/${moduleId}`}>M’entraîner sur un cas fictif<ArrowRight size={16} aria-hidden="true"/></Link>{moduleId === 'email' && <div className="learn-guide-related"><Link href="/apprendre/suivi">Comprendre les relances<ArrowRight size={15} aria-hidden="true"/></Link><Link href="/apprendre/echange">Préparer un premier échange<ArrowRight size={15} aria-hidden="true"/></Link></div>}</div>
    {session.error && <LearningSaveStatus {...session}/>}<span className="sr-only" aria-live="polite">{session.saving ? 'Enregistrement de la préférence du guide.' : ''}</span>
  </aside>;
}
