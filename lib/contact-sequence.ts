import type { Company } from './types';
export function suggestedContactSequence(company:Company){
  const events=company.contactEvents||[];
  if(company.oppositionActive||events.some(event=>event.outcome!=='no_response'))return {state:'stopped' as const,steps:[],next:null};
  if(!events.length)return {state:'not_started' as const,steps:[],next:null};
  const first=events[0].date,add=(days:number)=>{const date=new Date(first+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
  const steps=[{label:'J0 · Premier contact',date:first},{label:'J+5 · Première relance',date:add(5)},{label:'J+12 · Dernière relance',date:add(12)}];
  return {state:events.length>=3?'completed' as const:'active' as const,steps,next:events.length>=3?null:steps[events.length]};
}
