import Link from 'next/link';
export const workflowSteps = [['rechercher','Rechercher'],['examiner','Qualifier'],['preparer','Contacter et suivre']] as const;
export function WorkflowSteps({campaignId,active}:{campaignId:string;active:string;runId?:string}) {
  const selected=active==='cibler'?'rechercher':active==='suivre'?'preparer':active;
  return <nav className="workflow-steps" aria-label="Votre parcours">{workflowSteps.map(([key,label],index)=><Link key={key} aria-current={selected===key?'step':undefined} className={selected===key?'selected':''} href={key==='examiner'?`/campagnes/${campaignId}/qualification`:`/campagnes/${campaignId}?etape=${key}`}><span aria-hidden="true">{index+1}</span>{label}</Link>)}</nav>;
}
