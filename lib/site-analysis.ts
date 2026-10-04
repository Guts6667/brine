import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { z } from 'zod';

// Values stay on the Node server; clients may import SiteAnalysis with `import type`.
if (typeof window !== 'undefined') throw new Error('L’analyse des sites est réservée au serveur.');

export interface SiteAnalysis {
  website: string;
  analyzedOn: string;
  pages: Array<{ url: string; title: string }>;
  contacts: Array<{ kind: 'email' | 'phone' | 'formUrl'; value: string; sourceUrl: string }>;
  findings: Array<{
    id: string;
    key: 'mobile' | 'mainAction' | 'contact' | 'services' | 'siteAge' | 'technical';
    note: string;
    sourceUrl: string;
    approach?: string;
  }>;
  warnings: string[];
}

export interface SiteAddress { address: string; family: 4 | 6 }
export interface SiteResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
}
export interface SiteRequest {
  url: URL;
  address: SiteAddress;
  lookup: LookupFunction;
  signal: AbortSignal;
  maxBytes: number;
  userAgent: string;
}
/** Injectable transport keeps security checks in the analyzer, including in tests. */
export interface SiteAnalysisDependencies {
  resolve: (hostname: string, signal: AbortSignal) => Promise<SiteAddress[]>;
  request: (request: SiteRequest) => Promise<SiteResponse>;
  now?: () => Date;
  timeoutMs?: number;
}

const USER_AGENT = 'BrineBot/1.0';
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_ROBOTS_BYTES = 64 * 1024;
const MAX_REDIRECTS = 4;
const MAX_REQUESTS = 20;
const DEFAULT_TIMEOUT_MS = 20_000;
const STATIC_WARNING = 'Analyse du HTML public uniquement : aucun JavaScript exécuté, aucun audit visuel du rendu mobile ni test de visibilité dans ChatGPT ou Claude.';
const publicEmailSchema = z.email();
let activeAnalyses = 0;

class SiteError extends Error {}

function cleanText(value: string, max = 300): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parisDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function ipv6Words(address: string): number[] | undefined {
  if (address.includes('.') || address.includes('%')) return;
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  const words = [...left, ...Array(Math.max(0, fill)).fill('0'), ...right].map(word => Number.parseInt(word, 16));
  return words.length === 8 && words.every(word => Number.isInteger(word) && word >= 0 && word <= 65535) ? words : undefined;
}

/** Conservative global-unicast allowlist: reserved and transition ranges stay blocked. */
export function isPublicSiteAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  const words = ipv6Words(address);
  if (!words || words[0] < 0x2000 || words[0] > 0x3fff) return false;
  // IETF special assignments, documentation, 6to4 and documentation v2.
  return !((words[0] === 0x2001 && (words[1] <= 0x01ff || words[1] === 0x0db8))
    || words[0] === 0x2002 || (words[0] === 0x3fff && words[1] <= 0x0fff));
}

export function normalizePublicSiteUrl(value: string, base?: URL): URL {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value.trim())) {
    throw new SiteError('Adresse du site invalide. Utilisez une URL publique HTTP ou HTTPS.');
  }
  let url: URL;
  try { url = new URL(base ? value : (/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value.trim()}`), base); }
  catch { throw new SiteError('Adresse du site invalide.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) {
    throw new SiteError('Seuls les sites HTTP ou HTTPS publics, sans identifiants et sur les ports 80 ou 443, sont autorisés.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || /\.(?:localhost|local|internal|home|lan)$/.test(hostname)
    || (!isIP(hostname) && !hostname.includes('.')) || (isIP(hostname) && !isPublicSiteAddress(hostname))) {
    throw new SiteError('L’accès aux adresses locales, privées ou réservées est interdit.');
  }
  url.hash = '';
  return url;
}

function abortError(): SiteError { return new SiteError('Le délai maximal de l’analyse est atteint. Réessayez ou vérifiez le site manuellement.'); }

function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const aborted = () => reject(abortError());
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

const resolveSiteHostname: SiteAnalysisDependencies['resolve'] = async hostname => (
  await dnsLookup(hostname, { all: true, verbatim: true })
).map(item => ({ address: item.address, family: item.family as 4 | 6 }));

async function publicAddresses(url: URL, resolve: SiteAnalysisDependencies['resolve'], signal: AbortSignal): Promise<SiteAddress[]> {
  if (signal.aborted) throw abortError();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family: family as 4 | 6 }] : await bounded(resolve(hostname, signal), signal);
  if (!addresses.length || addresses.some(address => ![4, 6].includes(address.family) || isIP(address.address) !== address.family || !isPublicSiteAddress(address.address))) {
    throw new SiteError('La résolution DNS du site contient une adresse locale, privée ou réservée ; accès refusé.');
  }
  return addresses;
}

/** For external audit APIs. Direct fetches must additionally pin their socket like the analyzer does. */
export async function validatePublicSiteUrl(value: string, signal: AbortSignal = AbortSignal.timeout(6000)): Promise<URL> {
  const url = normalizePublicSiteUrl(value);
  await publicAddresses(url, resolveSiteHostname, signal);
  return url;
}

/** Node never performs a second DNS lookup: every socket is pinned to the checked IP. */
export const requestSiteResource = async (options: SiteRequest): Promise<SiteResponse> => {
  return new Promise((resolve, reject) => {
    const { url, address, signal, lookup, maxBytes, userAgent } = options;
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', agent: false, lookup, signal,
      headers: { 'User-Agent': userAgent, Accept: 'text/html, application/xhtml+xml, text/plain;q=0.9', 'Accept-Encoding': 'identity' },
    }, response => {
      const status = response.statusCode || 0;
      const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]));
      if (status >= 300 && status < 400) {
        response.destroy();
        resolve({ status, headers, body: '' });
        return;
      }
      if (headers['content-encoding'] && headers['content-encoding'] !== 'identity') {
        response.destroy();
        reject(new SiteError('Le serveur impose un contenu compressé non analysable par cette vérification.'));
        return;
      }
      if (Number(headers['content-length']) > maxBytes) {
        response.destroy();
        reject(new SiteError('La page dépasse la taille maximale autorisée pour l’analyse.'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy(new SiteError('La page dépasse la taille maximale autorisée pour l’analyse.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('aborted', () => reject(new SiteError('Le serveur a interrompu la réponse.')));
      response.on('end', () => {
        const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(headers['content-type'] || '')?.[1] || 'utf-8';
        let body: string;
        try { body = new TextDecoder(charset).decode(Buffer.concat(chunks)); }
        catch { body = Buffer.concat(chunks).toString('utf8'); }
        resolve({ status, headers, body });
      });
    });
    request.on('socket', socket => {
      const verify = () => {
        const remote = socket.remoteAddress?.replace(/^::ffff:/, '');
        const expected = address.address;
        const equal = remote === expected || (!!remote && isIP(remote) === 6 && isIP(expected) === 6
          && JSON.stringify(ipv6Words(remote)) === JSON.stringify(ipv6Words(expected)));
        if (!remote || !isPublicSiteAddress(remote) || !equal) request.destroy(new SiteError('La connexion réseau ne correspond pas à l’adresse publique vérifiée.'));
      };
      socket.once('connect', verify);
    });
    request.setTimeout(6000, () => request.destroy(new SiteError('Le site ne répond pas dans le délai prévu.')));
    request.on('error', reject);
    request.end();
  });
};

type RobotsRule = { allow: boolean; pattern: string };
type RobotsPolicy = { rules: RobotsRule[]; delayMs: number };

function parseRobots(body: string): RobotsPolicy {
  const groups: Array<{ agents: string[]; rules: RobotsRule[]; delayMs: number }> = [];
  let group = { agents: [] as string[], rules: [] as RobotsRule[], delayMs: 0 };
  let directives = false;
  for (const line of body.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const cleaned = line.split('#', 1)[0].trim();
    const match = /^([^:]+):\s*(.*)$/.exec(cleaned);
    if (!match) continue;
    const key = match[1].trim().toLowerCase(), value = match[2].trim();
    if (key === 'user-agent') {
      if (directives) { groups.push(group); group = { agents: [], rules: [], delayMs: 0 }; directives = false; }
      group.agents.push(value.toLowerCase());
    } else if (group.agents.length && (key === 'allow' || key === 'disallow')) {
      directives = true;
      if (value) group.rules.push({ allow: key === 'allow', pattern: value });
    } else if (group.agents.length && key === 'crawl-delay') {
      directives = true;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) group.delayMs = Math.max(group.delayMs, seconds * 1000);
    }
  }
  if (group.agents.length) groups.push(group);
  const specificity = (agents: string[]) => Math.max(-1, ...agents.map(agent => agent === '*' ? 0 : agent && 'brinebot'.startsWith(agent) ? agent.length : -1));
  const best = Math.max(-1, ...groups.map(group => specificity(group.agents)));
  const chosen = groups.filter(group => specificity(group.agents) === best && best >= 0);
  return { rules: chosen.flatMap(group => group.rules), delayMs: Math.max(0, ...chosen.map(group => group.delayMs)) };
}

function robotsComparable(value: string): string {
  return value.replace(/[^\x00-\x7f]+/g, text => encodeURIComponent(text)).replace(/%[0-9a-f]{2}/gi, encoded => {
    const character = String.fromCharCode(Number.parseInt(encoded.slice(1), 16));
    return /^[A-Za-z0-9._~-]$/.test(character) ? character : encoded.toUpperCase();
  });
}

function matchesRobotsPattern(path: string, pattern: string, anchored: boolean): boolean {
  // Greedy wildcard matching avoids regex backtracking on an untrusted robots.txt.
  let position = 0, cursor = 0, wildcard = -1, retry = 0;
  while (position < path.length) {
    if (cursor === pattern.length && !anchored) return true;
    if (pattern[cursor] === '*') { wildcard = cursor++; retry = position; }
    else if (pattern[cursor] === path[position]) { position++; cursor++; }
    else if (wildcard >= 0) { cursor = wildcard + 1; position = ++retry; }
    else return false;
  }
  while (pattern[cursor] === '*') cursor++;
  return cursor === pattern.length;
}

function robotsAllows(url: URL, rules: RobotsRule[]): boolean {
  const path = robotsComparable(`${url.pathname}${url.search}`);
  let winner: { length: number; allow: boolean } | undefined;
  for (const rule of rules) {
    const anchored = rule.pattern.endsWith('$');
    const pattern = robotsComparable(anchored ? rule.pattern.slice(0, -1) : rule.pattern);
    if (!matchesRobotsPattern(path, pattern, anchored)) continue;
    const length = Buffer.byteLength(pattern.replace(/\*/g, ''));
    if (!winner || length > winner.length || (length === winner.length && rule.allow)) winner = { length, allow: rule.allow };
  }
  return winner?.allow ?? true;
}

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;
type Link = { url: URL; label: string; contact: boolean; services: boolean; action: boolean };
type ParsedPage = { title: string; contacts: SiteAnalysis['contacts']; links: Link[]; viewport: boolean; visibleLength: number; scripts: number };
const attr = (node: HtmlElement, name: string) => node.attrs.find(attribute => attribute.name === name)?.value || '';
const ignoredTags = new Set(['script', 'style', 'template', 'noscript']);

function textContent(root: HtmlNode): string {
  const chunks: string[] = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.nodeName === '#text') chunks.push((node as DefaultTreeAdapterTypes.TextNode).value);
    else if ('childNodes' in node && !ignoredTags.has(node.nodeName)
      && !('tagName' in node && (node.attrs.some(attribute => attribute.name === 'hidden') || attr(node, 'aria-hidden') === 'true'))) {
      pending.push(...[...node.childNodes].reverse());
    }
  }
  return chunks.join(' ');
}

function normalizePhone(raw: string): string | undefined {
  const value = raw.replace(/^tel:/i, '').split(/[;?]/, 1)[0].trim().replace(/^\+33\s*\(0\)/, '+33');
  if (!/^[+\d\s().-]+$/.test(value)) return;
  const digits = value.replace(/\D/g, '');
  if (value.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (/^0[1-9]\d{8}$/.test(digits)) return digits;
}

function parsePage(body: string, url: URL): ParsedPage {
  const document = parse(body);
  const elements: HtmlElement[] = [];
  const pending: HtmlNode[] = [document];
  let scripts = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if ('tagName' in node) {
      if (node.tagName === 'script') scripts++;
      if (ignoredTags.has(node.tagName) || node.attrs.some(attribute => attribute.name === 'hidden') || attr(node, 'aria-hidden') === 'true') continue;
      elements.push(node);
    }
    if ('childNodes' in node) pending.push(...[...node.childNodes].reverse());
  }
  const content = textContent(elements.find(node => node.tagName === 'body') || document);
  const contacts: SiteAnalysis['contacts'] = [];
  const addContact = (kind: SiteAnalysis['contacts'][number]['kind'], value: string) => {
    if (contacts.length < 30 && !contacts.some(contact => contact.kind === kind && contact.value === value)) contacts.push({ kind, value, sourceUrl: url.href });
  };
  const addEmail = (value: string) => {
    if (value.length <= 254 && publicEmailSchema.safeParse(value).success) addContact('email', value);
  };
  for (const email of content.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi) || []) addEmail(email);
  for (const match of content.matchAll(/(?<![\w\d])(?:\+33[\s.-]*(?:\(0\)[\s.-]*)?[1-9]|0[1-9])(?:[\s.()-]*\d){8}(?![\w\d])/g)) {
    const phone = normalizePhone(match[0]);
    if (phone) addContact('phone', phone);
  }
  const links: Link[] = [];
  for (const element of elements) {
    if (element.tagName === 'form') {
      const nodes: HtmlNode[] = [element];
      const controls: HtmlElement[] = [];
      while (nodes.length) {
        const child = nodes.pop()!;
        if ('tagName' in child) {
          if (ignoredTags.has(child.tagName) || child.attrs.some(attribute => attribute.name === 'hidden') || attr(child, 'aria-hidden') === 'true') continue;
          if (['input', 'textarea', 'select'].includes(child.tagName) && !child.attrs.some(attribute => attribute.name === 'disabled')
            && !['hidden', 'submit', 'button', 'reset', 'search'].includes(attr(child, 'type').toLowerCase())) controls.push(child);
        }
        if ('childNodes' in child) nodes.push(...child.childNodes);
      }
      const formContext = `${attr(element, 'id')} ${attr(element, 'action')} ${textContent(element)}`.toLowerCase();
      const messaging = controls.some(control => control.tagName === 'textarea' || ['email', 'tel'].includes(attr(control, 'type'))
        || /email|e-mail|phone|telephone|message/.test(attr(control, 'name').toLowerCase()));
      const contactContext = /contact|devis|message|rendez.vous/.test(formContext);
      if (controls.length && (messaging || contactContext) && !(/newsletter|subscribe|abonn/.test(formContext) && !contactContext)) addContact('formUrl', url.href);
    }
    if (element.tagName !== 'a') continue;
    const href = attr(element, 'href').trim();
    if (/^mailto:/i.test(href)) {
      try { for (const email of decodeURIComponent(href.slice(7).split('?', 1)[0]).split(/[,;]/)) addEmail(email.trim()); }
      catch { /* Malformed public link is not an invented contact. */ }
      continue;
    }
    if (/^tel:/i.test(href)) {
      try { const phone = normalizePhone(decodeURIComponent(href)); if (phone) addContact('phone', phone); }
      catch { /* Ignore malformed URI encoding. */ }
      continue;
    }
    if (!href || href.startsWith('#')) continue;
    let target: URL;
    try { target = normalizePublicSiteUrl(href, url); } catch { continue; }
    if (target.origin !== url.origin) continue;
    const label = cleanText(textContent(element) || attr(element, 'aria-label') || attr(element, 'title'), 100);
    const context = `${label} ${target.pathname}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    links.push({ url: target, label, contact: /contact|devis|rendez.vous/.test(context), services: /prestation|service|activite|savoir.faire/.test(context),
      action: /devis|rendez.vous|reserv|appelez|appeler|contactez|demander/.test(context) });
  }
  const titleElement = elements.find(node => node.tagName === 'title');
  return { title: titleElement ? cleanText(textContent(titleElement), 160) : '', contacts, links,
    viewport: elements.some(node => node.tagName === 'meta' && attr(node, 'name').toLowerCase() === 'viewport' && !!attr(node, 'content')),
    visibleLength: cleanText(content, MAX_HTML_BYTES).length, scripts };
}

function safeMessage(error: unknown): string {
  return error instanceof SiteError ? error.message : 'Le site ou sa résolution DNS est indisponible. Vérifiez son adresse ou réessayez plus tard.';
}

export function createSiteAnalyzer(dependencies: SiteAnalysisDependencies) {
  return async (website: string): Promise<SiteAnalysis> => {
    const initial = normalizePublicSiteUrl(website);
    if (activeAnalyses >= 4) throw new SiteError('Plusieurs analyses sont déjà en cours. Réessayez dans quelques instants.');
    activeAnalyses++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(DEFAULT_TIMEOUT_MS, Math.max(1, dependencies.timeoutMs || DEFAULT_TIMEOUT_MS)));
    const signal = controller.signal;
    const result: SiteAnalysis = { website: initial.href, analyzedOn: parisDate(dependencies.now?.() || new Date()), pages: [], contacts: [], findings: [], warnings: [STATIC_WARNING] };
    const policies = new Map<string, Promise<RobotsPolicy>>();
    const lastAccess = new Map<string, number>();
    let requests = 0;
    const warn = (warning: string) => { if (!result.warnings.includes(warning)) result.warnings.push(warning); };
    const requestOnce = async (target: URL, maxBytes: number) => {
      const url = normalizePublicSiteUrl(target.href);
      if (signal.aborted) throw abortError();
      if (++requests > MAX_REQUESTS) throw new SiteError('Le site multiplie les redirections ; la limite de requêtes est atteinte.');
      const addresses = await publicAddresses(url, dependencies.resolve, signal);
      const address = addresses.find(address => address.family === 4) || addresses[0];
      const lookup: LookupFunction = (_hostname, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      };
      const response = await bounded(dependencies.request({ url, address, lookup, signal, maxBytes, userAgent: USER_AGENT }), signal);
      if (Buffer.byteLength(response.body) > maxBytes) throw new SiteError('La page dépasse la taille maximale autorisée pour l’analyse.');
      return response;
    };
    const loadPolicy = async (origin: string): Promise<RobotsPolicy> => {
      let target = new URL('/robots.txt', origin);
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await requestOnce(target, MAX_ROBOTS_BYTES);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (!response.headers.location || hop === MAX_REDIRECTS) throw new SiteError('robots.txt redirige trop souvent ou sans adresse cible ; l’analyse est suspendue.');
          target = normalizePublicSiteUrl(response.headers.location, target);
          continue;
        }
        if ([404, 410].includes(response.status)) return { rules: [], delayMs: 0 };
        if ([401, 403].includes(response.status)) throw new SiteError('L’accès à robots.txt est refusé par le site ; aucune page n’a été explorée.');
        if (response.status < 200 || response.status >= 300) throw new SiteError(`robots.txt est indisponible (HTTP ${response.status}) ; les pages de cet hôte ne sont pas explorées.`);
        if (/text\/html/i.test(response.headers['content-type'] || '') || /^\s*<(?:!doctype|html|head|body)\b/i.test(response.body)) {
          throw new SiteError('Le site renvoie une page HTML à la place de robots.txt ; ses règles ne peuvent pas être vérifiées.');
        }
        return parseRobots(response.body);
      }
      throw new SiteError('Les règles robots.txt ne peuvent pas être vérifiées.');
    };
    const fetchPage = async (first: URL, origin?: string): Promise<{ url: URL; response: SiteResponse }> => {
      let target = first;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        normalizePublicSiteUrl(target.href);
        if (origin && target.origin !== origin) throw new SiteError('Un lien interne redirige vers un autre site ; il n’a pas été analysé.');
        if (!policies.has(target.origin)) policies.set(target.origin, loadPolicy(target.origin).catch(error => {
          throw new SiteError(`Impossible de vérifier robots.txt pour ${target.origin} : ${safeMessage(error)} Les pages de cet hôte ne sont pas explorées.`);
        }));
        const policy = await policies.get(target.origin)!;
        if (!robotsAllows(target, policy.rules)) throw new SiteError(`robots.txt interdit l’exploration de ${target.href} par BrineBot.`);
        const waitMs = (lastAccess.get(target.origin) || 0) + policy.delayMs - Date.now();
        if (waitMs > 0) await bounded(new Promise<void>(resolve => {
          const delayTimer = setTimeout(resolve, Math.min(waitMs, DEFAULT_TIMEOUT_MS));
          signal.addEventListener('abort', () => { clearTimeout(delayTimer); resolve(); }, { once: true });
        }), signal);
        if (signal.aborted) throw abortError();
        lastAccess.set(target.origin, Date.now());
        const response = await requestOnce(target, MAX_HTML_BYTES);
        if (![301, 302, 303, 307, 308].includes(response.status)) return { url: target, response };
        if (!response.headers.location || hop === MAX_REDIRECTS) throw new SiteError('Le site redirige trop souvent ou sans adresse cible.');
        target = normalizePublicSiteUrl(response.headers.location, target);
      }
      throw new SiteError('La page ne peut pas être consultée.');
    };
    const addFinding = (key: SiteAnalysis['findings'][number]['key'], note: string, sourceUrl: string, approach?: string) => {
      result.findings.push({ id: `${key}-${result.findings.length + 1}`, key, note, sourceUrl, ...(approach ? { approach } : {}) });
    };
    const inspect = (url: URL, response: SiteResponse): ParsedPage | undefined => {
      if (response.status < 200 || response.status >= 300) { warn(`La page ${url.href} répond HTTP ${response.status}.`); return; }
      const contentType = response.headers['content-type'] || '';
      if ((!/^(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType) && contentType)
        || (!contentType && !/^\s*<(?:!doctype|html|head|body)\b/i.test(response.body))) {
        warn(`La page ${url.href} ne fournit pas de contenu HTML analysable.`); return;
      }
      const page = parsePage(response.body, url);
      result.pages.push({ url: url.href, title: page.title });
      for (const contact of page.contacts) if (result.contacts.length < 30 && !result.contacts.some(item => item.kind === contact.kind && item.value.toLowerCase() === contact.value.toLowerCase())) result.contacts.push(contact);
      if (page.contacts.length) addFinding('contact', `${page.contacts.length} moyen(s) de contact publié(s) détecté(s) dans le HTML de cette page.`, url.href);
      if (page.visibleLength < 120 && page.scripts) warn(`Le contenu HTML de ${url.href} est très limité et comporte des scripts ; des informations chargées par JavaScript peuvent manquer.`);
      return page;
    };
    try {
      const home = await fetchPage(initial);
      result.website = home.url.href;
      if ([404, 410].includes(home.response.status) || (home.response.status >= 500 && home.response.status <= 599)) {
        addFinding('technical', `L’accueil du site répond HTTP ${home.response.status} lors de la vérification du ${result.analyzedOn}.`, home.url.href,
          `Lors de cette vérification, l’accueil renvoie HTTP ${home.response.status} ; proposer de vérifier sa disponibilité et l’adresse utilisée.`);
      }
      const homepage = inspect(home.url, home.response);
      if (!homepage) return result;
      addFinding('mobile', homepage.viewport
        ? 'Une balise viewport est présente dans le HTML. Le rendu sur mobile reste à vérifier visuellement.'
        : 'Aucune balise viewport n’a été détectée dans le HTML reçu. Le rendu sur mobile reste à vérifier visuellement.', home.url.href,
        homepage.viewport ? undefined : 'J’ai remarqué l’absence de balise viewport dans le HTML ; proposer de vérifier ensemble le rendu sur téléphone.');
      const action = homepage.links.find(link => link.action);
      if (action) addFinding('mainAction', `Lien d’action détecté : « ${action.label || action.url.pathname} » vers ${action.url.href}.`, home.url.href);
      const service = homepage.links.find(link => link.services);
      if (service) addFinding('services', `Lien de prestations détecté : « ${service.label || service.url.pathname} » vers ${service.url.href}.`, home.url.href);
      const candidates = homepage.links.filter(link => link.contact || link.services)
        .sort((a, b) => Number(b.contact) - Number(a.contact));
      const visited = new Set([home.url.href]);
      for (const link of candidates) {
        if (visited.has(link.url.href)) continue;
        if (visited.size >= 3 || signal.aborted) break;
        visited.add(link.url.href);
        try {
          const fetched = await fetchPage(link.url, home.url.origin);
          if ([404, 410].includes(fetched.response.status) || (fetched.response.status >= 500 && fetched.response.status <= 599)) {
            addFinding('technical', `Le lien « ${link.label || link.url.pathname} » répond HTTP ${fetched.response.status} lors de la vérification du ${result.analyzedOn}.`, fetched.url.href,
              `La page ${link.contact ? 'de contact' : 'de prestations'} liée au site renvoie HTTP ${fetched.response.status} ; proposer de vérifier cet accès.`);
          }
          if (!result.pages.some(page => page.url === fetched.url.href)) inspect(fetched.url, fetched.response);
        } catch (error) { warn(safeMessage(error)); }
      }
      if (!result.contacts.length) warn('Aucun contact exploitable détecté dans les pages HTML consultées. Des coordonnées présentées en image ou chargées par JavaScript peuvent nécessiter une vérification manuelle.');
      return result;
    } catch (error) { warn(safeMessage(error)); return result; }
    finally { clearTimeout(timer); controller.abort(); activeAnalyses--; }
  };
}

export const analyzeSite: (website: string) => Promise<SiteAnalysis> = createSiteAnalyzer({
  resolve: resolveSiteHostname,
  request: requestSiteResource,
});
