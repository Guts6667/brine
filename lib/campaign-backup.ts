import { randomUUID } from 'node:crypto';
import type { InStatement, InValue } from '@libsql/client';
import { z } from 'zod';
import { qualificationDataSchema, targetSnapshotSchema } from './qualification';
import type { Backup } from './types';
import type { CampaignBackupData } from './campaign-types';
const id=z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),date=z.iso.datetime(),text=(max:number)=>z.string().max(max);
const action=z.object({id,text:text(2000),date:text(10),createdAt:date}).strict().nullable();
const campaign=targetSnapshotSchema.extend({id,name:text(180).min(1),activityCodes:text(200),status:z.enum(['active','paused','archived']),revision:z.number().int().positive(),createdAt:date,updatedAt:date}).strict();
const report=z.object({website:text(2000).regex(/^https?:\/\//),analyzedOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),pages:z.array(z.object({url:text(2000).regex(/^https?:\/\//),title:text(500)}).strict()).max(30),contacts:z.array(z.object({kind:z.enum(['email','phone','formUrl']),value:text(2000),sourceUrl:text(2000).regex(/^https?:\/\//)}).strict()).max(100),findings:z.array(z.object({id:text(120),key:z.enum(['mobile','mainAction','contact','services','siteAge','technical']),note:text(2000),sourceUrl:text(2000).regex(/^https?:\/\//),approach:text(2000).optional()}).strict()).max(30),warnings:z.array(text(2000)).max(30)}).strict().nullable();
export const campaignBackupSchema=z.object({
  campaigns:z.array(campaign),
  participations:z.array(z.object({campaignId:id,companyId:id,stage:z.enum(['À étudier','À contacter','En échange','Opportunité qualifiée','Proposition envoyée','Gagné','Perdu']),archived:z.boolean(),qualification:qualificationDataSchema,nextAction:action,approach:text(4000),findingIds:z.array(text(200)).max(1000),revision:z.number().int().positive(),updatedAt:date}).strict()),
  runs:z.array(z.object({id,campaignId:id,target:campaign,limit:z.number().int().min(1).max(20),status:z.enum(['queued','running','paused','completed','failed','cancelled']),source:z.enum(['registry','existing']),companyIds:z.array(id).max(20),generation:z.number().int().positive(),owner:text(128),leaseUntil:text(40),createdAt:date,updatedAt:date,error:text(4000)}).strict()),
  candidates:z.array(z.object({id,runId:id,companyId:id.nullable(),company:z.object({siren:text(160),siret:text(14),name:text(180),city:text(180),business:text(300),activityCode:text(20),address:text(1000),sourceUrl:text(2000).regex(/^https?:\/\//)}).strict(),status:z.enum(['queued','processing','needs_site','review','accepted','rejected','verify']),websites:z.array(z.object({url:text(2000).regex(/^https?:\/\//),sourceUrl:text(2000).regex(/^https?:\/\//),confidence:z.enum(['exact','confirm'])}).strict()).max(100),website:text(2000),html:report,mobile:report,htmlError:text(2000),mobileError:text(2000),attempts:z.record(z.string(),z.number().int().min(0).max(100)),revision:z.number().int().positive()}).strict()),
  identities:z.array(z.object({siren:z.string().regex(/^\d{9}$/),companyId:id,siret:z.string().regex(/^(?:\d{14})?$/)}).strict()),
  activityCampaigns:z.array(z.object({activityId:id,campaignId:id}).strict()),
}).strict();
export const campaignTables=['campaigns','campaign_participations','discovery_runs','discovery_candidates','company_registry_identity','campaign_activity_context'] as const;
export const campaignSelects=campaignTables.map(t=>`SELECT * FROM ${t}`);
export function campaignSnapshot(rows:Record<string,unknown>[][]):CampaignBackupData{
  const decode=<T>(index:number):T[]=>rows[index].map(r=>JSON.parse(String(r.payload)) as T);
  return {campaigns:decode(0),participations:decode(1),runs:decode(2),candidates:decode(3),identities:rows[4] as unknown as CampaignBackupData['identities'],activityCampaigns:rows[5] as unknown as CampaignBackupData['activityCampaigns']};
}
export function checkCampaignRelations(backup:Backup,issue:(message:string)=>void){
  const data=backup.campaignData;if(!data)return;
  const companies=new Set(backup.companies.map(c=>c.id)),campaigns=new Set(data.campaigns.map(c=>c.id)),runs=new Set(data.runs.map(r=>r.id)),activities=new Set(backup.activities.map(a=>a.id));
  const unique=(values:string[])=>new Set(values).size===values.length;
  if(!unique(data.campaigns.map(c=>c.id))||!unique(data.runs.map(r=>r.id))||!unique(data.candidates.map(c=>c.id))||!unique(data.identities.map(i=>i.siren))||!unique(data.activityCampaigns.map(a=>a.activityId))||!unique(data.participations.map(p=>`${p.campaignId}:${p.companyId}`))||!unique(data.candidates.map(c=>`${c.runId}:${c.company.siren}`)))issue('Identifiant de campagne ou relation dupliqué.');
  if(data.participations.some(p=>!companies.has(p.companyId)||!campaigns.has(p.campaignId))||data.runs.some(r=>!campaigns.has(r.campaignId)||r.companyIds.some(id=>!companies.has(id)))||data.candidates.some(c=>!runs.has(c.runId)||c.companyId&&!companies.has(c.companyId))||data.identities.some(i=>!companies.has(i.companyId))||data.activityCampaigns.some(a=>!activities.has(a.activityId)||!campaigns.has(a.campaignId)))issue('Relation de campagne absente de la sauvegarde.');
  const actionIds=data.participations.flatMap(p=>p.nextAction?[p.nextAction.id]:[]);if(!unique(actionIds))issue('Identifiant d’action de campagne dupliqué.');
  if(data.participations.some(p=>p.nextAction&&backup.companies.find(c=>c.id===p.companyId)?.oppositionActive))issue('Une opposition doit annuler toutes les actions de campagne.');
}
export function campaignRestoreStatements(incoming:Backup,existing:Backup):InStatement[]{
  const statements:InStatement[]=campaignTables.slice().reverse().map(t=>({sql:`DELETE FROM ${t}`,args:[]}));
  statements.push({sql:'DELETE FROM campaign_meta',args:[]},{sql:"INSERT INTO campaign_meta(id,value) VALUES('epoch',?)",args:[randomUUID()]});
  if(!incoming.campaignData)return statements;
  const data=structuredClone(incoming.campaignData),old=existing.campaignData;
  // Retain the campaign context for opposed companies appended by legacy restoration.
  const ids=new Set(incoming.companies.map(c=>c.id)),activityIds=new Set(incoming.activities.map(a=>a.id));
  for(const p of old?.participations||[])if(ids.has(p.companyId)&&incoming.companies.some(c=>c.id===p.companyId&&c.oppositionActive)&&!data.participations.some(x=>x.companyId===p.companyId&&x.campaignId===p.campaignId)){
    if(!data.campaigns.some(c=>c.id===p.campaignId)){const c=old!.campaigns.find(c=>c.id===p.campaignId);if(c)data.campaigns.push(c);}
    data.participations.push({...p,nextAction:null,archived:true});
  }
  for(const a of old?.activityCampaigns||[])if(activityIds.has(a.activityId)&&data.campaigns.some(c=>c.id===a.campaignId)&&!data.activityCampaigns.some(x=>x.activityId===a.activityId))data.activityCampaigns.push(a);
  const insert=(sql:string,args:InValue[])=>statements.push({sql,args});
  for(const c of data.campaigns)insert('INSERT INTO campaigns(id,payload) VALUES (?,?)',[c.id,JSON.stringify(c)]);
  for(const p of data.participations){if(incoming.companies.find(c=>c.id===p.companyId)?.oppositionActive)p.nextAction=null;insert('INSERT INTO campaign_participations(campaignId,companyId,payload) VALUES (?,?,?)',[p.campaignId,p.companyId,JSON.stringify(p)]);}
  // Preserved opposed companies or newly imported legacy rows always get a visible participation.
  const first=data.campaigns[0];if(first)for(const c of incoming.companies)if(!data.participations.some(p=>p.companyId===c.id))insert('INSERT INTO campaign_participations(campaignId,companyId,payload) VALUES (?,?,?)',[first.id,c.id,JSON.stringify({campaignId:first.id,companyId:c.id,stage:c.stage,archived:true,qualification:c.qualification,nextAction:null,approach:'',findingIds:[],revision:1,updatedAt:c.updatedAt})]);
  for(const r of data.runs)insert('INSERT INTO discovery_runs(id,campaignId,payload) VALUES (?,?,?)',[r.id,r.campaignId,JSON.stringify({...r,status:['queued','running','failed'].includes(r.status)?'paused':r.status,owner:'',leaseUntil:'',generation:r.generation+1})]);
  for(const c of data.candidates)insert('INSERT INTO discovery_candidates(id,runId,siren,payload) VALUES (?,?,?,?)',[c.id,c.runId,c.company.siren,JSON.stringify({...c,status:c.status==='processing'?'queued':c.status})]);
  for(const i of data.identities)insert('INSERT INTO company_registry_identity(siren,companyId,siret) VALUES (?,?,?)',[i.siren,i.companyId,i.siret]);
  for(const a of data.activityCampaigns)insert('INSERT INTO campaign_activity_context(activityId,campaignId) VALUES (?,?)',[a.activityId,a.campaignId]);
  if(first)insert("INSERT INTO campaign_meta(id,value) VALUES('initial',?)",[first.id]);return statements;
}
