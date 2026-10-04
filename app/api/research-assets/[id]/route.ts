import { requireAuthenticated } from '@/lib/auth';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { getResearchAsset } from '@/lib/research-assets';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  await requireAuthenticated();const {id}=await params,bytes=await getResearchAsset(await getCampaignRepository(),id);if(!bytes)return new Response('Capture introuvable.',{status:404});
  return new Response(bytes as BodyInit,{headers:{'Content-Type':'image/jpeg','Content-Disposition':`inline; filename="capture-${id.slice(0,12)}.jpg"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
