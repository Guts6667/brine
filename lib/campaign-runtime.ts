import { createClient } from '@libsql/client';
import { AsyncCloudStore } from './cloud-db';
import { CampaignRepository } from './campaign-repository';
import type { CompanyInput, CompanyDetails, AiTestInput } from './types';
import type { ApproachPlan, ContactDraft, ContactEvent, ContactReadiness } from './research-types';

const globalRepositories = globalThis as typeof globalThis & { campaignRepository?: Promise<CampaignRepository> };
export async function getCampaignRepository(): Promise<CampaignRepository> {
  return globalRepositories.campaignRepository ||= initialize().catch(error => {globalRepositories.campaignRepository=undefined;throw error;});
}
async function initialize() {
  let url=process.env.TURSO_DATABASE_URL;
  if(url){const base=new AsyncCloudStore(createClient({url,authToken:process.env.TURSO_AUTH_TOKEN}));await base.listCompanies();base.close();}
  else {if(process.env.VERCEL==='1')throw new Error('Configurez la base distante.');const {getStore}=await import('./db');const store=getStore();if(!('path' in store))throw new Error('Base locale indisponible.');url=`file:${store.path}`;}
  const repo=new CampaignRepository(createClient({url,authToken:process.env.TURSO_AUTH_TOKEN}));await repo.bootstrap();return repo;
}
export async function resetCampaignRepository(){
  const current=globalRepositories.campaignRepository;
  if(!current){await getCampaignRepository();return;}
  // Restoration changes the durable epoch and rows, not the repository's client.
  // Keep its file connections open alongside the legacy SQLite store: closing
  // the pool during active requests can detach the engines' WAL views. Bootstrap
  // only reconstructs campaign context for an imported v1/v2 backup.
  const refreshed=current.then(async repo=>{await repo.bootstrap();return repo;}).catch(error=>{
    if(globalRepositories.campaignRepository===refreshed)globalRepositories.campaignRepository=current;
    throw error;
  });
  globalRepositories.campaignRepository=refreshed;
  await refreshed;
}
export async function getCampaignContext(campaignId='initial',expectedRevision?:number){const repo=await getCampaignRepository();await repo.getCampaign(campaignId);return new CampaignContextStore(repo,campaignId,expectedRevision);}
class CampaignContextStore {
  constructor(readonly repo:CampaignRepository,readonly campaignId:string,readonly expectedRevision?:number){}
  private async base(){return (await import('./db')).getStore();}
  listCompanies(){return this.repo.listCompanies(this.campaignId);}
  async getCompany(id:string){try{return await this.repo.getCompany(this.campaignId,id);}catch(error){if((error as Error).message.includes('introuvable')||(error as Error).message.includes('ne participe'))return undefined;throw error;}}
  getSettings(){return this.repo.getCampaign(this.campaignId);}
  createCompany(input:CompanyInput,source?:{kind:'note';type:string;date:string;text:string}){return this.repo.createCompany(this.campaignId,input,source);}
  updateCompany(id:string,input:CompanyDetails,expectedUpdatedAt?:string){return this.repo.updateCompany(this.campaignId,id,input,this.expectedRevision,expectedUpdatedAt);}
  saveQualification(id:string,input:unknown,confirm:boolean,target:unknown){return this.repo.saveQualification(this.campaignId,id,input,confirm,target,this.expectedRevision);}
  saveObservations(id:string,input:unknown){return this.repo.saveObservations(this.campaignId,id,input,this.expectedRevision);}
  saveAfterExchange(id:string,input:unknown){return this.repo.saveAfterExchange(this.campaignId,id,input,this.expectedRevision);}
  getCompanyReport(id:string){return this.repo.getCompanyReport(this.campaignId,id);}
  savePreparation(id:string,input:{readiness?:ContactReadiness;plan?:ApproachPlan;drafts?:ContactDraft[]}){return this.repo.savePreparation(this.campaignId,id,input,this.expectedRevision);}
  recordContact(id:string,input:ContactEvent,completeActionId?:string|null){return this.repo.recordContact(this.campaignId,id,input,this.expectedRevision,completeActionId);}
  completeActionWithOutcome(id:string,expectedActionId:string,input:{submittedKey:string;note:string;date?:string;nextAction:{text:string;date:string}|null}){return this.repo.completeActionWithOutcome(this.campaignId,id,expectedActionId,input,this.expectedRevision);}
  qualifyOpportunity(id:string){return this.repo.qualifyOpportunity(this.campaignId,id,this.expectedRevision);}
  async findDuplicates(input:CompanyInput,exclude?:string){return (await this.base()).findDuplicates(input,exclude);}
  setAction(id:string,input:unknown,expected?:string|null){return this.repo.setAction(this.campaignId,id,input,expected,this.expectedRevision);}
  completeAction(id:string,expected:string|null){return this.repo.changeAction(this.campaignId,id,expected,'complete','',this.expectedRevision);}
  postponeAction(id:string,date:string,expected:string|null){return this.repo.changeAction(this.campaignId,id,expected,'postpone',date,this.expectedRevision);}
  addActivity(id:string,input:unknown){return this.repo.addActivity(this.campaignId,id,input);}
  listActivities(id:string){return this.repo.listActivities(id);}
  async listAiTests(id:string){return (await this.base()).listAiTests(id);}
  async addAiTest(id:string,input:AiTestInput){return (await this.base()).addAiTest(id,input);}
  setArchived(id:string,value:boolean){return this.repo.setArchived(this.campaignId,id,value,this.expectedRevision);}
  setOpposition(id:string,active:boolean,note:string,confirm:boolean){return this.repo.setOpposition(this.campaignId,id,active,note,confirm);}
}
