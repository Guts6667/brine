import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'brine_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PASSWORD_FORMAT = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Run locally to configure BRINE_PASSWORD_HASH; never store the password itself. */
export function hashPassword(password: string): string {
  if (!password || password.length > 1024) throw new Error('Mot de passe invalide.');
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(password, salt, 64, SCRYPT_OPTIONS).toString('hex');
  return `scrypt-v1$${salt}$${key}`;
}

export function verifyPassword(password: string, hash: string): boolean {
  const match = PASSWORD_FORMAT.exec(hash);
  if (!match || !password || password.length > 1024) return false;
  try {
    const actual = scryptSync(password, match[1], 64, SCRYPT_OPTIONS);
    return timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
  } catch { return false; }
}

export function isAuthEnabled(): boolean {
  return process.env.VERCEL === '1' || !!process.env.BRINE_PASSWORD_HASH || !!process.env.BRINE_SESSION_SECRET;
}

export function assertAuthConfiguration(): void {
  if (!isAuthEnabled()) return;
  if (!PASSWORD_FORMAT.test(process.env.BRINE_PASSWORD_HASH || '') || (process.env.BRINE_SESSION_SECRET || '').length < 32) {
    throw new Error('Accès privé indisponible : configuration de sécurité incomplète.');
  }
}

function sign(payload: string): string {
  assertAuthConfiguration();
  if (!isAuthEnabled()) throw new Error('Accès privé non configuré.');
  // Changing either secret invalidates every existing session.
  return createHmac('sha256', process.env.BRINE_SESSION_SECRET!)
    .update(`brine-session-v1\n${process.env.BRINE_PASSWORD_HASH}\n${payload}`)
    .digest('base64url');
}

export function createSession(now = Date.now()): string {
  if (!Number.isFinite(now)) throw new Error('Date de session invalide.');
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: issuedAt, exp: issuedAt + SESSION_TTL_SECONDS, nonce: randomBytes(16).toString('base64url') })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Verify integrity, lifetime and current secrets without trusting cookie content. */
export function verifySession(token: string | undefined | null, now = Date.now()): boolean {
  if (!token || token.length > 1024 || !Number.isFinite(now)) return false;
  try {
    assertAuthConfiguration();
    if (!isAuthEnabled()) return false;
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return false;
    const expected = Buffer.from(sign(parts[0]), 'base64url');
    const signature = Buffer.from(parts[1], 'base64url');
    if (signature.toString('base64url') !== parts[1] || signature.length !== expected.length || !timingSafeEqual(signature, expected)) return false;
    const decoded = Buffer.from(parts[0], 'base64url');
    if (decoded.toString('base64url') !== parts[0]) return false;
    const payload: unknown = JSON.parse(decoded.toString('utf8'));
    if (!payload || typeof payload !== 'object') return false;
    const session = payload as Record<string, unknown>;
    const seconds = Math.floor(now / 1000);
    return session.v === 1 && Number.isInteger(session.iat) && Number.isInteger(session.exp)
      && typeof session.iat === 'number' && typeof session.exp === 'number'
      && session.iat <= seconds + 30 && session.exp === session.iat + SESSION_TTL_SECONDS && session.exp > seconds
      && typeof session.nonce === 'string' && /^[A-Za-z0-9_-]{22}$/.test(session.nonce);
  } catch { return false; }
}

export function sessionCookieOptions() {
  return { httpOnly: true, secure: process.env.VERCEL === '1' || process.env.BRINE_APP_ORIGIN?.startsWith('https://') === true, sameSite: 'lax' as const, path: '/', maxAge: SESSION_TTL_SECONDS };
}

export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const url = new URL(value, 'https://brine.invalid');
    if (url.origin !== 'https://brine.invalid' || url.pathname === '/connexion' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/'; }
}

/** Check again at every data access or mutation entry point, independently of Proxy. */
export async function requireAuthenticated(): Promise<void> {
  assertAuthConfiguration();
  if (!isAuthEnabled()) return;
  const { cookies } = await import('next/headers');
  if (!verifySession((await cookies()).get(SESSION_COOKIE_NAME)?.value)) throw new Error('Votre session a expiré. Connectez-vous à nouveau.');
}
