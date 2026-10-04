import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import test, { type TestContext } from 'node:test';
import { auditMobile } from '../lib/mobile-audit';
import { campaignBackupSchema } from '../lib/campaign-backup';

const website = 'https://atelier.example.com/';
function fixture(overrides: Record<string, unknown> = {}) {
  return { lighthouseResult: {
    requestedUrl: website, finalUrl: website, fetchTime: '2026-10-04T10:00:00.000Z', lighthouseVersion: '13.4.0',
    configSettings: { formFactor: 'mobile' },
    categories: { performance: { score: 0.45 }, accessibility: { score: 0.88 }, seo: { score: 0.92 } },
    audits: {
      'largest-contentful-paint': { score: 0.2, numericValue: 5200.1, numericUnit: 'millisecond', scoreDisplayMode: 'numeric' },
      viewport: { score: 1 }, 'meta-viewport': { score: 1 }, 'http-status-code': { score: 1 }, 'is-crawlable': { score: 1 },
    },
    ...overrides,
  } };
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
function publicDns(t: TestContext) {
  t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }]);
}

test('mobile audit asks Google for selected categories and preserves factual scores and laboratory LCP', async t => {
  publicDns(t);
  let called: URL | undefined, options: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    called = new URL(url); options = init;
    return json({ ...fixture(), loadingExperience: { private: 'DO NOT STORE' } });
  });
  const result = await auditMobile(website);
  assert.equal(called?.origin, 'https://pagespeedonline.googleapis.com');
  assert.equal(called?.pathname, '/pagespeedonline/v5/runPagespeed');
  assert.equal(called?.searchParams.get('strategy'), 'mobile');
  assert.deepEqual(called?.searchParams.getAll('category'), ['performance', 'accessibility', 'seo']);
  assert.ok(called?.searchParams.get('fields')?.includes('numericValue'));
  assert.equal(options?.redirect, 'error');
  assert.equal(options?.cache, 'no-store');
  assert.ok(options?.signal instanceof AbortSignal);
  assert.equal(result.website, website);
  assert.deepEqual(result.contacts, []);
  assert.equal(result.pages[0].url, website);
  const metrics = result.findings.find(item => item.id === 'pagespeed-metrics');
  assert.match(metrics!.note, /Performance : 45\/100.*Accessibilité : 88\/100.*SEO : 92\/100/);
  assert.match(metrics!.note, /LCP simulé.*5200 ms/);
  assert.match(metrics!.note, /2026-10-04T10:00:00.000Z.*Lighthouse 13.4.0/);
  assert.match(result.findings.find(item => item.id === 'pagespeed-lcp')!.approach!, /^Si/);
  assert.ok(result.warnings.some(item => item.includes('laboratoire')));
  assert.ok(result.warnings.some(item => item.includes('budget')));
  assert.equal(JSON.stringify(result).includes('loadingExperience'), false);
  assert.equal(result.findings.some(item => item.key === 'siteAge'), false);
  for (const item of result.findings) {
    const source = new URL(item.sourceUrl);
    assert.equal(source.origin, 'https://pagespeed.web.dev');
    assert.equal(source.searchParams.get('url'), website);
    assert.equal(source.searchParams.get('form_factor'), 'mobile');
  }
});

test('viewport and zoom failures describe their distinct checks rather than inventing a responsive verdict', async t => {
  publicDns(t);
  t.mock.method(globalThis, 'fetch', async () => json(fixture({ audits: {
    viewport: { score: 0 }, 'meta-viewport': { score: 0 },
    'http-status-code': { score: 0, displayValue: '404' }, 'is-crawlable': { score: 0 },
  } })));
  const result = await auditMobile(website);
  assert.match(result.findings.find(item => item.id === 'pagespeed-viewport')!.note, /largeur ou d’échelle initiale/);
  assert.match(result.findings.find(item => item.id === 'pagespeed-meta-viewport')!.note, /zoom.*sous 5/);
  assert.match(result.findings.find(item => item.id === 'pagespeed-http-status-code')!.note, /HTTP 404/);
  assert.match(result.findings.find(item => item.id === 'pagespeed-is-crawlable')!.note, /volontaire.*confirmer/);
  assert.equal(JSON.stringify(result).includes('non responsive'), false);
  assert.equal(result.findings.some(item => item.key === 'siteAge'), false);
});

test('missing and unscored audit fields remain unknown and cannot manufacture a speed or bug finding', async t => {
  publicDns(t);
  let payload: unknown = { lighthouseResult: {} };
  t.mock.method(globalThis, 'fetch', async () => json(payload));
  const empty = await auditMobile(website);
  assert.deepEqual(empty.findings, []);
  assert.ok(empty.warnings.some(item => item.includes('pas disponibles')));
  payload = fixture({ categories: { performance: { score: null } }, audits: {
    viewport: { score: null }, 'meta-viewport': { score: 0, scoreDisplayMode: 'error' },
    'largest-contentful-paint': { numericValue: 9000, numericUnit: 'second', scoreDisplayMode: 'numeric' },
  } });
  const unscored = await auditMobile(website);
  assert.deepEqual(unscored.findings, []);
  assert.ok(unscored.warnings.some(item => item.includes('pas disponibles')));
});

test('good simulated LCP is recorded without a deterioration claim or a suggested intervention', async t => {
  publicDns(t);
  t.mock.method(globalThis, 'fetch', async () => json(fixture({ categories: { performance: { score: 0.99 } },
    audits: { 'largest-contentful-paint': { numericValue: 1600, numericUnit: 'millisecond' } } })));
  const result = await auditMobile(website);
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].note, /99\/100.*1600 ms/);
  assert.equal(result.findings[0].approach, undefined);
});

test('one existing PageSpeed call collects rendered accessibility failures with concrete elements and dates', async t => {
  publicDns(t);
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    fetches++;
    const fields = new URL(url).searchParams.get('fields')!;
    for (const id of ['color-contrast', 'target-size', 'button-name', 'link-name', 'image-alt', 'label']) assert.ok(fields.includes(`${id}(score,scoreDisplayMode,details(`));
    assert.ok(fields.includes('nodeLabel,selector,explanation'));
    assert.equal(/screenshot|snippet|network/i.test(fields), false);
    return json(fixture({ audits: {
      'color-contrast': { score: 0, scoreDisplayMode: 'binary', details: { type: 'table', items: [
        { node: { nodeLabel: 'Voir le chantier', selector: '.project-card a', explanation: 'Contraste insuffisant : 2,1:1.', snippet: '<a>private markup</a>' } },
      ] } },
      'target-size': { score: 0, details: { type: 'table', items: [
        { node: { nodeLabel: 'Comparer', selector: '.compare' } }, { node: { nodeLabel: 'Menu', selector: '.menu' } },
      ] } },
      'button-name': { score: 0 }, 'link-name': { score: 0 }, 'image-alt': { score: 0 }, label: { score: 0 },
    }, fullPageScreenshot: { data: 'DO NOT PERSIST SCREENSHOT' } }));
  });
  const result = await auditMobile(website);
  assert.equal(fetches, 1);
  const contrast = result.findings.find(item => item.id === 'pagespeed-color-contrast')!;
  assert.match(contrast.note, /textes.*contraste insuffisant/);
  assert.match(contrast.note, /Voir le chantier.*\.project-card a.*2,1:1/);
  assert.match(contrast.note, /2026-10-04T10:00:00.000Z.*color-contrast/);
  assert.match(contrast.approach!, /^Si.*couleurs/);
  assert.match(result.findings.find(item => item.id === 'pagespeed-target-size')!.note, /2 éléments signalés.*Comparer.*Menu/);
  assert.match(result.findings.find(item => item.id === 'pagespeed-button-name')!.note, /lecteurs d’écran.*pas précisés/);
  assert.match(result.findings.find(item => item.id === 'pagespeed-link-name')!.note, /lecteurs d’écran/);
  assert.match(result.findings.find(item => item.id === 'pagespeed-image-alt')!.note, /contrôle de texte alternatif/);
  assert.match(result.findings.find(item => item.id === 'pagespeed-label')!.note, /libellé accessible/);
  assert.ok(result.warnings.some(item => /images masquées.*visuellement/.test(item)));
  assert.ok(result.warnings.some(item => /Aucun formulaire/.test(item)));
  assert.equal(JSON.stringify(result).includes('private markup'), false);
  assert.equal(JSON.stringify(result).includes('DO NOT PERSIST SCREENSHOT'), false);
  assert.equal(JSON.stringify(result).includes('décrédibil'), false);
});

test('passing or missing rendered controls cannot invent a defect, commercial consequence or successful visual audit', async t => {
  publicDns(t);
  t.mock.method(globalThis, 'fetch', async () => json(fixture({ categories: {}, audits: {
    'color-contrast': { score: 1 }, 'target-size': { score: 1, scoreDisplayMode: 'binary' },
    'button-name': { score: 0, scoreDisplayMode: 'error' }, 'link-name': { score: 0, scoreDisplayMode: 'manual' },
    'image-alt': { score: null, scoreDisplayMode: 'notApplicable' }, label: { score: 0, scoreDisplayMode: 'informative' },
  } })));
  const result = await auditMobile(website);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].id, 'pagespeed-rendered-checks-passed');
  assert.match(result.findings[0].note, /réussis.*Contraste des textes.*Taille et espacement/);
  assert.match(result.findings[0].note, /ne vaut pas validation visuelle/);
  assert.equal(result.findings[0].approach, undefined);
  assert.ok(result.warnings.some(item => /sans résultat exploitable.*Noms accessibles des boutons/.test(item)));
});

test('rendered element collection is explicitly bounded and invalid optional references do not erase valid measurements', async t => {
  publicDns(t);
  t.mock.method(globalThis, 'fetch', async () => json(fixture({ audits: {
    'largest-contentful-paint': { numericValue: 1300, numericUnit: 'millisecond' },
    'color-contrast': { score: 0, details: { type: 'table', items: Array.from({ length: 25 }, (_, i) => ({ node: {
      nodeLabel: `${i} ${'Texte '.repeat(90)}\u0000`, selector: `.element-${i} ${'très long '.repeat(70)}`, explanation: 'Explication '.repeat(80),
    } })) } },
    'target-size': { score: 0, details: { type: 'table', items: [{ node: { selector: 12 } }, null, { invalid: true }] } },
    'button-name': { score: 0, details: 'invalid optional details' },
  } })));
  const result = await auditMobile(website);
  assert.match(result.findings.find(item => item.id === 'pagespeed-metrics')!.note, /1300 ms/);
  const contrast = result.findings.find(item => item.id === 'pagespeed-color-contrast')!;
  assert.match(contrast.note, /25 éléments signalés/);
  assert.ok(contrast.note.length < 12000);
  assert.ok(contrast.note.length > 2000);
  assert.deepEqual(campaignBackupSchema.shape.candidates.element.shape.mobile.parse(result), result, 'All collected element descriptions survive the backup validation.');
  assert.match(contrast.note, /\.element-19/);
  assert.doesNotMatch(contrast.note, /\.element-20/);
  assert.equal(contrast.note.includes('\u0000'), false);
  assert.ok(result.warnings.some(item => /color-contrast.*détails conservés pour 20.*5 éléments supplémentaires/.test(item)));
  assert.ok(result.warnings.some(item => /target-size.*3 repères inutilisables/.test(item)));
  assert.match(result.findings.find(item => item.id === 'pagespeed-target-size')!.note, /3 éléments signalés.*pas précisés/);
  assert.match(result.findings.find(item => item.id === 'pagespeed-button-name')!.note, /pas précisés/);
});

test('private, local and reserved target URLs are rejected before Google receives them', async t => {
  publicDns(t);
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return json(fixture()); });
  for (const invalid of ['http://localhost/', 'http://127.0.0.1/', 'http://169.254.169.254/',
    'http://[::1]/', 'http://10.0.0.1/', 'http://0x7f000001/', 'https://user:password@example.com/',
    'file:///etc/passwd', 'https://example.com:3000/', 'https://demo.internal/']) {
    await assert.rejects(auditMobile(invalid), /site public.*privée/);
  }
  assert.equal(fetches, 0);
  t.mock.method(dns, 'lookup', async () => [{ address: '192.168.1.1', family: 4 }]);
  await assert.rejects(auditMobile(website), /site public.*privée/);
  assert.equal(fetches, 0);
});

test('quota, credentials and service failures do not expose Google error details or the optional server key', async t => {
  publicDns(t);
  const previous = process.env.PAGESPEED_API_KEY;
  process.env.PAGESPEED_API_KEY = 'private-test-key';
  t.after(() => { if (previous === undefined) delete process.env.PAGESPEED_API_KEY; else process.env.PAGESPEED_API_KEY = previous; });
  let status = 429, lastUrl: URL | undefined;
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    lastUrl = new URL(url);
    return json({ error: { message: 'private-test-key SECRET DETAIL' } }, status);
  });
  await assert.rejects(auditMobile(website), /quota PageSpeed Insights/);
  assert.equal(lastUrl?.searchParams.get('key'), 'private-test-key');
  status = 403;
  await assert.rejects(auditMobile(website), error => error instanceof Error && /clé API Google/.test(error.message) && !error.message.includes('private-test-key'));
  status = 503;
  await assert.rejects(auditMobile(website), /indisponible/);
  t.mock.method(globalThis, 'fetch', async () => json(fixture()));
  const result = await auditMobile(website);
  assert.equal(JSON.stringify(result).includes('private-test-key'), false);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private-test-key in request URL'); });
  await assert.rejects(auditMobile(website), error => error instanceof Error && /injoignable/.test(error.message) && !error.message.includes('private-test-key'));
});

test('API redirects are rejected and reported without forwarding or exposing credentials', async t => {
  publicDns(t);
  t.mock.method(globalThis, 'fetch', async (_url: URL, options: RequestInit) => {
    assert.equal(options.redirect, 'error');
    throw new TypeError('fetch failed on redirect with private key');
  });
  await assert.rejects(auditMobile(website), /injoignable/);
});

test('a public same-domain page redirection is documented while private and unrelated destinations are rejected', async t => {
  publicDns(t);
  let finalUrl = 'https://www.atelier.example.com/accueil';
  t.mock.method(globalThis, 'fetch', async () => json(fixture({ finalUrl })));
  const redirected = await auditMobile(website);
  assert.equal(redirected.pages[0].url, finalUrl);
  assert.ok(redirected.warnings.some(item => item.includes(finalUrl)));
  finalUrl = 'http://127.0.0.1/';
  await assert.rejects(auditMobile(website), /destination.*publique valide/);
  finalUrl = 'https://unrelated.example.org/';
  await assert.rejects(auditMobile(website), /autre domaine/);
});

test('desktop, runtime errors, mismatched pages and malformed metrics cannot be passed off as mobile measurements', async t => {
  publicDns(t);
  let payload: unknown = fixture({ configSettings: { formFactor: 'desktop' } });
  t.mock.method(globalThis, 'fetch', async () => json(payload));
  await assert.rejects(auditMobile(website), /pas renvoyé un test mobile/);
  payload = fixture({ runtimeError: { code: 'NO_FCP', message: 'untrusted server details' } });
  await assert.rejects(auditMobile(website), /pas pu terminer la mesure/);
  payload = fixture({ requestedUrl: 'https://atelier.example.com/other-page' });
  await assert.rejects(auditMobile(website), /ne correspond pas à la page/);
  payload = fixture({ categories: { performance: { score: 45 } } });
  await assert.rejects(auditMobile(website), /rapport invalide/);
  payload = { error: 'missing Lighthouse' };
  await assert.rejects(auditMobile(website), /rapport invalide/);
});

test('non-JSON and excessive response bodies fail before any note is built', async t => {
  publicDns(t);
  let response = new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } });
  t.mock.method(globalThis, 'fetch', async () => response);
  await assert.rejects(auditMobile(website), /réponse invalide/);
  response = new Response(new Uint8Array(3 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(auditMobile(website), /taille maximale de 3 Mo/);
});

test('the global forty-second deadline covers DNS resolution as well as the PageSpeed response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(dns, 'lookup', async () => new Promise<never>(() => {}));
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return json(fixture()); });
  const pending = auditMobile(website);
  t.mock.timers.tick(40_000);
  await assert.rejects(pending, /délai maximal de 40 secondes/);
  assert.equal(fetches, 0);
});
