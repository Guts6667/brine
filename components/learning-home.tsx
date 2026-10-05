'use client';

import Link from 'next/link';
import { ArrowRight, Check, Clock3, Compass, Mail, Sparkles } from 'lucide-react';
import { LEARNING_MODULES } from '@/lib/learning-curriculum';
import type { LearningCampaignOption, LearningProgress } from '@/lib/learning-types';
import { LearningSaveStatus, useLearningSession } from './learning-shared';

export function LearningHome({ progress: initial, campaigns }: { progress: LearningProgress; campaigns: LearningCampaignOption[] }) {
  const session = useLearningSession(initial);
  const { progress } = session;
  const started = Object.keys(progress.answers).length > 0 || progress.currentStep !== 'understand';
  const next = LEARNING_MODULES.find(module => module.id === progress.currentModule)!;
  const complete = progress.completedModules.length === 6;
  const missions = [
    { key: 'examinedThree', label: 'J’ai examiné trois entreprises réelles.' },
    { key: 'justifiedDecisions', label: 'J’ai justifié mes décisions avec les preuves.' },
    { key: 'preparedEmail', label: 'J’ai préparé un email dont je peux expliquer le motif.' },
    { key: 'recordedContact', label: 'J’ai effectué puis enregistré un premier contact manuel.' },
  ] as const;
  return <div className="learning learn-home">
    <div className="learn-heading"><span className="learn-kicker">PICKLES STUDIO · LES BASES</span><h1>Un premier contact.<br/><span>Avec les bonnes bases.</span></h1><p>Apprends à trouver une entreprise pertinente, vérifier une occasion d’aider et préparer un email utile. Un exercice à la fois, à ton rythme.</p></div>
    <section className="learn-start" aria-label="Ta progression">
      <div className="learn-start-copy"><div className="learn-inline-label"><Compass size={18} aria-hidden="true"/>TON PARCOURS</div><h2>{complete ? 'Les bases sont parcourues.' : started ? 'On reprend où tu en étais.' : 'Tu n’as pas besoin de savoir vendre.'}</h2><p>{complete ? 'Rejoue un exercice ou applique ce que tu as appris à ta campagne.' : 'Six modules courts, sur des entreprises fictives. Puis tu appliques à ta campagne quand tu te sens prêt.'}</p><Link className="learn-button learn-button-dark" href={`/apprendre/${complete ? LEARNING_MODULES[0].id : next.id}`}>{complete ? 'Revoir le parcours' : started ? 'Reprendre' : 'Commencer'}<ArrowRight size={18} aria-hidden="true"/></Link>{started && !complete && <span className="learn-resume">Module {LEARNING_MODULES.indexOf(next) + 1} · {next.title}</span>}</div>
      <div className="learn-progress-card"><span>Ta progression</span><strong>{progress.completedModules.length}<span>/6</span></strong><p>{progress.completedModules.length}/6 modules terminés</p><div className="learn-course-progress" role="progressbar" aria-label="Modules terminés" aria-valuenow={progress.completedModules.length} aria-valuemin={0} aria-valuemax={6}>{LEARNING_MODULES.map((module, i) => <span key={module.id} className={progress.completedModules.includes(module.id) ? 'done' : ''}>{progress.completedModules.includes(module.id) ? <Check size={14} aria-hidden="true"/> : i + 1}</span>)}</div><span className="learn-muted">Rejouable librement · environ 25 min</span></div>
    </section>
    <div className="learn-method"><span><Sparkles size={18} aria-hidden="true"/>Essayer sans toucher à tes prospects</span><span><Mail size={18} aria-hidden="true"/>Commencer par l’email</span><span><Clock3 size={18} aria-hidden="true"/>3 à 5 minutes par module</span></div>
    <section className="learn-module-list" aria-labelledby="learn-modules-title"><div className="learn-section-heading"><h2 id="learn-modules-title">Les six étapes</h2><span>Du choix de la cible au premier échange</span></div>{LEARNING_MODULES.map((module, i) => <Link className="learn-module-row" href={`/apprendre/${module.id}`} key={module.id}><span className={`learn-module-number ${progress.completedModules.includes(module.id) ? 'done' : ''}`}>{progress.completedModules.includes(module.id) ? <Check size={20} aria-label="Terminé"/> : String(i + 1).padStart(2, '0')}</span><span className="learn-module-text"><strong>{module.title}</strong><span>{module.goal}</span></span><span className="learn-module-duration"><Clock3 size={15} aria-hidden="true"/>{module.duration}</span><ArrowRight size={20} aria-hidden="true"/></Link>)}</section>
    <section className="learn-mission" aria-labelledby="learn-mission-title"><div><span className="learn-kicker">FACULTATIF · DANS TA CAMPAGNE</span><h2 id="learn-mission-title">Passer à un premier contact réel</h2><p>Cette mission reste séparée des exercices. Coche seulement ce que tu as réellement fait ; aucune étape ne s’effectue à ta place.</p><label htmlFor="learn-home-campaign">Ta campagne</label><select id="learn-home-campaign" value={progress.campaignId || ''} onChange={event => void session.save({ operation: 'campaign', campaignId: event.target.value || null })} disabled={session.saving}><option value="">Choisir une campagne</option>{campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select><Link className="learn-text-link" href={progress.campaignId ? `/campagnes/${encodeURIComponent(progress.campaignId)}/qualification` : '/campagnes'}>{progress.campaignId ? 'Ouvrir ma campagne' : 'Voir mes campagnes'}<ArrowRight size={16} aria-hidden="true"/></Link></div><fieldset><legend>Ma mission, à mon rythme</legend>{missions.map(mission => <label className="learn-check" key={mission.key}><input type="checkbox" checked={progress.mission[mission.key]} disabled={session.saving} onChange={event => void session.save({ operation: 'mission', mission: { ...progress.mission, [mission.key]: event.target.checked } })}/><span>{mission.label}</span></label>)}</fieldset></section>
    <LearningSaveStatus saving={session.saving} error={session.error} retry={session.retry}/>
  </div>;
}
