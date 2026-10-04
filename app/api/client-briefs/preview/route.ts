import { randomUUID } from 'node:crypto';
import { requireAuthenticated } from '@/lib/auth';
import { isAllowedRequest } from '@/lib/security';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { buildClientBrief } from '@/lib/client-brief-build';
import { renderClientBriefPdf } from '@/lib/client-brief-pdf';
import { getResearchAsset } from '@/lib/research-assets';
export const runtime='nodejs';
export async function POST(request:Request){
  await requireAuthenticated();const h=request.headers;if(!isAllowedRequest(h.get('host'),h.get('origin'),h.get('sec-fetch-site')))return Response.json({error:'Requête non autorisée.'},{status:403});
  if(Number(h.get('content-length'))>25000)return Response.json({error:'Bilan trop long.'},{status:413});
  try{
    const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let length=0;
    if(!reader)return Response.json({error:'Bilan manquant.'},{status:400});
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>25000){await reader.cancel();return Response.json({error:'Bilan trop long.'},{status:413});}chunks.push(value);}
    const bounded=new Request(request.url,{method:'POST',headers:request.headers,body:Buffer.concat(chunks)}),repo=await getCampaignRepository(),brief=await buildClientBrief(repo,await bounded.formData(),randomUUID()),bytes=await renderClientBriefPdf(brief,id=>getResearchAsset(repo,id));return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/pdf','Cache-Control':'private, no-store','Content-Disposition':'inline; filename="apercu-pickles.pdf"'}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Aperçu indisponible.'},{status:422});}
}
