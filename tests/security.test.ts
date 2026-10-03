import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { isAllowedRequest } from '../lib/security';

const envKeys = ['VERCEL', 'BRINE_APP_ORIGIN', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL'] as const;
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
});
afterEach(() => {
  for (const key of envKeys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

test('les mutations exigent une origine HTTP locale identique à l’hôte', () => {
  assert.equal(isAllowedRequest('127.0.0.1:3000', 'http://127.0.0.1:3000', 'same-origin'), true);
  assert.equal(isAllowedRequest('localhost:3100', 'http://localhost:3100', null), true);
  for (const origin of [null, 'https://example.com', 'http://localhost:3000', 'http://127.0.0.1:3100', 'https://127.0.0.1:3000', 'null']) {
    assert.equal(isAllowedRequest('127.0.0.1:3000', origin, null), false, String(origin));
  }
});

test('les hôtes extérieurs et requêtes cross-site sont refusés, y compris en lecture', () => {
  for (const host of [null, 'example.com', '127.0.0.1.example.com', 'localhost.evil.test', '0.0.0.0:3000', '192.168.1.10:3000']) {
    assert.equal(isAllowedRequest(host, null, null, false), false, String(host));
  }
  assert.equal(isAllowedRequest('127.0.0.1:3000', 'http://127.0.0.1:3000', 'cross-site'), false);
  assert.equal(isAllowedRequest('127.0.0.1:3000', null, 'cross-site', false), false);
});

test('une navigation locale en lecture peut arriver sans en-tête Origin', () => {
  assert.equal(isAllowedRequest('127.0.0.1:3000', null, 'none', false), true);
  assert.equal(isAllowedRequest('localhost', null, null, false), true);
  assert.equal(isAllowedRequest('127.0.0.1:3000', 'https://example.com', null, false), false);
});

test('seules les origines HTTPS cloud explicitement configurées sont autorisées', () => {
  process.env.VERCEL = '1';
  process.env.BRINE_APP_ORIGIN = 'https://brine.example.com';
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'brine.vercel.app';
  process.env.VERCEL_URL = 'brine-deployment-team.vercel.app';
  for (const host of ['brine.example.com', 'brine.vercel.app', 'brine-deployment-team.vercel.app']) {
    assert.equal(isAllowedRequest(host, `https://${host}`, 'same-origin'), true);
    assert.equal(isAllowedRequest(host, null, 'none', false), true);
    assert.equal(isAllowedRequest(host, null, 'same-site', false), true);
    for (const origin of [null, `http://${host}`, 'https://evil.test', 'null', 'https://brine.example.com.evil.test']) assert.equal(isAllowedRequest(host, origin, null), false);
    assert.equal(isAllowedRequest(host, `https://${host}`, 'same-site'), false);
    assert.equal(isAllowedRequest(host, `https://${host}`, 'cross-site'), false);
  }
  for (const host of ['localhost:3000', 'evil.vercel.app', 'brine.example.com.evil.test', 'brine.example.com:443', 'brine.example.com,evil.test', 'brine.example.com/evil']) assert.equal(isAllowedRequest(host, `https://${host}`, 'same-origin'), false);
});

test('un cloud sans origine fiable et une configuration invalide échouent fermés', () => {
  process.env.VERCEL = '1';
  assert.equal(isAllowedRequest('brine.vercel.app', 'https://brine.vercel.app', null), false);
  for (const value of ['http://brine.vercel.app', 'https://user:pass@brine.vercel.app', 'https://brine.vercel.app/path', 'https://brine.vercel.app?evil=1', 'https://brine.vercel.app#evil', 'invalid']) {
    process.env.BRINE_APP_ORIGIN = value;
    assert.equal(isAllowedRequest('brine.vercel.app', 'https://brine.vercel.app', null), false, value);
  }
});
