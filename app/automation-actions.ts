'use server';

import { getCampaignRepository } from '@/lib/campaign-runtime';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAuthenticated } from '@/lib/auth';
import { isAllowedRequest } from '@/lib/security';
import { getStore } from '@/lib/db';
import { searchCompanies, parseSearchInput, getCompanyCandidate } from '@/lib/company-search';
import { analyzeSite } from '@/lib/site-analysis';
import { auditMobile } from '@/lib/mobile-audit';
import { importCompanyCandidate, applySiteSuggestions } from '@/lib/automation-storage';
import { readAnalysisPreview, sealAnalysisPreview } from '@/lib/automation-preview';
import { normalizedDomain } from '@/lib/domain';
import type { AnalysisState, SearchState, ImportState } from '@/lib/automation-types';
import type { ActionState } from '@/lib/types';

const str = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
async function authorize() {
  const h = await headers();
  if (!isAllowedRequest(h.get('host'), h.get('origin'), h.get('sec-fetch-site'))) throw new Error('Requête non autorisée.');
  await requireAuthenticated();
}
function failure(error: unknown): ActionState {
  if (error instanceof z.ZodError) return { error: error.issues[0]?.message || 'Vérifiez les informations saisies.' };
  return { error: error instanceof Error ? error.message : 'L’opération a échoué. Réessayez.' };
}
function refresh(id: string) {
  revalidatePath('/'); revalidatePath('/prospects'); revalidatePath(`/prospects/${id}`);
}
export async function searchCompaniesAction(_: SearchState, data: FormData): Promise<SearchState> {
  try {
    await authorize();
    const input = parseSearchInput({ city: str(data, 'city'), activityCodes: str(data, 'activityCodes'), query: str(data, 'query'), page: Number(str(data, 'page') || '1') });
    return { ok: true, result: await searchCompanies(input), request: input };
  } catch (error) { return failure(error); }
}
export async function importCompanyAction(_: ImportState, data: FormData): Promise<ImportState> {
  try {
    await authorize();
    const ids = z.object({ siren: z.string().regex(/^\d{9}$/), siret: z.string().regex(/^\d{14}$/) }).parse({ siren: str(data, 'siren'), siret: str(data, 'siret') });
    const candidate = await getCompanyCandidate(ids.siren, ids.siret);
    const result = await importCompanyCandidate(getStore(), candidate);
    await (await getCampaignRepository()).attach('initial',result.id);
    refresh(result.id);
    return { ok: true, companyId: result.id, message: result.duplicate ? 'Déjà dans Brine : la fiche existante est conservée.' : 'Entreprise ajoutée. Sa qualification reste à confirmer.' };
  } catch (error) { return failure(error); }
}
export async function analyzeSiteAction(id: string, _: AnalysisState, data: FormData): Promise<AnalysisState> {
  try {
    await authorize();
    const company = await getStore().getCompany(id);
    if (!company) throw new Error('Entreprise introuvable.');
    if (!company.website) throw new Error('Renseignez et enregistrez le site officiel dans les informations de la fiche.');
    const auditType = z.enum(['pages', 'mobile']).parse(str(data, 'auditType') || 'pages');
    const analysis = await (auditType === 'mobile' ? auditMobile(company.website) : analyzeSite(company.website));
    if (normalizedDomain(analysis.website) !== normalizedDomain(company.website)) {
      throw new Error(`Le site redirige vers un autre domaine : ${analysis.website}. Vérifiez cette destination, enregistrez-la dans les informations de la fiche, puis relancez l’analyse.`);
    }
    return { ok: true, analysis, previewToken: sealAnalysisPreview(id, company.updatedAt, analysis) };
  } catch (error) { return failure(error); }
}
export async function applySiteAnalysisAction(id: string, _: ActionState, data: FormData): Promise<ActionState> {
  try {
    await authorize();
    const preview = readAnalysisPreview(str(data, 'previewToken'), id);
    const selection = z.object({ contactIndexes: z.array(z.coerce.number().int().min(0).max(49)).max(20), findingIds: z.array(z.string().max(150)).max(30) })
      .parse({ contactIndexes: data.getAll('contactIndex'), findingIds: data.getAll('findingId') });
    if (!selection.contactIndexes.length && !selection.findingIds.length) throw new Error('Choisissez au moins une coordonnée ou un constat à conserver.');
    const result = await applySiteSuggestions(getStore(), id, preview.analysis, selection, preview.updatedAt);
    refresh(id);
    return { ok: true, message: `${result.contactCount} coordonnée(s) ajoutée(s), ${result.findingCount} constat(s) conservé(s) dans les notes et échanges.` };
  } catch (error) { return failure(error); }
}
