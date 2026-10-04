import { z } from 'zod';

export interface CompanyCandidate {
  siren: string;
  siret: string;
  name: string;
  city: string;
  business: string;
  activityCode: string;
  address: string;
  sourceUrl: string;
}
export interface CompanySearchInput { city: string; activityCodes: string; query: string; page: number }
export interface CompanySearchResult {
  companies: CompanyCandidate[];
  /** Registry counts include legal units whose matching local establishment has since closed. */
  total: number;
  page: number;
  totalPages: number;
  commune: { code: string; name: string };
}

const SEARCH_URL = 'https://recherche-entreprises.api.gouv.fr/search';
const GEO_URL = 'https://geo.api.gouv.fr/communes';
const PAGE_SIZE = 20;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const COMMUNE_CODE = /^(?:\d{5}|2[AB]\d{3})$/;
const NAF_CODE = /^\d{2}\.\d{2}[A-Z]$/;

// NAF rév. 2 labels: https://xml.insee.fr/schema/naf-enum.html.
const ACTIVITY_LABELS: Record<string, string> = {
  '41.20A': 'Construction de maisons individuelles',
  '43.21A': "Travaux d’installation électrique dans tous locaux",
  '43.22A': "Travaux d’installation d’eau et de gaz en tous locaux",
  '43.22B': "Travaux d’installation d’équipements thermiques et de climatisation",
  '43.29A': "Travaux d’isolation",
  '43.31Z': 'Travaux de plâtrerie',
  '43.32A': 'Travaux de menuiserie bois et PVC',
  '43.32B': 'Travaux de menuiserie métallique et serrurerie',
  '43.32C': 'Agencement de lieux de vente',
  '43.33Z': 'Travaux de revêtement des sols et des murs',
  '43.34Z': 'Travaux de peinture et vitrerie',
  '43.39Z': 'Autres travaux de finition',
  '43.99C': 'Travaux de maçonnerie générale et gros œuvre de bâtiment',
};

function normalizeActivityCode(value: string): string {
  return value.toUpperCase().replace(/^(\d{2})(\d{2}[A-Z])$/, '$1.$2');
}

export function parseSearchInput(input: unknown): CompanySearchInput {
  const parsed = z.object({
    city: z.string().trim().min(1).max(180),
    activityCodes: z.string().trim().max(500).default(''),
    query: z.string().trim().max(180).default(''),
    page: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
      .pipe(z.number().int().min(1).max(1000)).default(1),
  }).safeParse(input);
  if (!parsed.success) throw new Error('Renseignez une commune, des codes NAF valides et un numéro de page entre 1 et 1 000.');
  const codes = [...new Set(parsed.data.activityCodes.split(/[\s,;]+/).filter(Boolean).map(normalizeActivityCode))];
  if (codes.length > 20 || codes.some(code => !NAF_CODE.test(code))) {
    throw new Error('Utilisez au maximum 20 codes NAF au format 43.32A, séparés par des virgules.');
  }
  return { ...parsed.data, activityCodes: codes.join(',') };
}

const optionalText = (maximum: number) => z.string().max(maximum).nullish();
const establishmentSchema = z.object({
  siret: z.string().regex(/^\d{14}$/),
  commune: optionalText(5),
  libelle_commune: optionalText(180),
  adresse: optionalText(2000),
  etat_administratif: optionalText(2),
});
const legalUnitSchema = z.object({
  siren: z.string().regex(/^\d{9}$/),
  nom_complet: optionalText(1000),
  nom_raison_sociale: optionalText(1000),
  activite_principale: optionalText(10),
  etat_administratif: optionalText(2),
  siege: establishmentSchema.nullish(),
  matching_etablissements: z.array(establishmentSchema).max(100).nullish(),
});
const searchResponseSchema = z.object({
  results: z.array(legalUnitSchema).max(25),
  total_results: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  per_page: z.number().int().min(1).max(25),
  total_pages: z.number().int().nonnegative(),
});
const communeSchema = z.object({ code: z.string().regex(COMMUNE_CODE), nom: z.string().min(1).max(180) });
type LegalUnit = z.infer<typeof legalUnitSchema>;
type Establishment = z.infer<typeof establishmentSchema>;
class RegistryServiceError extends Error {}

async function requestJson(url: URL, service: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: 'no-store', signal: controller.signal, redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 429) throw new RegistryServiceError(`${service} reçoit trop de demandes. Réessayez dans quelques instants.`);
    if (!response.ok) throw new RegistryServiceError(`${service} est indisponible pour le moment. Réessayez plus tard.`);
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new RegistryServiceError(`${service} a renvoyé une réponse invalide.`);
    }
    const announcedLength = Number(response.headers.get('content-length') || 0);
    if (announcedLength > MAX_BYTES) throw new RegistryServiceError(`${service} a renvoyé une réponse trop volumineuse.`);
    const reader = response.body?.getReader();
    if (!reader) throw new RegistryServiceError(`${service} a renvoyé une réponse vide.`);
    const decoder = new TextDecoder();
    let bytes = 0, body = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel();
          throw new RegistryServiceError(`${service} a renvoyé une réponse trop volumineuse.`);
        }
        body += decoder.decode(value, { stream: true });
      }
    } finally { reader.releaseLock(); }
    body += decoder.decode();
    try { return JSON.parse(body) as unknown; }
    catch { throw new RegistryServiceError(`${service} a renvoyé une réponse invalide.`); }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${service} met trop de temps à répondre. Réessayez.`);
    if (error instanceof RegistryServiceError) throw error;
    throw new Error(`${service} est injoignable pour le moment. Réessayez.`);
  } finally { clearTimeout(timeout); }
}

function normalizedName(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function resolveCommune(city: string): Promise<{ code: string; name: string }> {
  const service = 'Le service des communes';
  const code = city.toUpperCase();
  if (COMMUNE_CODE.test(code)) {
    const url = new URL(`${GEO_URL}/${code}`);
    url.searchParams.set('fields', 'code,nom');
    const parsed = communeSchema.safeParse(await requestJson(url, service));
    if (!parsed.success || parsed.data.code !== code) throw new Error('Ce code INSEE de commune est introuvable.');
    return { code: parsed.data.code, name: parsed.data.nom };
  }
  const url = new URL(GEO_URL);
  url.searchParams.set('nom', city);
  url.searchParams.set('fields', 'code,nom');
  url.searchParams.set('limit', '50');
  const parsed = z.array(communeSchema).max(50).safeParse(await requestJson(url, service));
  if (!parsed.success) throw new Error('Le service des communes a renvoyé une réponse invalide.');
  const exact = parsed.data.filter(commune => normalizedName(commune.nom) === normalizedName(city));
  if (exact.length === 1) return { code: exact[0].code, name: exact[0].nom };
  if (exact.length > 1) throw new Error('Plusieurs communes portent ce nom. Renseignez leur code INSEE pour choisir la bonne.');
  const suggestions = parsed.data.slice(0, 3).map(commune => `${commune.nom} (${commune.code})`).join(', ');
  throw new Error(suggestions ? `Commune à préciser. Utilisez le nom exact ou le code INSEE : ${suggestions}.` : 'Commune introuvable. Vérifiez son nom ou utilisez son code INSEE.');
}

function searchUrl(): URL {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('minimal', 'true');
  url.searchParams.set('include', 'matching_etablissements,siege');
  url.searchParams.set('limite_matching_etablissements', '100');
  url.searchParams.set('per_page', String(PAGE_SIZE));
  return url;
}

async function fetchSearch(url: URL): Promise<z.infer<typeof searchResponseSchema>> {
  const parsed = searchResponseSchema.safeParse(await requestJson(url, 'Le registre des entreprises'));
  if (!parsed.success) throw new Error('Le registre des entreprises a renvoyé une réponse invalide.');
  return parsed.data;
}

function candidate(unit: LegalUnit, establishment: Establishment): CompanyCandidate | null {
  const name = (unit.nom_raison_sociale || unit.nom_complet || '').trim();
  const city = establishment.libelle_commune?.trim() || '';
  if (unit.etat_administratif !== 'A' || establishment.etat_administratif !== 'A' ||
      !establishment.siret.startsWith(unit.siren) || !name || name.length > 180 || !city) return null;
  // The API activity filter applies to the legal unit, whereas the address is local to the selected establishment.
  const activityCode = unit.activite_principale || '';
  const source = searchUrl();
  source.searchParams.set('q', establishment.siret);
  source.searchParams.set('per_page', '1');
  return {
    siren: unit.siren, siret: establishment.siret, name, city,
    business: ACTIVITY_LABELS[activityCode] || (activityCode ? `Activité NAF ${activityCode}` : ''),
    activityCode, address: establishment.adresse?.trim() || '', sourceUrl: source.toString(),
  };
}

export async function searchCompanies(input: CompanySearchInput): Promise<CompanySearchResult> {
  const parsed = parseSearchInput(input);
  const commune = await resolveCommune(parsed.city);
  const url = searchUrl();
  url.searchParams.set('code_commune', commune.code);
  url.searchParams.set('etat_administratif', 'A');
  url.searchParams.set('page', String(parsed.page));
  if (parsed.activityCodes) url.searchParams.set('activite_principale', parsed.activityCodes);
  if (parsed.query) url.searchParams.set('q', parsed.query);
  const response = await fetchSearch(url);
  if (response.page !== parsed.page) throw new Error('Le registre des entreprises a renvoyé une page inattendue.');
  const activityCodes = new Set(parsed.activityCodes.split(',').filter(Boolean));
  const companies: CompanyCandidate[] = [], seen = new Set<string>();
  for (const unit of response.results) {
    if (seen.has(unit.siren) || (activityCodes.size && !activityCodes.has(unit.activite_principale || ''))) continue;
    const establishments = [...(unit.matching_etablissements || []), ...(unit.siege ? [unit.siege] : [])];
    for (const establishment of establishments) {
      if (establishment.commune !== commune.code) continue;
      const company = candidate(unit, establishment);
      if (!company) continue;
      companies.push(company); seen.add(unit.siren); break;
    }
    if (companies.length === PAGE_SIZE) break;
  }
  return { companies, total: response.total_results, page: response.page, totalPages: response.total_pages, commune };
}

export async function getCompanyCandidate(siren: string, siret: string): Promise<CompanyCandidate> {
  if (typeof siren !== 'string' || typeof siret !== 'string' || !/^\d{9}$/.test(siren) || !/^\d{14}$/.test(siret) || !siret.startsWith(siren)) {
    throw new Error('Les identifiants SIREN et SIRET sont invalides. Relancez la recherche.');
  }
  const url = searchUrl();
  url.searchParams.set('q', siret);
  url.searchParams.set('per_page', '1');
  const response = await fetchSearch(url);
  for (const unit of response.results) {
    if (unit.siren !== siren) continue;
    const establishments = [...(unit.matching_etablissements || []), ...(unit.siege ? [unit.siege] : [])];
    const establishment = establishments.find(item => item.siret === siret);
    if (establishment) {
      const company = candidate(unit, establishment);
      if (company) return company;
    }
  }
  throw new Error('Cette entreprise ou cet établissement est introuvable ou fermé. Relancez la recherche.');
}
