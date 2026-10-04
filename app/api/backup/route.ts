import { getCampaignRepository } from '@/lib/campaign-runtime';
import { getStore } from '@/lib/db';
import { requireAuthenticated } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  await requireAuthenticated();
  await getCampaignRepository();
  return new Response(JSON.stringify(await getStore().exportBackup(), null, 2), { headers: {
    'Content-Type':'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="brine-${new Date().toISOString().slice(0,10)}.json"`,
    'Cache-Control':'no-store',
  }});
}
