import { requireAuthenticated } from '@/lib/auth';
import { isAllowedRequest } from '@/lib/security';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { storeResearchAsset } from '@/lib/research-assets';
export const runtime='nodejs';
export async function POST(request:Request){
  await requireAuthenticated();const h=request.headers;if(!isAllowedRequest(h.get('host'),h.get('origin'),h.get('sec-fetch-site')))return new Response('Requête non autorisée.',{status:403});
  const size=Number(h.get('content-length'));if(size>102400)return new Response('Capture trop volumineuse.',{status:413});
  try{const reader=request.body?.getReader();if(!reader)throw new Error("Capture absente.");const chunks:Uint8Array[]=[];let total=0;while(true){const item=await reader.read();if(item.done)break;total+=item.value.byteLength;if(total>102400){await reader.cancel();return new Response("Capture trop volumineuse.",{status:413});}chunks.push(item.value);}const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return Response.json(await storeResearchAsset(await getCampaignRepository(),bytes));}catch(error){return Response.json({error:error instanceof Error?error.message:'Capture invalide.'},{status:400});}
}
