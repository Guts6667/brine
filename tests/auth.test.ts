import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { NextRequest } from 'next/server';
import { assertAuthConfiguration, createSession, hashPassword, isAuthEnabled, requireAuthenticated, safeReturnTo, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, sessionCookieOptions, verifyPassword, verifySession } from '../lib/auth';
import { consumeLoginAttempt, loginBucket } from '../lib/login-rate-limit';
import { proxy } from '../proxy';

const password = 'mot-de-passe-de-test-long-et-unique';
const hash = hashPassword(password);
const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const envKeys = ['VERCEL', 'BRINE_PASSWORD_HASH', 'BRINE_SESSION_SECRET', 'BRINE_APP_ORIGIN', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'] as const;

async function withEnv(values: Record<string, string | undefined>, run: () => void | Promise<void>) {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  try {
    for (const key of envKeys) delete process.env[key];
    for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value;
    await run();
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('le mot de passe est haché avec un sel unique et vérifié sans comparaison de texte brut', () => {
  assert.match(hash, /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.notEqual(hashPassword(password), hash);
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword(`${password}!`, hash), false);
  for (const candidate of ['', 'x'.repeat(1025)]) assert.equal(verifyPassword(candidate, hash), false);
  for (const malformed of ['', password, 'scrypt-v1$wrong$wrong']) assert.equal(verifyPassword(password, malformed), false);
});

test('la protection peut être facultative en local et échoue fermée dans Vercel', async () => {
  await withEnv({}, async () => {
    assert.equal(isAuthEnabled(), false);
    assert.doesNotThrow(assertAuthConfiguration);
    await requireAuthenticated();
    assert.equal(verifySession('anything'), false);
  });
  for (const values of [{ VERCEL: '1' }, { BRINE_PASSWORD_HASH: hash }, { BRINE_SESSION_SECRET: secret }, { BRINE_PASSWORD_HASH: hash, BRINE_SESSION_SECRET: 'short' }, { BRINE_PASSWORD_HASH: 'malformed', BRINE_SESSION_SECRET: secret }]) {
    await withEnv(values, async () => {
      assert.equal(isAuthEnabled(), true);
      assert.throws(assertAuthConfiguration, /configuration de sécurité incomplète/);
      await assert.rejects(requireAuthenticated(), /configuration de sécurité incomplète/);
      assert.equal(verifySession('anything'), false);
    });
  }
});

test('une session signée expire après 8 heures, rejette les falsifications et les secrets modifiés', async () => {
  await withEnv({ BRINE_PASSWORD_HASH: hash, BRINE_SESSION_SECRET: secret }, () => {
    const now = Date.UTC(2026, 9, 3, 12);
    const token = createSession(now);
    assert.equal(verifySession(token, now), true);
    assert.notEqual(createSession(now), token);
    assert.equal(verifySession(token, now + SESSION_TTL_SECONDS * 1000 - 1), true);
    assert.equal(verifySession(token, now + SESSION_TTL_SECONDS * 1000), false);
    assert.equal(verifySession(token, now - 31_000), false);
    const [payload, signature] = token.split('.');
    const changed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    changed.exp += 60;
    assert.equal(verifySession(`${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`, now), false);
    for (const forged of [null, '', 'anything', `${payload}.wrong`, `${token}.extra`, 'x'.repeat(1025)]) assert.equal(verifySession(forged, now), false);
    process.env.BRINE_SESSION_SECRET = `${secret}changed`;
    assert.equal(verifySession(token, now), false);
    process.env.BRINE_SESSION_SECRET = secret;
    process.env.BRINE_PASSWORD_HASH = hashPassword('un-autre-mot-de-passe');
    assert.equal(verifySession(token, now), false);
  });
});

test('les cookies restent privés, limités à l’hôte et sécurisés en production', async () => {
  await withEnv({ VERCEL: '1', BRINE_PASSWORD_HASH: hash, BRINE_SESSION_SECRET: secret }, () => {
    assert.deepEqual(sessionCookieOptions(), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 28800 });
  });
  await withEnv({}, () => assert.equal(sessionCookieOptions().secure, false));
});

test('la destination après connexion reste une page relative sûre', () => {
  assert.equal(safeReturnTo('/prospects?filter=archived&q=studio'), '/prospects?filter=archived&q=studio');
  for (const input of [undefined, null, 'https://evil.test', '//evil.test', '/\\evil.test', '/connexion', '/api/backup', '/_next/data/private.json', '/\ninvalid']) assert.equal(safeReturnTo(input), '/');
});

test('le proxy bloque pages, sauvegardes et mutations sans session, puis laisse passer une session valide', async () => {
  await withEnv({ VERCEL: '1', BRINE_PASSWORD_HASH: hash, BRINE_SESSION_SECRET: secret, VERCEL_PROJECT_PRODUCTION_URL: 'brine-test.vercel.app' }, () => {
    const request = (path: string, method = 'GET', cookie?: string) => new NextRequest(`https://brine-test.vercel.app${path}`, { method, headers: { host: 'brine-test.vercel.app', ...(method === 'POST' ? { origin: 'https://brine-test.vercel.app' } : {}), ...(cookie ? { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } : {}) } });
    const page = proxy(request('/prospects?filter=archived'));
    assert.equal(page.status, 307);
    assert.equal(new URL(page.headers.get('location')!).pathname, '/connexion');
    assert.equal(new URL(page.headers.get('location')!).searchParams.get('returnTo'), '/prospects?filter=archived');
    assert.equal(proxy(request('/api/backup')).status, 401);
    assert.equal(proxy(request('/prospects', 'POST')).status, 401);
    assert.equal(proxy(request('/connexion')).status, 200);
    assert.equal(proxy(request('/connexion', 'POST')).status, 200);
    assert.equal(proxy(request('/_next/static/chunks/app.js')).status, 200);
    assert.equal(proxy(request('/_next/data/private.json')).status, 307);
    assert.equal(proxy(request('/prospects.csv')).status, 307);
    assert.equal(proxy(new NextRequest('https://brine-test.vercel.app/', { headers: { host: 'brine-test.vercel.app', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } })).status, 307);
    assert.equal(proxy(new NextRequest('https://brine-test.vercel.app/', { headers: { host: 'brine-test.vercel.app', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' } })).status, 403);
    assert.equal(proxy(new NextRequest('https://brine-test.vercel.app/api/backup', { headers: { host: 'brine-test.vercel.app', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } })).status, 403);
    const allowed = proxy(request('/api/backup', 'GET', createSession()));
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
  });
  await withEnv({ VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'brine-test.vercel.app' }, () => {
    assert.equal(proxy(new NextRequest('https://brine-test.vercel.app/', { headers: { host: 'brine-test.vercel.app' } })).status, 503);
  });
});

test('les tentatives sont limitées à 10 par 15 minutes sans conserver les adresses IP', async () => {
  await withEnv({ BRINE_PASSWORD_HASH: hash, BRINE_SESSION_SECRET: `${secret}rate-test` }, async () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.15' });
    assert.match(loginBucket(h), /^[a-f0-9]{64}$/);
    assert.equal(loginBucket(h).includes('203.0.113.15'), false);
    const now = Date.UTC(2026, 9, 3, 12);
    for (let i = 0; i < 10; i++) assert.equal((await consumeLoginAttempt(h, now)).allowed, true);
    assert.deepEqual(await consumeLoginAttempt(h, now), { allowed: false, retryAfter: 900 });
    assert.deepEqual(await consumeLoginAttempt(h, now + 900_000), { allowed: true, retryAfter: 900 });
  });
});

test('le compteur cloud utilise l’IP fournie par Vercel et refuse une base absente', async () => {
  await withEnv({ VERCEL: '1', BRINE_PASSWORD_HASH: hash, BRINE_SESSION_SECRET: secret }, async () => {
    const h = new Headers({ 'x-vercel-forwarded-for': '203.0.113.1', 'x-forwarded-for': '203.0.113.2' });
    assert.equal(loginBucket(h), loginBucket(new Headers({ 'x-vercel-forwarded-for': '203.0.113.1' })));
    assert.notEqual(loginBucket(h), loginBucket(new Headers({ 'x-vercel-forwarded-for': '203.0.113.2' })));
    await assert.rejects(consumeLoginAttempt(h), /temporairement indisponible/);
  });
});

test('le compteur persistant est atomique en concurrence et réinitialise les fenêtres expirées', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'brine-auth-'));
  const url = `file:${join(directory, 'attempts.sqlite')}`;
  const inspect = createClient({ url });
  try {
    await withEnv({ VERCEL: '1', BRINE_PASSWORD_HASH: hash, BRINE_SESSION_SECRET: secret, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: 'local-test' }, async () => {
      const h = new Headers({ 'x-vercel-forwarded-for': '203.0.113.25' });
      const results = await Promise.all(Array.from({ length: 25 }, () => consumeLoginAttempt(h)));
      assert.equal(results.filter(result => result.allowed).length, 10);
      const rows = await inspect.execute('SELECT bucket, count, expires_at FROM brine_login_attempts');
      assert.equal(rows.rows.length, 1);
      assert.equal(rows.rows[0].bucket, loginBucket(h));
      assert.equal(rows.rows[0].count, 11);
      await inspect.execute('UPDATE brine_login_attempts SET expires_at = unixepoch() - 1');
      assert.equal((await consumeLoginAttempt(h)).allowed, true);
      assert.equal((await inspect.execute('SELECT count FROM brine_login_attempts')).rows[0].count, 1);
    });
  } finally {
    inspect.close();
    await rm(directory, { recursive: true, force: true });
  }
});
