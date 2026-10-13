'use client';

import {useState,type ReactNode} from 'react';
import {AnimatePresence,motion,useReducedMotion} from 'motion/react';
import {cn} from '@/lib/utils';

/** Aceternity Hover Effect, adapted to preserve each Brine card's links and content. */
export function HoverEffect({items,className}:{items:{key:string;content:ReactNode}[];className?:string}){
  const [hoveredIndex,setHoveredIndex]=useState<number|null>(null);
  const reduceMotion=useReducedMotion();
  return <div className={cn('grid gap-4 md:grid-cols-2 xl:grid-cols-3',className)}>{items.map((item,index)=><div key={item.key} className="relative h-full" onMouseEnter={()=>setHoveredIndex(index)} onMouseLeave={()=>setHoveredIndex(null)}>
    <AnimatePresence>{hoveredIndex===index&&<motion.span aria-hidden="true" className="pointer-events-none absolute -inset-1 rounded-[26px] bg-[var(--accent-soft)]" layoutId="campaign-hover-background" initial={reduceMotion?false:{opacity:0}} animate={{opacity:1}} exit={reduceMotion?undefined:{opacity:0}} transition={{duration:reduceMotion?0:0.16}}/>}</AnimatePresence>
    <div className="relative z-10 h-full">{item.content}</div>
  </div>)}</div>;
}
