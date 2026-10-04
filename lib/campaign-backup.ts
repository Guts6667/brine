import { randomUUID } from 'node:crypto';
import { qualificationEnrichmentSchema } from './qualification-enrichment';
import { comparisonSchema } from './comparison-schema';
import { clientBriefSchema } from './client-brief-schema';
import type { InStatement, InValue } from '@libsql/client';
import { z } from 'zod';
import { qualificationDataSchema, targetSnapshotSchema } from './qualification';
import type { Backup } from './types';
import type { CampaignBackupData } from './campaign-types';
import { approachPlanSchema, contactDraftSchema, contactEventSchema, contactReadinessSchema, providerProfileSchema, researchDataSchema } from './research-schemas';
const id=z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),date=z.iso.datetime(),text=(max:number)=>z.string().max(max);
const publicUrl=(max:number)=>text(max).refine(value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&Boolean(url.hostname)&&!url.username&&!url.password&&!/[\s\\]/.test(value);}catch{return false;}},'Utilisez un lien HTTP ou HTTPS sans identifiants.');
const publicLink=publicUrl(2000);
const siteContent=z.array(z.object({url:publicUrl(2048),title:text(160),excerpt:text(1200).min(1),collectedAt:date.max(40)}).strict()).max(24).refine(blocks=>blocks.every(block=>blocks.filter(other=>other.url===block.url).length<=8),'La collecte est limitée à huit extraits par page.');
const action=z.object({id,text:text(2000),date:text(10),createdAt:date}).strict().nullable();
const correction=z.object({id,companyId:id,factId:text(180).min(1),fingerprint:text(50000),note:text(10000).min(1),correctedAt:date,mode:z.enum(['fact','hypothesis']).optional()}).strict();
const campaign=targetSnapshotSchema.extend({id,name:text(180).min(1),activityCodes:text(200),keywords:text(2000).optional(),status:z.enum(['active','paused','archived']),revision:z.number().int().positive(),createdAt:date,updatedAt:date}).strict();
const report=z.object({website:publicLink,analyzedOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),pages:z.array(z.object({url:publicLink,title:text(500)}).strict()).max(30),contacts:z.array(z.object({kind:z.enum(['email','phone','formUrl']),value:text(2000),sourceUrl:publicLink}).strict()).max(100),findings:z.array(z.object({id:text(120),key:z.enum(['mobile','mainAction','contact','services','siteAge','technical']),note:text(12000),sourceUrl:publicLink,approach:text(2000).optional()}).strict()).max(30),warnings:z.array(text(2000)).max(30),content:siteContent.optional()}).strict().nullable();
export const campaignBackupSchema=z.object({
  campaigns:z.array(campaign),
  participations:z.array(z.object({campaignId:id,companyId:id,stage:z.enum(['À étudier','À contacter','En échange','Opportunité qualifiée','Proposition envoyée','Gagné','Perdu']),archived:z.boolean(),qualification:qualificationDataSchema,qualificationEnrichment:qualificationEnrichmentSchema.optional(),nextAction:action,approach:text(12000),findingIds:z.array(text(400)).max(10000),revision:z.number().int().positive(),updatedAt:date,readiness:contactReadinessSchema.optional(),plan:approachPlanSchema.optional(),planHistory:z.array(approachPlanSchema).max(10000).optional(),drafts:z.array(contactDraftSchema).max(10000).optional(),contactEvents:z.array(contactEventSchema).max(10000).optional()}).strict()),
  runs:z.array(z.object({id,campaignId:id,target:campaign,limit:z.number().int().min(1).max(20),status:z.enum(['queued','running','paused','completed','failed','cancelled']),source:z.enum(['registry','existing','mixed']),companyIds:z.array(id).max(20),generation:z.number().int().positive(),owner:text(128),leaseUntil:text(40),createdAt:date,updatedAt:date,error:text(4000)}).strict()),
  candidates:z.array(z.object({id,runId:id,companyId:id.nullable(),company:z.object({siren:text(160),siret:text(14),name:text(180),city:text(180),business:text(300),activityCode:text(20),address:text(1000),sourceUrl:publicLink}).strict(),status:z.enum(['queued','processing','needs_site','review','accepted','rejected','verify']),websites:z.array(z.object({url:publicLink,sourceUrl:publicLink,confidence:z.enum(['exact','confirm'])}).strict()).max(100),website:publicLink.or(z.literal('')),html:report,mobile:report,htmlError:text(2000),mobileError:text(2000),attempts:z.record(z.string(),z.number().int().min(0).max(100)),revision:z.number().int().positive(),dedupeKey:text(1000).min(1).optional(),research:researchDataSchema.optional(),qualificationDraft:qualificationDataSchema.optional(),qualificationEnrichment:qualificationEnrichmentSchema.optional()}).strict()),
  identities:z.array(z.object({siren:z.string().regex(/^\d{9}$/),companyId:id,siret:z.string().regex(/^(?:\d{14})?$/)}).strict()),
  activityCampaigns:z.array(z.object({activityId:id,campaignId:id}).strict()),
  sourceIdentities:z.array(z.object({provider:z.enum(['maps','social']),externalId:text(2000).min(1),companyId:id}).strict()).optional(),
  providerProfile:providerProfileSchema.optional(),
  corrections:z.array(correction).max(10000).optional(),
  assets:z.array(z.object({id:z.string().regex(/^[a-f0-9]{64}$/),mime:z.literal('image/jpeg'),byteLength:z.number().int().min(1).max(102400),createdAt:date}).strict()).max(10000).optional(),
  comparisons:z.array(comparisonSchema).max(10000).optional(),
  clientBriefs:z.array(clientBriefSchema).max(10000).optional(),
}).strict();
export const campaignTables=['campaigns','campaign_participations','discovery_runs','discovery_candidates','company_registry_identity','campaign_activity_context','company_source_identity','research_provider_profile','research_fact_corrections','research_comparisons','research_client_briefs'] as const;
export const campaignSelects=[...campaignTables.map(t=>`SELECT * FROM ${t}`),'SELECT id,mime,byteLength,createdAt FROM research_assets'];
const dedupeKey=(candidate:CampaignBackupData['candidates'][number])=>candidate.dedupeKey||(/^\d{9}$/.test(candidate.company.siren)?`siren:${candidate.company.siren}`:candidate.companyId?`company:${candidate.companyId}`:`legacy:${candidate.id}`);
export function campaignSnapshot(rows:Record<string,unknown>[][]):CampaignBackupData{
  const decode=<T>(index:number):T[]=>rows[index].map(r=>JSON.parse(String(r.payload)) as T);
  return {campaigns:decode(0),participations:decode(1),runs:decode(2),candidates:decode(3),identities:rows[4] as unknown as CampaignBackupData['identities'],activityCampaigns:rows[5] as unknown as CampaignBackupData['activityCampaigns'],sourceIdentities:rows[6] as unknown as CampaignBackupData['sourceIdentities'],...(rows[7][0]?{providerProfile:JSON.parse(String(rows[7][0].payload))}:{}),corrections:decode(8),comparisons:decode(9),clientBriefs:decode(10),assets:rows[11] as unknown as CampaignBackupData['assets']};
}
export function checkCampaignRelations(backup:Backup,issue:(message:string)=>void){
  const data=backup.campaignData;if(!data)return;
  const companies=new Set(backup.companies.map(c=>c.id)),campaigns=new Set(data.campaigns.map(c=>c.id)),runs=new Set(data.runs.map(r=>r.id)),activities=new Set(backup.activities.map(a=>a.id));
  const unique=(values:string[])=>new Set(values).size===values.length;
  if(!unique(data.campaigns.map(c=>c.id))||!unique(data.runs.map(r=>r.id))||!unique(data.candidates.map(c=>c.id))||!unique(data.identities.map(i=>i.siren))||!unique(data.activityCampaigns.map(a=>a.activityId))||!unique(data.participations.map(p=>`${p.campaignId}:${p.companyId}`))||!unique(data.candidates.map(c=>`${c.runId}:${dedupeKey(c)}`))||!unique((data.sourceIdentities||[]).map(s=>`${s.provider}:${s.externalId}`)))issue('Identifiant de campagne ou relation dupliqué.');
  if(data.participations.some(p=>!companies.has(p.companyId)||!campaigns.has(p.campaignId))||data.runs.some(r=>!campaigns.has(r.campaignId)||r.companyIds.some(id=>!companies.has(id)))||data.candidates.some(c=>!runs.has(c.runId)||c.companyId&&!companies.has(c.companyId))||data.identities.some(i=>!companies.has(i.companyId))||data.activityCampaigns.some(a=>!activities.has(a.activityId)||!campaigns.has(a.campaignId)))issue('Relation de campagne absente de la sauvegarde.');
  const actionIds=data.participations.flatMap(p=>p.nextAction?[p.nextAction.id]:[]);if(!unique(actionIds))issue('Identifiant d’action de campagne dupliqué.');
  if(data.participations.some(p=>p.nextAction&&backup.companies.find(c=>c.id===p.companyId)?.oppositionActive))issue('Une opposition doit annuler toutes les actions de campagne.');
  if(data.sourceIdentities?.some(source=>!companies.has(source.companyId)))issue('L’identité de source renvoie à une entreprise absente.');
  if(data.corrections?.some(c=>!companies.has(c.companyId))||!unique((data.corrections||[]).map(c=>c.id)))issue('Correction du dossier invalide ou dupliquée.');
  if(!unique((data.assets||[]).map(a=>a.id))||!unique((data.comparisons||[]).map(c=>c.id))||!unique((data.clientBriefs||[]).map(b=>b.id)))issue('Fichier ou version de bilan dupliqué.');
  for(const row of [...(data.comparisons||[]),...(data.clientBriefs||[])])if(!companies.has(row.companyId)||!campaigns.has(row.campaignId))issue('Un comparatif ou bilan renvoie à une fiche absente.');
  const assets=new Set((data.assets||[]).map(a=>a.id));
  const visit=(value:unknown)=>{if(!value||typeof value!=='object')return;if('assetId' in value&&typeof value.assetId==='string'&&!assets.has(value.assetId))issue('Une capture ne figure pas dans le manifeste de la sauvegarde.');for(const child of Object.values(value))visit(child);};
  visit(data.candidates);visit(data.clientBriefs);
  for(const p of data.participations){
    if(!unique((p.contactEvents||[]).map(event=>event.submittedKey)))issue('Soumission de contact dupliquée.');
    if(!unique((p.contactEvents||[]).map(event=>event.id)))issue('Identifiant de contact dupliqué.');
    if(!unique((p.drafts||[]).map(draft=>draft.id)))issue('Chaque version de brouillon doit avoir un identifiant distinct.');
    if((p.contactEvents||[]).some(event=>event.draftId&&!(p.drafts||[]).some(draft=>draft.id===event.draftId)))issue('Le contact enregistré renvoie à un brouillon absent.');
  }
}
export function campaignRestoreStatements(incoming:Backup,existing:Backup):InStatement[]{
  for(const asset of incoming.campaignData?.assets||[])if(!existing.campaignData?.assets?.some(stored=>stored.id===asset.id&&stored.byteLength===asset.byteLength))throw new Error('Des captures de cette sauvegarde manquent. Restaurez l’archive ZIP complète avec ses images.');
  const statements:InStatement[]=campaignTables.slice().reverse().map(t=>({sql:`DELETE FROM ${t}`,args:[]}));
  statements.push({sql:'DELETE FROM campaign_meta',args:[]},{sql:"INSERT INTO campaign_meta(id,value) VALUES('epoch',?)",args:[randomUUID()]});
  if(!incoming.campaignData){
    if(existing.campaignData?.providerProfile)statements.push({sql:"INSERT INTO research_provider_profile(id,payload) VALUES('provider',?)",args:[JSON.stringify(existing.campaignData.providerProfile)]});
    return statements;
  }
  const data=structuredClone(incoming.campaignData),old=existing.campaignData;
  data.providerProfile ||= old?.providerProfile;
  // Retain the campaign context for opposed companies appended by legacy restoration.
  const ids=new Set(incoming.companies.map(c=>c.id)),activityIds=new Set(incoming.activities.map(a=>a.id));
  for(const p of old?.participations||[])if(ids.has(p.companyId)&&incoming.companies.some(c=>c.id===p.companyId&&c.oppositionActive)&&!data.participations.some(x=>x.companyId===p.companyId&&x.campaignId===p.campaignId)){
    if(!data.campaigns.some(c=>c.id===p.campaignId)){const c=old!.campaigns.find(c=>c.id===p.campaignId);if(c)data.campaigns.push(c);}
    data.participations.push({...p,nextAction:null,archived:true});
  }
  for(const a of old?.activityCampaigns||[])if(activityIds.has(a.activityId)&&data.campaigns.some(c=>c.id===a.campaignId)&&!data.activityCampaigns.some(x=>x.activityId===a.activityId))data.activityCampaigns.push(a);
  for(const identity of old?.identities||[])if(incoming.companies.some(c=>c.id===identity.companyId&&c.oppositionActive)&&!data.identities.some(i=>i.siren===identity.siren))data.identities.push(identity);
  data.sourceIdentities||=[];
  for(const source of old?.sourceIdentities||[])if(incoming.companies.some(c=>c.id===source.companyId&&c.oppositionActive)&&!data.sourceIdentities.some(s=>s.provider===source.provider&&s.externalId===source.externalId))data.sourceIdentities.push(source);
  data.corrections||=[];
  for(const c of old?.corrections||[])if(incoming.companies.some(company=>company.id===c.companyId&&company.oppositionActive)&&!data.corrections.some(x=>x.id===c.id))data.corrections.push(c);
  const insert=(sql:string,args:InValue[])=>statements.push({sql,args});
  for(const c of data.campaigns)insert('INSERT INTO campaigns(id,payload) VALUES (?,?)',[c.id,JSON.stringify(c)]);
  for(const p of data.participations){if(incoming.companies.find(c=>c.id===p.companyId)?.oppositionActive)p.nextAction=null;insert('INSERT INTO campaign_participations(campaignId,companyId,payload) VALUES (?,?,?)',[p.campaignId,p.companyId,JSON.stringify(p)]);}
  // Preserved opposed companies or newly imported legacy rows always get a visible participation.
  const first=data.campaigns[0];if(first)for(const c of incoming.companies)if(!data.participations.some(p=>p.companyId===c.id))insert('INSERT INTO campaign_participations(campaignId,companyId,payload) VALUES (?,?,?)',[first.id,c.id,JSON.stringify({campaignId:first.id,companyId:c.id,stage:c.stage,archived:true,qualification:c.qualification,nextAction:null,approach:'',findingIds:[],revision:1,updatedAt:c.updatedAt})]);
  for(const r of data.runs)insert('INSERT INTO discovery_runs(id,campaignId,payload) VALUES (?,?,?)',[r.id,r.campaignId,JSON.stringify({...r,status:['queued','running','failed'].includes(r.status)?'paused':r.status,owner:'',leaseUntil:'',generation:r.generation+1})]);
  for(const c of data.candidates)insert('INSERT INTO discovery_candidates(id,runId,dedupeKey,payload) VALUES (?,?,?,?)',[c.id,c.runId,dedupeKey(c),JSON.stringify({...c,dedupeKey:dedupeKey(c),company:{...c.company,siren:/^\d{9}$/.test(c.company.siren)?c.company.siren:'',siret:/^\d{14}$/.test(c.company.siret)?c.company.siret:''},status:c.status==='processing'?'queued':c.status})]);
  for(const i of data.identities)insert('INSERT INTO company_registry_identity(siren,companyId,siret) VALUES (?,?,?)',[i.siren,i.companyId,i.siret]);
  for(const a of data.activityCampaigns)insert('INSERT INTO campaign_activity_context(activityId,campaignId) VALUES (?,?)',[a.activityId,a.campaignId]);
  for(const source of data.sourceIdentities||[])insert('INSERT INTO company_source_identity(provider,externalId,companyId) VALUES (?,?,?)',[source.provider,source.externalId,source.companyId]);
  if(data.providerProfile)insert("INSERT INTO research_provider_profile(id,payload) VALUES('provider',?)",[JSON.stringify(data.providerProfile)]);
  for(const c of data.corrections||[])insert('INSERT INTO research_fact_corrections(id,companyId,payload) VALUES (?,?,?)',[c.id,c.companyId,JSON.stringify(c)]);
  for(const row of data.comparisons||[])insert('INSERT INTO research_comparisons(id,campaignId,companyId,payload) VALUES (?,?,?,?)',[row.id,row.campaignId,row.companyId,JSON.stringify(row)]);
  for(const row of data.clientBriefs||[])insert('INSERT INTO research_client_briefs(id,campaignId,companyId,payload) VALUES (?,?,?,?)',[row.id,row.campaignId,row.companyId,JSON.stringify(row)]);
  if(first)insert("INSERT INTO campaign_meta(id,value) VALUES('initial',?)",[first.id]);return statements;
}
