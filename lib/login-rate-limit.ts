import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { createClient, type Client } from '@libsql/client';
import { assertAuthConfiguration } from './auth';

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 10;
type HeadersLike = { get(name: string): string | null };
let cloudClient: Client | undefined;
let cloudClientUrl: string | undefined;
let cloudClientToken: string | undefined;
let initialized: Promise<void> | undefined;
const localAttempts = new Map<string, { count: number; expires: number }>();

export function loginBucket(headers: HeadersLike): string {
  assertAuthConfiguration();
  // Vercel sets this header itself, preventing arbitrary client IP spoofing.
  // https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
  const forwarded = process.env.VERCEL === '1' ? (headers.get('x-vercel-forwarded-for') || headers.get('x-forwarded-for') || '').trim() : 'local';
  const identity = process.env.VERCEL === '1' ? (isIP(forwarded) ? forwarded : 'unknown') : 'local';
  return createHmac('sha256', process.env.BRINE_SESSION_SECRET || 'local-only')
    .update(`brine-login-ip-v1\n${identity}`)
    .digest('hex');
}

async function persistentClient(): Promise<Client> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('La connexion est temporairement indisponible. Réessayez plus tard.');
  if (!cloudClient || cloudClientUrl !== url || cloudClientToken !== authToken) {
    cloudClient?.close();
    cloudClient = createClient({ url, authToken });
    cloudClientUrl = url;
    cloudClientToken = authToken;
    initialized = undefined;
  }
  const client = cloudClient;
  if (!initialized) {
    initialized = client.batch([
      'CREATE TABLE IF NOT EXISTS brine_login_attempts (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
      'CREATE INDEX IF NOT EXISTS brine_login_attempts_expiry ON brine_login_attempts(expires_at)',
    ], 'write').then(() => undefined).catch(error => { initialized = undefined; throw error; });
  }
  await initialized;
  return client;
}

/** Persistent atomic counter in the cloud; passwords and raw IP addresses are never stored. */
export async function consumeLoginAttempt(headers: HeadersLike, now = Date.now()): Promise<{ allowed: boolean; retryAfter: number }> {
  assertAuthConfiguration();
  const bucket = loginBucket(headers);
  if (process.env.VERCEL === '1' || process.env.TURSO_DATABASE_URL) {
    try {
      const client = await persistentClient();
      const result = await client.execute({
        sql: `INSERT INTO brine_login_attempts(bucket, count, expires_at)
          VALUES (?, 1, unixepoch() + ${WINDOW_SECONDS})
          ON CONFLICT(bucket) DO UPDATE SET
            count = CASE WHEN brine_login_attempts.expires_at <= unixepoch() THEN 1 ELSE MIN(brine_login_attempts.count + 1, ${MAX_ATTEMPTS + 1}) END,
            expires_at = CASE WHEN brine_login_attempts.expires_at <= unixepoch() THEN unixepoch() + ${WINDOW_SECONDS} ELSE brine_login_attempts.expires_at END
          RETURNING count, expires_at - unixepoch() AS retry_after`,
        args: [bucket],
      });
      // A bounded cleanup keeps expired identifiers from accumulating indefinitely.
      await client.execute('DELETE FROM brine_login_attempts WHERE bucket IN (SELECT bucket FROM brine_login_attempts WHERE expires_at <= unixepoch() LIMIT 100)');
      const row = result.rows[0];
      if (!row) throw new Error('Missing attempt counter');
      return { allowed: Number(row.count) <= MAX_ATTEMPTS, retryAfter: Math.max(1, Number(row.retry_after)) };
    } catch { throw new Error('La connexion est temporairement indisponible. Réessayez plus tard.'); }
  }
  for (const [key, value] of localAttempts) if (value.expires <= now) localAttempts.delete(key);
  const previous = localAttempts.get(bucket);
  const entry = previous && previous.expires > now ? { ...previous, count: Math.min(MAX_ATTEMPTS + 1, previous.count + 1) } : { count: 1, expires: now + WINDOW_SECONDS * 1000 };
  localAttempts.set(bucket, entry);
  return { allowed: entry.count <= MAX_ATTEMPTS, retryAfter: Math.max(1, Math.ceil((entry.expires - now) / 1000)) };
}
