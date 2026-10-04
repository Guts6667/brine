import type { ComparisonSnapshot } from './comparison-schema';

type BriefText = {
  companyName:string; website:string; situation:string; positives:string;
  points:Array<{text:string;effect:string;help:string;fact?:{observedOn:string;visual?:{device:string}}}>;
  actions:string[]; invitation:string; comparison:ComparisonSnapshot|null;
};
export function comparisonQueryTexts(query:ComparisonSnapshot['queries'][number],website:string){
  const domain=website?new URL(website).hostname.replace(/^www\./,''):null;
  const own=domain?query.results.find(result=>new URL(result.url).hostname.replace(/^www\./,'')===domain):null;
  return [`« ${query.query} » · ${query.location} · ${query.recordedAt.slice(0,10)} · ordinateur`,own?`Position organique observée : ${own.position} parmi les dix premiers résultats consultés.`:'Entreprise non identifiée parmi les dix premiers résultats consultés ; aucune absence générale déduite.'];
}
/** Count the actual body, including headings and comparison, outside branding and sources. */
export function clientBriefBodyWordCount(brief:BriefText){
  const texts=[brief.companyName,'Votre présence numérique, en quelques points',brief.situation,...(brief.positives?['Ce qui fonctionne',brief.positives]:[]),...brief.points.flatMap((p,i)=>[`${i+1}. ${p.text}`,...(p.effect?[`Effet possible : ${p.effect}`]:[]),...(p.help?[`Aide envisageable : ${p.help}`]:[])]),'Repères et prochaines étapes'];
  if(brief.comparison?.queries.length){texts.push('Résultats Google observés',...brief.comparison.queries.flatMap(q=>comparisonQueryTexts(q,brief.website)),...brief.comparison.competitors.filter(c=>c.confirmed).flatMap(c=>[c.name,...c.notes]));}
  else texts.push('Comparaison non disponible pour ce bilan. Aucun classement n’est déduit de cette absence de contrôle.');
  texts.push('Actions utiles',...brief.actions,brief.invitation);
  const visual=brief.points.find(p=>p.fact?.visual);if(visual)texts.push(`${visual.fact!.visual!.device==='mobile'?'Mobile':'Ordinateur'} · ${visual.fact!.observedOn.slice(0,10)}`);
  return texts.join(' ').trim().split(/\s+/).filter(Boolean).length;
}
