import assert from 'node:assert/strict';
import test from 'node:test';
import { getCompanyCandidate, parseSearchInput, searchCompanies } from '../lib/company-search';

const local = { siret: '12345678900012', commune: '34172', libelle_commune: 'MONTPELLIER',
  adresse: '1 RUE DE TEST 34000 MONTPELLIER', etat_administratif: 'A' };
function unit(overrides: Record<string, unknown> = {}) {
  return { siren: '123456789', nom_complet: 'ATELIER EXEMPLE (ENSEIGNE)', nom_raison_sociale: 'ATELIER EXEMPLE',
    activite_principale: '43.32A', etat_administratif: 'A', matching_etablissements: [{ ...local }],
    siege: { ...local, siret: '12345678900020', commune: '75056', libelle_commune: 'PARIS' },
    ...overrides };
}
function page(results: unknown[] = [unit()], overrides: Record<string, unknown> = {}) {
  return { results, total_results: results.length, page: 1, per_page: 20, total_pages: results.length ? 1 : 0, ...overrides };
}
function json(data: unknown) { return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }); }
const input = { city: 'Montpellier', activityCodes: '43.32A', query: '', page: 1 };

test('search input normalizes NAF codes and validates page, city and query limits', () => {
  assert.deepEqual(parseSearchInput({ city: ' Montpellier ', activityCodes: '4332a;43.34z 43.32A', page: '2' }),
    { city: 'Montpellier', activityCodes: '43.32A,43.34Z', query: '', page: 2 });
  assert.deepEqual(parseSearchInput({ city: '34172' }), { city: '34172', activityCodes: '', query: '', page: 1 });
  for (const bad of [{}, { city: '' }, { ...input, page: 0 }, { ...input, page: '1.5' },
    { ...input, page: 1001 }, { ...input, page: true }, { ...input, query: 'x'.repeat(181) },
    { ...input, activityCodes: 'rénovation' }, { ...input, activityCodes: '43.*' },
    { ...input, activityCodes: Array.from({ length: 21 }, (_, i) => `43.${String(i).padStart(2, '0')}A`).join(',') }]) {
    assert.throws(() => parseSearchInput(bad), /commune|NAF/);
  }
});

test('search uses activity filters and the active local establishment even when headquarters are elsewhere', async t => {
  const calls: { url: URL; options?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, options?: RequestInit) => {
    calls.push({ url: new URL(url), options });
    return url.hostname === 'geo.api.gouv.fr'
      ? json([{ code: '34172', nom: 'Montpellier' }, { code: '34179', nom: 'Murviel-lès-Montpellier' }])
      : json(page());
  });
  const result = await searchCompanies(input);
  assert.equal(result.companies.length, 1);
  assert.deepEqual(result.commune, { code: '34172', name: 'Montpellier' });
  assert.equal(result.companies[0].siret, local.siret);
  assert.equal(result.companies[0].city, 'MONTPELLIER');
  assert.equal(result.companies[0].name, 'ATELIER EXEMPLE');
  assert.equal(result.companies[0].business, 'Travaux de menuiserie bois et PVC');
  const registryUrl = calls[1].url;
  assert.equal(registryUrl.searchParams.get('q'), null);
  assert.equal(registryUrl.searchParams.get('code_commune'), '34172');
  assert.equal(registryUrl.searchParams.get('activite_principale'), '43.32A');
  assert.equal(registryUrl.searchParams.get('etat_administratif'), 'A');
  assert.equal(registryUrl.searchParams.get('per_page'), '20');
  assert.equal(registryUrl.searchParams.get('minimal'), 'true');
  assert.equal(registryUrl.searchParams.get('include'), 'matching_etablissements,siege');
  assert.equal(calls[1].options?.cache, 'no-store');
  assert.equal(calls[1].options?.redirect, 'error');
  assert.ok(calls[1].options?.signal instanceof AbortSignal);
  const source = new URL(result.companies[0].sourceUrl);
  assert.equal(source.hostname, 'recherche-entreprises.api.gouv.fr');
  assert.equal(source.searchParams.get('q'), local.siret);
  assert.equal(source.searchParams.get('minimal'), 'true');
});

test('search excludes closed local establishments, ceased units, unrelated communes and ignored NAF filters', async t => {
  const closed = unit({ matching_etablissements: [{ ...local, etat_administratif: 'F' }] });
  const elsewhere = unit({ matching_etablissements: [{ ...local, commune: '75056' }] });
  const ceased = unit({ etat_administratif: 'C' });
  const wrongActivity = unit({ activite_principale: '62.01Z' });
  const wrongSiren = unit({ matching_etablissements: [{ ...local, siret: '98765432100012' }] });
  const noName = unit({ nom_complet: null, nom_raison_sociale: null });
  t.mock.method(globalThis, 'fetch', async (url: URL) => url.hostname === 'geo.api.gouv.fr'
    ? json({ code: '34172', nom: 'Montpellier' })
    : json(page([closed, elsewhere, ceased, wrongActivity, wrongSiren, noName], { total_results: 6 })));
  const result = await searchCompanies({ ...input, city: '34172', query: '123456789' });
  assert.deepEqual(result.companies, []);
  assert.equal(result.total, 6);
});

test('closed matches do not hide another active local establishment and duplicate legal units appear once', async t => {
  const record = unit({ matching_etablissements: [{ ...local, etat_administratif: 'F' },
    { ...local, siret: '12345678900039', activite_principale: '47.91A' }] });
  t.mock.method(globalThis, 'fetch', async (url: URL) => url.hostname === 'geo.api.gouv.fr'
    ? json([{ code: '34172', nom: 'Montpellier' }]) : json(page([record, record])));
  const result = await searchCompanies(input);
  assert.equal(result.companies.length, 1);
  assert.equal(result.companies[0].siret, '12345678900039');
  assert.equal(result.companies[0].activityCode, '43.32A');
});

test('a local active headquarters may be used when matching establishments are absent', async t => {
  t.mock.method(globalThis, 'fetch', async (url: URL) => url.hostname === 'geo.api.gouv.fr'
    ? json([{ code: '34172', nom: 'Montpellier' }])
    : json(page([unit({ matching_etablissements: null, siege: local, activite_principale: '62.01Z' })])));
  const result = await searchCompanies({ ...input, activityCodes: '' });
  assert.equal(result.companies[0].business, 'Activité NAF 62.01Z');
  assert.equal(result.companies[0].siret, local.siret);
});

test('ambiguous or approximate commune names are never silently resolved to a different location', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return json([{ code: '93066', nom: 'Saint-Denis' }, { code: '97411', nom: 'Saint-Denis' }]);
  });
  await assert.rejects(searchCompanies({ ...input, city: 'Saint-Denis' }), /Plusieurs communes.*code INSEE/);
  assert.equal(calls, 1);
  await assert.rejects(searchCompanies({ ...input, city: 'Saint' }), /Commune à préciser.*93066/);
  assert.equal(calls, 2);
});

test('accent and separator differences identify the same exact commune', async t => {
  t.mock.method(globalThis, 'fetch', async (url: URL) => url.hostname === 'geo.api.gouv.fr'
    ? json([{ code: '67482', nom: 'Sélestat' }]) : json(page([])));
  const result = await searchCompanies({ ...input, city: 'Selestat' });
  assert.deepEqual(result.commune, { code: '67482', name: 'Sélestat' });
  assert.equal(result.total, 0);
});

test('no more than 20 companies are returned and irrelevant upstream personal/financial fields are discarded', async t => {
  const records = Array.from({ length: 25 }, (_, index) => {
    const siren = String(100000000 + index);
    return unit({ siren, dirigeants: [{ nom: 'DONNÉE NON UTILISÉE' }], finances: { chiffre_affaires: 1 },
      siege: null, matching_etablissements: [{ ...local, siret: siren + '00012' }] });
  });
  t.mock.method(globalThis, 'fetch', async (url: URL) => url.hostname === 'geo.api.gouv.fr'
    ? json([{ code: '34172', nom: 'Montpellier' }]) : json(page(records)));
  const result = await searchCompanies(input);
  assert.equal(result.companies.length, 20);
  assert.equal(JSON.stringify(result).includes('dirigeants'), false);
  assert.equal(JSON.stringify(result).includes('chiffre_affaires'), false);
});

test('import verification retrieves the submitted SIRET and rejects different or closed establishments', async t => {
  const calls: URL[] = [];
  let current = page();
  t.mock.method(globalThis, 'fetch', async (url: URL) => { calls.push(new URL(url)); return json(current); });
  const company = await getCompanyCandidate('123456789', local.siret);
  assert.equal(company.siret, local.siret);
  assert.equal(calls[0].searchParams.get('q'), local.siret);
  assert.equal(calls[0].searchParams.get('per_page'), '1');
  current = page([unit({ matching_etablissements: [{ ...local, etat_administratif: 'F' }] })]);
  await assert.rejects(getCompanyCandidate('123456789', local.siret), /introuvable ou fermé/);
  current = page([unit({ matching_etablissements: [], siege: { ...local, siret: '12345678900020' } })]);
  await assert.rejects(getCompanyCandidate('123456789', local.siret), /introuvable ou fermé/);
  current = page([unit({ siren: '987654321' })]);
  await assert.rejects(getCompanyCandidate('123456789', local.siret), /introuvable ou fermé/);
  const before = calls.length;
  await assert.rejects(getCompanyCandidate('987654321', local.siret), /identifiants SIREN et SIRET/);
  await assert.rejects(getCompanyCandidate('123', '456'), /identifiants SIREN et SIRET/);
  assert.equal(calls.length, before);
});

test('malformed registry responses and unexpected pagination fail with a French error', async t => {
  let payload: unknown = { results: 'invalid' };
  t.mock.method(globalThis, 'fetch', async () => json(payload));
  await assert.rejects(getCompanyCandidate('123456789', local.siret), /registre.*réponse invalide/);
  payload = page([unit({ siren: '<script>' })]);
  await assert.rejects(getCompanyCandidate('123456789', local.siret), /registre.*réponse invalide/);
  t.mock.method(globalThis, 'fetch', async (url: URL) => url.hostname === 'geo.api.gouv.fr'
    ? json([{ code: '34172', nom: 'Montpellier' }]) : json(page([], { page: 2 })));
  await assert.rejects(searchCompanies(input), /page inattendue/);
});

test('upstream throttling, server failures, non-JSON content and oversized responses have actionable errors', async t => {
  let response = new Response(null, { status: 429 });
  t.mock.method(globalThis, 'fetch', async () => response);
  await assert.rejects(getCompanyCandidate('123456789', local.siret), /trop de demandes/);
  response = new Response(null, { status: 503 });
  await assert.rejects(getCompanyCandidate('123456789', local.siret), /indisponible/);
  response = new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(getCompanyCandidate('123456789', local.siret), /réponse invalide/);
  response = new Response('not JSON', { headers: { 'content-type': 'application/json' } });
  await assert.rejects(getCompanyCandidate('123456789', local.siret), /réponse invalide/);
  response = new Response(new Uint8Array(3 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(getCompanyCandidate('123456789', local.siret), /trop volumineuse/);
});

test('slow requests are aborted after ten seconds instead of leaving the import hanging', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: URL, options: RequestInit) => {
    signal = options.signal;
    return new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  });
  const pending = getCompanyCandidate('123456789', local.siret);
  t.mock.timers.tick(10_000);
  await assert.rejects(pending, /met trop de temps.*Réessayez/);
  assert.equal(signal?.aborted, true);
});

test('unexpected transport errors become a French service error instead of revealing upstream details', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('untrusted transport internals'); });
  await assert.rejects(getCompanyCandidate('123456789', local.siret), error =>
    error instanceof Error && /registre.*injoignable/.test(error.message) && !error.message.includes('internals'));
});
