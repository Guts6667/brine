import { getStore } from '@/lib/db';
import { AsyncCloudStore } from '@/lib/cloud-db';
import { requireAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_: Request, {params}:{params:Promise<{id:string}>}) {
  await requireAuthenticated();
  const {id} = await params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return new Response('Sauvegarde introuvable.', {status:404});
  const store = getStore();
  if (!(store instanceof AsyncCloudStore)) return new Response('Sauvegarde introuvable.', {status:404});
  const backup = await store.getRecoveryBackup(id);
  if (!backup) return new Response('Sauvegarde introuvable.', {status:404});
  return new Response(JSON.stringify(backup,null,2), {headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Content-Disposition':`attachment; filename="brine-avant-restauration-${backup.exportedAt.slice(0,10)}.json"`,
    'Cache-Control':'private, no-store',
  }});
}
