import type { DiscoveryProviders } from '../discovery-engine';
import { parisToday } from '../domain';
export const discoveryFixtures:DiscoveryProviders={
  search:async input=>({companies:[{siren:'490484557',siret:'49048455700023',name:'Atelier Démo — lot',city:input.city,business:'Électricité',activityCode:'43.21A',address:'1 rue Démo',sourceUrl:'https://annuaire-entreprises.data.gouv.fr/entreprise/490484557'},{siren:'123456789',siret:'12345678900011',name:'Artisan — site à confirmer',city:input.city,business:'Électricité',activityCode:'43.21A',address:'2 rue Démo',sourceUrl:'https://annuaire-entreprises.data.gouv.fr/entreprise/123456789'}],total:2,page:1,totalPages:1,commune:{name:input.city,code:'69123'}}),
  sites:async c=>({websites:c.siren==='490484557'?[{url:'https://atelier-demo.test/',sourceUrl:'https://data.ademe.fr/datasets/liste-des-entreprises-rge-2-new',confidence:'exact'}]:[],warnings:[]}),
  html:async website=>({website,analyzedOn:parisToday(),pages:[{url:website,title:'Atelier Démo'}],contacts:[{kind:'email',value:'contact@atelier-demo.test',sourceUrl:website}],findings:[{id:'quote404',key:'technical',note:'Le lien Demander un devis renvoie HTTP 404.',sourceUrl:website,approach:'Proposer de rétablir la demande de devis.'}],warnings:['Analyse de test déterministe.']}),
  mobile:async()=>{throw new Error('PageSpeed indisponible : configuration de test.');},
};
