import Link from 'next/link';
export const workflowSteps = [['cibler','Cibler'],['rechercher','Rechercher'],['examiner','Examiner'],['preparer','Préparer'],['suivre','Suivre']] as const;
export function WorkflowSteps({campaignId,active,runId}:{campaignId:string;active:string;runId?:string}) {
  return <nav className="workflow-steps" aria-label="Votre parcours">{workflowSteps.map(([key,label],index)=><Link key={key} aria-current={active===key?'step':undefined} className={active===key?'selected':''} href={key==='examiner'&&runId?'/campagnes/lots/'+runId:'/campagnes/'+campaignId+'?etape='+key}><span aria-hidden="true">{index+1}</span>{label}</Link>)}</nav>;
}
