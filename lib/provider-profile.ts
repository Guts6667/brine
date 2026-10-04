import type { ProviderProfile } from './research-types';
/** Public offer verified on studiopickles.io/en on 2026-10-04. No price or commitment inferred. */
export function picklesProviderProfile():ProviderProfile{
  return {name:'Pickles Studio',activity:'studio de design et développement web',skills:'Recherche et stratégie ; UX/UI et direction créative ; conception et développement de sites et applications.',services:'Création de sites web, refonte, amélioration UX/UI et développement d’applications web.',website:'https://www.studiopickles.io/en',references:'Références présentées publiquement : Sciences Co, EDMC Network, Edge Dynamics, MBUZZ, Saudi Excellence Co. Source : https://www.studiopickles.io/en, consultée le 4 octobre 2026.',terms:'',prices:'',signature:'Pickles Studio\ncontact@studiopickles.io\n+33 6 44 16 77 76\nhttps://www.studiopickles.io/en',revision:0};
}
export function withDefaultProviderProfile(profile?:ProviderProfile):ProviderProfile{
  if(!profile)return picklesProviderProfile();
  return Object.entries(profile).every(([key,value])=>key==='revision'||!String(value).trim())?{...picklesProviderProfile(),revision:profile.revision}:profile;
}
