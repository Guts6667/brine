import { timingSafeEqual } from 'node:crypto';
import { dispatchDiscovery } from '@/lib/discovery-dispatch';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const secret=process.env.CRON_SECRET,token=request.headers.get('authorization')||'';
  const expected=Buffer.from(`Bearer ${secret}`),received=Buffer.from(token);
  if(!secret||received.length!==expected.length||!timingSafeEqual(received,expected))return new Response('Non autorisé.',{status:401});
  await dispatchDiscovery();return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
}
