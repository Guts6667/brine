import { requireAuthenticated } from '@/lib/auth';
import { getCampaignRepository } from '@/lib/campaign-runtime';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){await requireAuthenticated();try{const repo=await getCampaignRepository(),{id}=await params;return Response.json({run:await repo.getRun(id),candidates:await repo.listCandidates(id)},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Lot introuvable.'},{status:404,headers:{'Cache-Control':'no-store'}});}}
