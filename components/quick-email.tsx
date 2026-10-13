'use client';

import {useActionState,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Mail,Plus} from 'lucide-react';
import {saveCandidateEmailAction} from '@/app/campaign-actions';
import {saveProspectEmailAction} from '@/app/actions';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
import type {ActionState} from '@/lib/types';

type QuickEmailProps = {email:string;candidateId:string;revision:number;companyId?:never;campaignId?:never;sharedUpdatedAt?:never}
  | {email:string;companyId:string;campaignId:string;revision:number;sharedUpdatedAt:string;candidateId?:never};

export function QuickEmail(props:QuickEmailProps){
  const router=useRouter();
  const [open,setOpen]=useState(false);
  const action=props.candidateId?saveCandidateEmailAction:saveProspectEmailAction.bind(null,props.companyId!);
  const [state,dispatch,pending]=useActionState<ActionState,FormData>(action,{});
  useEffect(()=>{if(state.ok){setOpen(false);router.refresh();}},[state,router]);
  const label=props.email?'Modifier l’email':'Ajouter un email';
  return <><Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="lg" className="min-h-11 rounded-full border-[var(--line)] bg-[var(--surface)] px-4 text-[var(--ink)] hover:bg-[var(--neutral)]"><Mail size={17} aria-hidden="true"/>{label}{!props.email&&<Plus size={15} aria-hidden="true"/>}</Button></DialogTrigger>
    <DialogContent className="max-w-md bg-[var(--surface)] text-[var(--ink)]"><DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>Enregistrez l’adresse professionnelle. Vous confirmerez séparément le canal avant de contacter.</DialogDescription></DialogHeader>
      <form action={dispatch} className="grid gap-4">
        {props.candidateId?<><input type="hidden" name="candidateId" value={props.candidateId}/><input type="hidden" name="revision" value={props.revision}/></>:<><input type="hidden" name="campaignId" value={props.campaignId}/><input type="hidden" name="participationRevision" value={props.revision}/><input type="hidden" name="sharedUpdatedAt" value={props.sharedUpdatedAt}/></>}
        <label className="grid gap-2 text-sm font-medium" htmlFor={`quick-email-${props.candidateId||props.companyId}`}>Email professionnel<Input id={`quick-email-${props.candidateId||props.companyId}`} name="email" type="email" defaultValue={props.email} required maxLength={320} autoComplete="email" className="min-h-11"/></label>
        {state.error&&<p role="alert" className="form-error">{state.error}</p>}
        <DialogFooter><Button type="submit" disabled={pending} size="lg" className="min-h-11 bg-[var(--accent)] px-5 text-[var(--ink)] hover:bg-[var(--accent-dark)]">{pending?'Enregistrement…':'Enregistrer l’email'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>{state.ok&&state.message&&<span role="status" className="sr-only">{state.message}</span>}</>;
}
