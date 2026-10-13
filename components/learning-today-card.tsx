import Link from 'next/link';
import { ArrowRight, GraduationCap } from 'lucide-react';
import type { LearningProgress } from '@/lib/learning-types';

export function LearningTodayCard({ progress }: { progress: LearningProgress }) {
  const count=progress.completedModules.length;
  if(count===6)return null;
  return <Link className="learn-today-link" href="/apprendre"><GraduationCap size={17} aria-hidden="true"/><span>{count?`Reprendre le parcours · ${count}/6 modules terminés`:'Découvrir le parcours'}</span><ArrowRight size={15} aria-hidden="true"/></Link>;
}
