import Link from 'next/link';
import { UI_LABELS } from '@/lib/labels';
export const workflowSteps = [['rechercher',UI_LABELS.steps.search],['examiner',UI_LABELS.steps.qualify],['preparer',UI_LABELS.steps.contact]] as const;
export function WorkflowSteps({campaignId,active}:{campaignId:string;active:string;runId?:string}) {
  const selected=active==='cibler'?'rechercher':active==='suivre'?'preparer':active;
  return <nav className="workflow-steps" aria-label="Votre parcours">{workflowSteps.map(([key,label],index)=><Link key={key} aria-current={selected===key?'step':undefined} className={selected===key?'selected':''} href={key==='examiner'?`/campagnes/${campaignId}/qualification`:`/campagnes/${campaignId}?etape=${key}`}><span aria-hidden="true">{index+1}</span>{label}</Link>)}</nav>;
}
