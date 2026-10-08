'use client';

import Link from 'next/link';
import {usePathname, useSearchParams} from 'next/navigation';
import {useRef, type KeyboardEvent, type ReactNode} from 'react';
import {UI_LABELS} from '@/lib/labels';

type ProspectSpace = 'qualifier' | 'contacter' | 'historique';
const spaces: {value:ProspectSpace;label:string}[] = [
  {value:'qualifier', label:UI_LABELS.steps.qualify},
  {value:'contacter', label:UI_LABELS.steps.contact},
  {value:'historique', label:'Historique'},
];

export function ProspectSpaces({qualifier, contact, history, visibilityHref}:{qualifier:ReactNode;contact:ReactNode;history:ReactNode;visibilityHref:string}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get('espace');
  const active: ProspectSpace = spaces.some(space => space.value === requested) ? requested as ProspectSpace : 'qualifier';
  const qualifierRef = useRef<HTMLButtonElement>(null);
  const contacterRef = useRef<HTMLButtonElement>(null);
  const historiqueRef = useRef<HTMLButtonElement>(null);
  const tabRefs = {qualifier:qualifierRef, contacter:contacterRef, historique:historiqueRef};

  function select(next: ProspectSpace, focus = true) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('espace', next);
    window.history.pushState(null, '', `${pathname}?${params.toString()}`);
    if (focus) requestAnimationFrame(() => tabRefs[next].current?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = spaces.findIndex(space => space.value === active);
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % spaces.length
      : event.key === 'ArrowLeft' ? (index - 1 + spaces.length) % spaces.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? spaces.length - 1
      : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    select(spaces[nextIndex].value);
  }

  const panel = active === 'qualifier' ? qualifier : active === 'contacter' ? contact : history;
  return <div className="prospect-workspace">
    <div className="prospect-space-bar">
      <nav className="prospect-spaces" aria-label={`Travail sur ce ${UI_LABELS.entities.prospect.toLocaleLowerCase('fr')}`} role="tablist">
        {spaces.map(space => <button key={space.value} ref={tabRefs[space.value]} type="button" role="tab" id={`prospect-tab-${space.value}`} aria-selected={active===space.value} aria-controls={`prospect-panel-${space.value}`} tabIndex={active===space.value?0:-1} onClick={()=>select(space.value)} onKeyDown={onKeyDown}>{space.label}</button>)}
      </nav>
      <Link className="open-link prospect-visibility-link" href={visibilityHref}>{UI_LABELS.aiVisibility} ↗</Link>
    </div>
    <section className="prospect-space-panel" role="tabpanel" id={`prospect-panel-${active}`} aria-labelledby={`prospect-tab-${active}`}>{panel}</section>
  </div>;
}
