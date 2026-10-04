import { randomUUID } from 'node:crypto';
import { start } from 'workflow/api';
import { discoveryWorkflow } from '../workflows/discovery';
import { getCampaignRepository } from './campaign-runtime';

export async function dispatchDiscovery(){
  const repo=await getCampaignRepository();const runs=await repo.listRuns();
  if(runs.some(r=>r.status==='running'&&r.leaseUntil>new Date().toISOString()))return;
  const run=runs.filter(r=>r.status==='queued'||r.status==='running'&&r.leaseUntil<=new Date().toISOString()).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];
  if(!run)return;
  // The first database step claims the run. start() itself is not idempotent.
  await start(discoveryWorkflow,[run.id,randomUUID(),await repo.epoch()]);
}
