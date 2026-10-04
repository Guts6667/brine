import { requireAuthenticated } from '@/lib/auth';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { getClientBrief, briefNeedsUpdate } from '@/lib/client-brief';
import { renderClientBriefPdf } from '@/lib/client-brief-pdf';
import { getResearchAsset } from '@/lib/research-assets';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  await requireAuthenticated();const {id}=await params;if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))return new Response('Bilan introuvable.',{status:404});const repo=await getCampaignRepository(),brief=await getClientBrief(repo,id);if(!brief)return new Response('Bilan introuvable.',{status:404});
  try{const stale=await briefNeedsUpdate(repo,brief),bytes=await renderClientBriefPdf(brief,key=>getResearchAsset(repo,key)),preview=new URL(request.url).searchParams.get('preview')==='1';return new Response(bytes as BodyInit,{headers:{'Content-Type':'application/pdf','Content-Disposition':`${preview?'inline':'attachment'}; filename="bilan-pickles-${id.slice(0,12)}.pdf"`,'Cache-Control':'private, no-store','X-Brine-Brief-Status':stale?'needs_update':'current','X-Content-Type-Options':'nosniff'}});}catch(error){return Response.json({error:error instanceof Error?error.message:'Génération impossible.'},{status:422});}
}
