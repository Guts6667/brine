import assert from 'node:assert/strict';
import test from 'node:test';
import { createSiteAnalyzer, isPublicSiteAddress, normalizePublicSiteUrl, type SiteAnalysisDependencies, type SiteRequest, type SiteResponse } from '../lib/site-analysis';
import { companyDetailsSchema } from '../lib/domain';

const origin = 'https://public.example';
const publicAddress = { address: '93.184.216.34', family: 4 as const };
const html = (body: string, status = 200): SiteResponse => ({ status, headers: { 'content-type': 'text/html; charset=utf-8' }, body: `<!doctype html><html><head><title>Entreprise</title></head><body>${body}</body></html>` });
const robots = (body: string): SiteResponse => ({ status: 200, headers: { 'content-type': 'text/plain' }, body });

function fixture(routes: Record<string, SiteResponse> = {}, overrides: Partial<SiteAnalysisDependencies> = {}) {
  const requests: SiteRequest[] = [];
  const dependencies: SiteAnalysisDependencies = {
    resolve: async () => [publicAddress],
    request: async options => {
      requests.push(options);
      return routes[options.url.href] || (options.url.pathname === '/robots.txt'
        ? { status: 404, headers: {}, body: '' }
        : html('Une entreprise locale présente son activité et répond aux demandes de ses clients.'));
    },
    now: () => new Date('2026-10-04T10:00:00Z'),
    ...overrides,
  };
  return { requests, dependencies, analyze: createSiteAnalyzer(dependencies) };
}

test('les URLs locales, privées, réservées ou contenant des identifiants sont refusées avant tout accès', async () => {
  const f = fixture();
  for (const value of [
    '', 'file:///etc/passwd', 'ftp://public.example/', 'https://user:password@public.example/',
    'https://public.example:3000/', 'https://localhost/', 'https://localhost./', 'https://machine.local/',
    'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://10.0.0.1/',
    'http://169.254.169.254/', 'http://192.168.1.1/', 'http://100.64.0.1/',
    'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[fe80::1]/', 'https://[fc00::1]/',
    'https://[ff02::1]/', 'http://public.example\\@127.0.0.1/', 'https://public.example/\nprivate',
  ]) await assert.rejects(f.analyze(value), /.+/, value);
  assert.equal(f.requests.length, 0);
  assert.equal(normalizePublicSiteUrl('public.example').href, `${origin}/`);
});

test('le filtrage IP couvre IPv4 et IPv6, y compris les plages de transition et documentation', () => {
  for (const value of ['0.1.2.3', '10.0.0.1', '127.0.0.1', '169.254.1.1', '172.16.1.1', '192.168.1.1',
    '100.127.255.255', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:93.184.216.34', '64:ff9b::a00:1', '2001::1', '2001:db8::1', '2002:7f00:1::1', '3fff::1', 'fe80::1', 'fd00::1', 'ff00::1', 'invalid']) {
    assert.equal(isPublicSiteAddress(value), false, value);
  }
  for (const value of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:4860:4860::8888', '2606:4700:4700::1111']) {
    assert.equal(isPublicSiteAddress(value), true, value);
  }
});

test('un DNS mixant adresses publiques et privées échoue fermé', async () => {
  const f = fixture({}, { resolve: async () => [publicAddress, { address: '10.0.0.1', family: 4 }] });
  const result = await f.analyze(origin);
  assert.equal(f.requests.length, 0);
  assert.equal(result.pages.length, 0);
  assert.match(result.warnings.join(' '), /résolution DNS.*privée/);
});

test('le socket est épinglé à l’IP publique validée, sans nouvelle résolution DNS au branchement', async () => {
  let resolutions = 0;
  const lookups: string[] = [];
  const f = fixture({}, {
    resolve: async () => { resolutions++; return [publicAddress]; },
    request: async options => {
      assert.equal(options.userAgent, 'BrineBot/1.0');
      // A DNS rebinding after validation cannot change this socket lookup result.
      await new Promise<void>((resolve, reject) => options.lookup(options.url.hostname, {}, (error, address, family) => {
        if (error) return reject(error);
        assert.equal(family, 4);
        assert.equal(address, publicAddress.address);
        lookups.push(address as string);
        resolve();
      }));
      await new Promise<void>((resolve, reject) => options.lookup(options.url.hostname, { all: true }, (error, addresses) => {
        if (error) return reject(error);
        assert.deepEqual(addresses, [publicAddress]);
        resolve();
      }));
      return options.url.pathname === '/robots.txt' ? robots('User-agent: *\nAllow: /') : html('Contact public');
    },
  });
  const result = await f.analyze(origin);
  assert.equal(result.pages.length, 1);
  assert.equal(resolutions, 2);
  assert.deepEqual(lookups, [publicAddress.address, publicAddress.address]);
});

test('le DNS est revalidé pour chaque ressource même si robots.txt a déjà été récupéré', async () => {
  let resolutions = 0;
  const f = fixture({}, { resolve: async () => ++resolutions === 1 ? [publicAddress] : [{ address: '127.0.0.1', family: 4 }] });
  const result = await f.analyze(origin);
  assert.deepEqual(f.requests.map(request => request.url.pathname), ['/robots.txt']);
  assert.equal(result.pages.length, 0);
  assert.match(result.warnings.join(' '), /accès refusé/);
});

test('chaque redirection de page est revalidée avant de consulter sa destination', async () => {
  for (const location of ['http://127.0.0.1/private', 'http://169.254.169.254/metadata', 'https://[::1]/', 'https://user:password@public.example/', 'https://public.example:8080/']) {
    const f = fixture({ [`${origin}/`]: { status: 302, headers: { location }, body: '' } });
    const result = await f.analyze(origin);
    assert.equal(result.pages.length, 0);
    assert.equal(f.requests.length, 2);
    assert.match(result.warnings.join(' '), /interdit|autorisés/);
  }
});

test('chaque redirection de robots.txt est revalidée et reste bornée', async () => {
  const f = fixture({ [`${origin}/robots.txt`]: { status: 302, headers: { location: 'http://10.0.0.1/rules' }, body: '' } });
  const result = await f.analyze(origin);
  assert.equal(f.requests.length, 1);
  assert.equal(result.pages.length, 0);
  assert.match(result.warnings.join(' '), /interdit/);
  const loop = fixture({ [`${origin}/robots.txt`]: { status: 301, headers: { location: '/robots.txt' }, body: '' } });
  const loopResult = await loop.analyze(origin);
  assert.equal(loop.requests.length, 5);
  assert.match(loopResult.warnings.join(' '), /robots.txt redirige trop souvent/);
});

test('une destination de redirection à nom public mais DNS privé n’est jamais demandée', async () => {
  const f = fixture({ [`${origin}/`]: { status: 302, headers: { location: 'https://rebound.example/' }, body: '' } }, {
    resolve: async hostname => hostname === 'rebound.example' ? [{ address: '192.168.1.1', family: 4 }] : [publicAddress],
  });
  const result = await f.analyze(origin);
  assert.equal(result.pages.length, 0);
  assert.ok(f.requests.every(request => request.url.hostname === 'public.example'));
  assert.match(result.warnings.join(' '), /résolution DNS.*privée.*accès refusé/);
});

test('robots.txt spécifique à BrineBot prime sur le groupe wildcard', async () => {
  const f = fixture({ [`${origin}/robots.txt`]: robots('User-agent: *\nAllow: /\n\nUser-agent: BrineBot\nDisallow: /') });
  const result = await f.analyze(origin);
  assert.deepEqual(f.requests.map(request => request.url.pathname), ['/robots.txt']);
  assert.equal(result.pages.length, 0);
  assert.match(result.warnings.join(' '), /robots.txt interdit/);
});

test('robots.txt respecte longest-match, Allow à égalité, wildcard et ancrage', async () => {
  const f = fixture({
    [`${origin}/robots.txt`]: robots('User-agent: BrineBot\nDisallow: /contact*\nAllow: /contact/public$\nDisallow: /contact/public$\nDisallow: /*?secret=*'),
    [`${origin}/`]: html('<a href="/contact/prive">Contact privé</a><a href="/contact/public">Contact public</a><a href="/services?secret=1">Services privés</a>'),
    [`${origin}/contact/public`]: html('<a href="mailto:contact@atelier.fr">Nous écrire</a>'),
  });
  const result = await f.analyze(origin);
  assert.deepEqual(result.pages.map(page => page.url), [`${origin}/`, `${origin}/contact/public`]);
  assert.ok(!f.requests.some(request => request.url.pathname === '/contact/prive'));
  assert.ok(result.contacts.some(contact => contact.value === 'contact@atelier.fr'));
});

test('robots.txt compare correctement les chemins UTF-8 et encodages unreserved', async () => {
  const f = fixture({ [`${origin}/robots.txt`]: robots('User-agent: BrineBot\nDisallow: /équipe\nDisallow: /%63ontact') });
  for (const path of ['/équipe', '/contact']) {
    const result = await f.analyze(`${origin}${path}`);
    assert.equal(result.pages.length, 0);
    assert.match(result.warnings.join(' '), /robots.txt interdit/);
  }
  assert.ok(f.requests.every(request => request.url.pathname === '/robots.txt'));
});

test('robots.txt absent autorise la visite, indisponible ou ambigu la suspend avec une explication', async () => {
  for (const status of [404, 410]) {
    const f = fixture({ [`${origin}/robots.txt`]: { status, headers: {}, body: '' } });
    assert.equal((await f.analyze(origin)).pages.length, 1);
  }
  for (const response of [
    { status: 503, headers: {}, body: '' }, { status: 403, headers: {}, body: '' },
    html('<h1>Page introuvable</h1>'),
  ]) {
    const f = fixture({ [`${origin}/robots.txt`]: response });
    const result = await f.analyze(origin);
    assert.equal(result.pages.length, 0);
    assert.equal(f.requests.length, 1);
    assert.match(result.warnings.join(' '), /robots.txt/);
  }
});

test('les coordonnées sont extraites du HTML et des URI, sans scripts, commentaires ou éléments masqués', async () => {
  const f = fixture({ [`${origin}/`]: html(`
    <script>const email = 'script@atelier.fr';</script><style>/* style@atelier.fr */</style>
    <!-- commentaire@atelier.fr --><div hidden>masque@atelier.fr</div><div aria-hidden="true">cache@atelier.fr</div>
    <a href="mailto:contact&#64;atelier.fr?subject=Bonjour">Écrire</a>
    <a href="mailto:commercial%2Bdevis%40atelier.fr">Devis</a><a href="mailto:bad%XX@atelier.fr">Lien malformé</a>
    <p>Accueil : bonjour@atelier.fr — Téléphone : 06 12 34 56 78</p><a href="tel:+33%20(0)6%2012%2034%2056%2078">Appeler</a>
    <p>SIRET : 01234567890123</p><a href="/contact">Page de contact</a>
  `) });
  const result = await f.analyze(origin);
  const emails = result.contacts.filter(contact => contact.kind === 'email').map(contact => contact.value).sort();
  assert.deepEqual(emails, ['bonjour@atelier.fr', 'commercial+devis@atelier.fr', 'contact@atelier.fr']);
  assert.deepEqual(result.contacts.filter(contact => contact.kind === 'phone').map(contact => contact.value).sort(), ['+33612345678', '0612345678']);
  assert.ok(!result.contacts.some(contact => contact.kind === 'formUrl'));
  assert.equal(result.analyzedOn, '2026-10-04');
  assert.ok(result.contacts.every(contact => contact.sourceUrl === `${origin}/`));
});

test('seuls les vrais formulaires de contact avec champs deviennent un contact formUrl', async () => {
  const f = fixture({
    [`${origin}/`]: html('<a href="/contact">Contact</a><form id="contact"></form><form action="/search"><input type="search" name="q"></form><form id="newsletter"><input type="email" name="email"></form><form id="contact"><input type="email" hidden></form>'),
    [`${origin}/contact`]: html('<form id="contact"><input type="email"><textarea name="message"></textarea><button>Envoyer</button></form>'),
  });
  const result = await f.analyze(origin);
  assert.deepEqual(result.contacts.filter(contact => contact.kind === 'formUrl'), [{ kind: 'formUrl', value: `${origin}/contact`, sourceUrl: `${origin}/contact` }]);
});

test('les emails refusés par Brine sont exclus sans bloquer les téléphones valides', async () => {
  const f = fixture({ [`${origin}/`]: html(`
    <a href="mailto:contact..team@example.com">Adresse invalide</a>
    <p>Autres erreurs : .contact@example.com et contact@bad..example.com</p>
    <a href="tel:+33612345678">Appeler</a><p>Téléphone local : 04 67 12 34 56</p>
  `) });
  const result = await f.analyze(origin);
  assert.deepEqual(result.contacts.map(contact => [contact.kind, contact.value]), [
    ['phone', '0467123456'], ['phone', '+33612345678'],
  ]);
  for (const contact of result.contacts) {
    assert.equal(companyDetailsSchema.safeParse({ name: 'Validation', website: '', contact: { [contact.kind]: contact.value } }).success, true);
  }
});

test('l’analyse se limite à l’accueil et deux pages contact/prestations de la même origine', async () => {
  const f = fixture({ [`${origin}/`]: html('<a href="/contact">Contact</a><a href="/prestations">Prestations</a><a href="/services">Services</a><a href="https://elsewhere.example/contact">Contact extérieur</a><a href="/about">À propos</a>') });
  const result = await f.analyze(origin);
  assert.equal(result.pages.length, 3);
  assert.deepEqual(f.requests.map(request => request.url.pathname), ['/robots.txt', '/', '/contact', '/prestations']);
  assert.ok(result.pages.every(page => new URL(page.url).origin === origin));
  assert.ok(result.findings.some(finding => finding.key === 'services'));
});

test('les redirections publiques de l’accueil deviennent le site canonique et leurs robots sont consultés', async () => {
  const canonical = 'https://www.public.example';
  const f = fixture({ [`${origin}/`]: { status: 301, headers: { location: `${canonical}/` }, body: '' } });
  const result = await f.analyze(origin);
  assert.equal(result.website, `${canonical}/`);
  assert.deepEqual(result.pages.map(page => page.url), [`${canonical}/`]);
  assert.deepEqual(f.requests.map(request => request.url.href), [`${origin}/robots.txt`, `${origin}/`, `${canonical}/robots.txt`, `${canonical}/`]);
  assert.ok(result.findings.every(finding => new URL(finding.sourceUrl).origin === canonical));
});

test('les redirections des pages supplémentaires vers une autre origine ne sont pas suivies', async () => {
  const f = fixture({
    [`${origin}/`]: html('<a href="/contact">Contact</a>'),
    [`${origin}/contact`]: { status: 302, headers: { location: 'https://elsewhere.example/contact' }, body: '' },
  });
  const result = await f.analyze(origin);
  assert.equal(result.pages.length, 1);
  assert.ok(f.requests.every(request => request.url.origin === origin));
  assert.match(result.warnings.join(' '), /redirige vers un autre site/);
});

test('un lien interne cassé produit un constat daté précis, sans diagnostic inventé', async () => {
  const f = fixture({
    [`${origin}/`]: html('<a href="/contact">Demander un devis</a><a href="/services">Services</a>'),
    [`${origin}/contact`]: html('Introuvable', 404),
    [`${origin}/services`]: html('Maintenance', 503),
  });
  const result = await f.analyze(origin);
  const technical = result.findings.filter(finding => finding.key === 'technical');
  assert.equal(technical.length, 2);
  assert.match(technical[0].note, /HTTP 404.*2026-10-04/);
  assert.equal(technical[0].sourceUrl, `${origin}/contact`);
  assert.match(technical[1].note, /HTTP 503/);
  assert.equal(result.pages.length, 1);
  assert.ok(result.findings.every(finding => !/ancien|non responsive|invisible dans|score/.test(finding.note)));
});

test('un accueil indisponible conserve le constat HTTP daté et une approche conditionnelle', async () => {
  for (const status of [404, 410, 500, 503]) {
    const f = fixture({ [`${origin}/`]: html('Accueil indisponible', status) });
    const result = await f.analyze(origin);
    assert.equal(result.pages.length, 0);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].key, 'technical');
    assert.equal(result.findings[0].sourceUrl, `${origin}/`);
    assert.match(result.findings[0].note, new RegExp(`HTTP ${status}.*2026-10-04`));
    assert.match(result.findings[0].approach || '', /proposer de vérifier/);
  }
});

test('la date du constat suit Europe/Paris lors du passage de minuit UTC', async () => {
  const f = fixture({}, { now: () => new Date('2026-10-04T22:30:00Z') });
  const result = await f.analyze(origin);
  assert.equal(result.analyzedOn, '2026-10-05');
  const mobile = result.findings.find(finding => finding.key === 'mobile')!;
  assert.match(mobile.approach || '', /absence de balise viewport.*vérifier ensemble/);
  assert.ok(!/non responsive|mal adapté/.test(mobile.approach || ''));
});

test('viewport et copyright ne deviennent jamais une preuve de responsive ou d’ancienneté', async () => {
  const f = fixture({ [`${origin}/`]: { ...html('<footer>Copyright 2008 Atelier</footer>'), body: '<html><head><meta name="viewport" content="width=device-width"><title>L’atelier &amp; Maison</title></head><body>Copyright 2008 Atelier</body></html>' } });
  const result = await f.analyze(origin);
  assert.equal(result.pages[0].title, 'L’atelier & Maison');
  assert.equal(result.findings.some(finding => finding.key === 'siteAge'), false);
  const mobile = result.findings.find(finding => finding.key === 'mobile')!;
  assert.match(mobile.note, /viewport.*reste à vérifier visuellement/);
  assert.match(result.warnings.join(' '), /aucun audit visuel.*ChatGPT ou Claude/);
});

test('un site dynamique à HTML vide explique les limites sans inventer de coordonnées', async () => {
  const f = fixture({ [`${origin}/`]: html('<div id="root"></div><script src="/app.js"></script>') });
  const result = await f.analyze(origin);
  assert.deepEqual(result.contacts, []);
  assert.match(result.warnings.join(' '), /chargées par JavaScript peuvent manquer/);
});

test('le plafond HTML s’applique aussi aux transports injectés', async () => {
  const f = fixture({ [`${origin}/`]: html('x'.repeat(1024 * 1024)) });
  const result = await f.analyze(origin);
  assert.equal(result.pages.length, 0);
  assert.match(result.warnings.join(' '), /taille maximale/);
});

test('le délai global borne même un résolveur ou transport qui ignore le signal', async () => {
  for (const override of [
    { resolve: async () => new Promise<never>(() => {}) },
    { request: async () => new Promise<never>(() => {}) },
  ]) {
    const f = fixture({}, { ...override, timeoutMs: 15 });
    const started = Date.now();
    const result = await f.analyze(origin);
    assert.ok(Date.now() - started < 1000);
    assert.equal(result.pages.length, 0);
    assert.match(result.warnings.join(' '), /délai maximal/);
  }
});

test('les prestations, réalisations, clientèle et zones déclarées sont conservées sans inventer de problème', async () => {
  const f=fixture({[`${origin}/`]:html(`
    <nav><h2>Services de navigation</h2><p>Texte du menu à exclure.</p></nav>
    <h1>Atelier de peinture</h1><p>Nous réalisons des travaux de peinture pour les particuliers et les commerces.</p>
    <h2>Nos prestations</h2><ul><li><p>Rénovation de façades.</p></li><li>Peinture intérieure et pose de revêtements.</li></ul>
    <h2>Nos réalisations</h2><h3>Maison de quartier</h3><p>Rénovation des murs de cette maison.</p>
    <h2>Notre clientèle et zone d’intervention</h2><p>Particuliers et commerces à Montpellier et dans les communes voisines.</p>
    <div hidden><h2>Services cachés</h2><p>Déclaration masquée.</p></div><script>const description='Contenu du script';</script>
    <footer><h2>Services légaux</h2><p>Texte du pied de page à exclure.</p></footer>
    <a href="/prestations">Nos prestations</a><a href="/realisations">Voir tous les projets</a>
  `),[`${origin}/prestations`]:html('<h1>Nos services de peinture</h1><p>Conseils sur les teintes et préparation des supports avant application.</p>')});
  const result=await f.analyze(origin);
  assert.deepEqual(f.requests.map(request=>request.url.pathname),['/robots.txt','/','/prestations']);
  assert.equal(result.content?.length,5);
  const declared=result.content!.map(block=>`${block.title} ${block.excerpt}`).join(' ');
  assert.match(declared,/Rénovation de façades/);assert.equal(declared.match(/Rénovation de façades/g)?.length,1);
  assert.match(declared,/Maison de quartier/);assert.match(declared,/Particuliers et commerces à Montpellier/);assert.match(declared,/préparation des supports/);
  assert.ok(!/menu à exclure|Déclaration masquée|Contenu du script|pied de page à exclure/.test(declared));
  assert.ok(result.content!.every(block=>block.url===`${origin}/`||block.url===`${origin}/prestations`));
  assert.ok(result.content!.every(block=>block.collectedAt==='2026-10-04T10:00:00.000Z'));
  assert.ok(!result.findings.some(finding=>/clientèle|réalisations|refonte|demande d’achat/.test(finding.note)));
  assert.match(result.warnings.join(' '),/déclarés par le site.*n’est pas exhaustive.*ne vérifie pas/);
});

test('les extraits sont bornés explicitement par page et les autres blocs ne deviennent pas des constats', async () => {
  const f=fixture({[`${origin}/`]:html(Array.from({length:12},(_,index)=>`<h2>Prestation ${index}</h2><p>${'Présentation publique. '.repeat(100)}</p>`).join(''))});
  const result=await f.analyze(origin);
  assert.equal(result.content?.length,8);assert.ok(result.content!.every(block=>block.title.length<=160&&block.excerpt.length<=1200));
  assert.match(result.warnings.join(' '),/atteignent une limite de collecte/);
  assert.ok(!result.findings.some(finding=>/Prestation \d|Présentation publique/.test(finding.note)));
});

test('une page sans présentation structurée garde une couverture explicite sans déclarations inventées', async () => {
  const f=fixture({[`${origin}/`]:html('<div id="root"></div><script>window.services=["Peinture"]</script>')});
  const result=await f.analyze(origin);assert.deepEqual(result.content,[]);assert.match(result.warnings.join(' '),/JavaScript non lus/);
});
