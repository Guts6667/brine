import type { CampaignRepository } from './campaign-repository';

export type BudgetRepository = Pick<CampaignRepository, 'client' | 'transaction'>;
export const OPENROUTER_MONTHLY_USD = 5;
export const APPLICATION_MONTHLY_EURO_ESTIMATE = 7;
export const USD_EURO_ESTIMATE_FACTOR = 1.35;
export const SERPAPI_MONTHLY_SEARCHES = 250;
export const SERPAPI_HOURLY_SEARCHES = 50;
const MICROS = 1_000_000;
type Provider = 'openrouter' | 'serpapi' | 'browserless';
interface Operation { operationKey: string; provider: Provider; month: string; createdAt: string; updatedAt: string; status: string; reservedUsdMicros: number; actualUsdMicros: number | null; quotaUnits: number; payload: string }
export interface ProviderState { checkedAt: string; valid: boolean; warning?: string; remaining?: number; renewalDate?: string; hourlyLimit?: number; observedHourUsed?: number; keyLimit?: number; keyReset?: string; usageMonthly?: number; credentialId?: string }

export class ResearchBudgetError extends Error { constructor(message: string) { super(message); this.name = 'ResearchBudgetError'; } }
export function budgetMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
}
function budgetDay(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}
export function serpApiDailyLimit(state: ProviderState | null, now = new Date()): number {
  const renewal = state?.renewalDate ? Date.parse(`${state.renewalDate.slice(0, 10)}T00:00:00Z`) : now.getTime() + 30 * 86_400_000;
  const days = Math.max(1, Math.ceil((renewal - now.getTime()) / 86_400_000));
  return Math.min(8, Math.max(0, Math.ceil((state?.remaining ?? SERPAPI_MONTHLY_SEARCHES) / days)));
}
const micros = (value: number) => Math.ceil(value * MICROS);
function charge(row: Operation) { return row.actualUsdMicros === null ? row.reservedUsdMicros : row.actualUsdMicros; }
export async function getProviderState(repo: BudgetRepository, provider: Provider): Promise<ProviderState | null> {
  const result = await repo.client.execute({ sql: 'SELECT payload FROM research_provider_state WHERE provider = ?', args: [provider] });
  return result.rows.length ? JSON.parse(String(result.rows[0].payload)) as ProviderState : null;
}
export async function saveProviderState(repo: BudgetRepository, provider: Provider, state: ProviderState) {
  await repo.transaction(async tx => { await tx.execute({ sql: 'INSERT INTO research_provider_state(provider,payload) VALUES (?,?) ON CONFLICT(provider) DO UPDATE SET payload = excluded.payload', args: [provider, JSON.stringify(state)] }); });
}
export async function readResearchCache<T>(repo: BudgetRepository, key: string, now = new Date()): Promise<T | null> {
  const result = await repo.client.execute({ sql: 'SELECT payload FROM research_cache WHERE cacheKey = ? AND expiresAt > ?', args: [key, now.toISOString()] });
  return result.rows.length ? JSON.parse(String(result.rows[0].payload)) as T : null;
}
export async function saveResearchCache(repo: BudgetRepository, key: string, value: unknown, lifetimeMs: number, now = new Date()) {
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload) > 2 * 1024 * 1024) throw new ResearchBudgetError('Résultat trop volumineux pour être conservé.');
  await repo.transaction(async tx => { await tx.execute({ sql: 'INSERT INTO research_cache(cacheKey,expiresAt,payload) VALUES (?,?,?) ON CONFLICT(cacheKey) DO UPDATE SET expiresAt = excluded.expiresAt, payload = excluded.payload', args: [key, new Date(now.getTime() + lifetimeMs).toISOString(), payload] }); });
}
export async function readCompletedOperation<T>(repo: BudgetRepository, key: string): Promise<T | null> {
  const result = await repo.client.execute({ sql: 'SELECT status,payload FROM research_operations WHERE operationKey = ?', args: [key] });
  if (!result.rows.length) return null;
  if (result.rows[0].status !== 'complete') throw new ResearchBudgetError('Un appel précédent a un résultat incertain. Il ne sera pas refacturé automatiquement.');
  return JSON.parse(String(result.rows[0].payload)) as T;
}
export interface OperationReservation { key: string; provider: Provider; maxUsd: number; quotaUnits?: number }
export async function reserveResearchOperation(repo: BudgetRepository, input: OperationReservation, now = new Date()): Promise<{ replay: boolean; value?: unknown }> {
  if (!input.key || input.key.length > 300 || !Number.isFinite(input.maxUsd) || input.maxUsd < 0 || input.maxUsd > OPENROUTER_MONTHLY_USD) throw new ResearchBudgetError('Réservation de recherche invalide.');
  const units = input.quotaUnits ?? (input.provider === 'serpapi' ? 1 : 0);
  if (!Number.isInteger(units) || units < 0 || units > (input.provider==='browserless'?3:1)) throw new ResearchBudgetError('Quota de recherche invalide.');
  if(input.provider==='browserless'&&(input.maxUsd!==0||units!==3))throw new ResearchBudgetError('Le rendu utilise uniquement trois unités réservées du palier gratuit.');
  return repo.transaction(async tx => {
    const previous = await tx.execute({ sql: 'SELECT status,payload FROM research_operations WHERE operationKey = ?', args: [input.key] });
    if (previous.rows.length) {
      if (previous.rows[0].status === 'complete') return { replay: true, value: JSON.parse(String(previous.rows[0].payload)) };
      throw new ResearchBudgetError('Un appel précédent a un résultat incertain. Il ne sera pas refacturé automatiquement.');
    }
    const month = budgetMonth(now), timestamp = now.toISOString();
    const stateRows = await tx.execute({ sql: 'SELECT payload FROM research_provider_state WHERE provider = ?', args: [input.provider] });
    const state = stateRows.rows.length ? JSON.parse(String(stateRows.rows[0].payload)) as ProviderState : null;
    if (input.provider!=='browserless'&&(!state?.valid || now.getTime() - Date.parse(state.checkedAt) > 24 * 60 * 60 * 1000)) throw new ResearchBudgetError(state?.warning || 'Vérifiez la configuration et les limites du fournisseur avant cette recherche.');
    const allRows = await tx.execute('SELECT operationKey,provider,month,createdAt,updatedAt,status,reservedUsdMicros,actualUsdMicros,quotaUnits FROM research_operations');
    const rows = allRows.rows as unknown as Operation[];
    if(input.provider==='browserless'){
      if(!process.env.BROWSERLESS_API_KEY||process.env.BROWSERLESS_FREE_PLAN_CONFIRMED!=='1')throw new ResearchBudgetError('Rendu non vérifié : ajoutez une clé Browserless dédiée au plan Free et confirmez ce plan côté serveur. Les autres analyses restent disponibles.');
      const since=new Date(now.getTime()-31*86400000).toISOString(),recent=rows.filter(row=>row.provider==='browserless'&&row.createdAt>=since);
      if(recent.reduce((sum,row)=>sum+row.quotaUnits,0)+units>1000)throw new ResearchBudgetError('Quota gratuit des captures atteint. Aucun passage payant.');
      if(recent.some(row=>row.status==='pending'&&Date.parse(row.createdAt)>now.getTime()-90_000))throw new ResearchBudgetError('Une capture est déjà en cours. La session reste unique.');
    }else if (input.provider === 'openrouter') {
      const used = rows.filter(row => row.month === month && row.provider === 'openrouter').reduce((total, row) => total + charge(row), 0);
      const maximum = Math.min(OPENROUTER_MONTHLY_USD, APPLICATION_MONTHLY_EURO_ESTIMATE / USD_EURO_ESTIMATE_FACTOR);
      if (used + micros(input.maxUsd) > micros(maximum)) throw new ResearchBudgetError('Budget IA du mois atteint. Les résultats déjà collectés restent disponibles.');
      // The provider cap protects against usage outside this process too.
      const sinceCheck = rows.filter(row => row.provider === 'openrouter' && row.createdAt >= state!.checkedAt).reduce((total, row) => total + charge(row), 0);
      if (typeof state!.remaining !== 'number' || state!.remaining * MICROS < sinceCheck + micros(input.maxUsd)) throw new ResearchBudgetError('Crédits ou plafond de la clé OpenRouter insuffisants.');
    } else {
      const monthUsed = rows.filter(row => row.provider === 'serpapi' && row.month === month).reduce((total, row) => total + row.quotaUnits, 0);
      const hourStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const hourUsed = rows.filter(row => row.provider === 'serpapi' && row.createdAt >= hourStart).reduce((total, row) => total + row.quotaUnits, 0);
      const sinceCheck = rows.filter(row => row.provider === 'serpapi' && (row.createdAt >= state!.checkedAt || row.status !== 'complete')).reduce((total, row) => total + row.quotaUnits, 0);
      const today = budgetDay(now), dayUsed = rows.filter(row => row.provider === 'serpapi' && budgetDay(new Date(row.createdAt)) === today).reduce((sum, row) => sum + row.quotaUnits, 0);
      const runPrefix = /^run:[^:]+:/.exec(input.key)?.[0];
      if (runPrefix && rows.filter(row => row.provider === 'serpapi' && row.operationKey.startsWith(runPrefix)).reduce((sum, row) => sum + row.quotaUnits, 0) + units > 8) throw new ResearchBudgetError('Les huit recherches Google prévues pour ce lot sont utilisées. Les résultats disponibles sont conservés.');
      if (monthUsed + units > SERPAPI_MONTHLY_SEARCHES || (state!.remaining ?? 0) < sinceCheck + units) throw new ResearchBudgetError('Quota gratuit Google du mois atteint. Aucun passage à un abonnement payant.');
      if (dayUsed + units > serpApiDailyLimit(state, now)) throw new ResearchBudgetError('Budget Google partagé du jour atteint. Revenez demain ; les autres sources et les résultats restent disponibles.');
      const providerHourUsed=state!.checkedAt>=hourStart?(state!.observedHourUsed||0)+sinceCheck:hourUsed;
      if (Math.max(hourUsed,providerHourUsed) + units > Math.min(SERPAPI_HOURLY_SEARCHES, state!.hourlyLimit ?? 0)) throw new ResearchBudgetError('Quota horaire Google atteint. Réessayez plus tard ; les résultats sont conservés.');
    }
    await tx.execute({ sql: 'INSERT INTO research_operations(operationKey,provider,month,createdAt,updatedAt,status,reservedUsdMicros,actualUsdMicros,quotaUnits,payload) VALUES (?,?,?,?,?,?,?,NULL,?,?)', args: [input.key, input.provider, month, timestamp, timestamp, 'pending', micros(input.maxUsd), units, '{}'] });
    return { replay: false };
  });
}
export async function settleResearchOperation(repo: BudgetRepository, key: string, value: unknown, actualUsd: number | null, now = new Date()) {
  if (actualUsd !== null && (!Number.isFinite(actualUsd) || actualUsd < 0)) throw new ResearchBudgetError('Coût du fournisseur invalide.');
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload) > 2 * 1024 * 1024) throw new ResearchBudgetError('Résultat trop volumineux pour être conservé.');
  // Deliberately independent of workflow generation/epoch: a cancelled request still costs money.
  await repo.transaction(async tx => { await tx.execute({ sql: "UPDATE research_operations SET status = 'complete', actualUsdMicros = ?, payload = ?, updatedAt = ? WHERE operationKey = ? AND status = 'pending'", args: [actualUsd === null ? null : micros(actualUsd), payload, now.toISOString(), key] }); });
}
export async function markResearchOperationUncertain(repo: BudgetRepository, key: string, now = new Date()) {
  await repo.transaction(async tx => { await tx.execute({ sql: "UPDATE research_operations SET status = 'uncertain', updatedAt = ? WHERE operationKey = ? AND status = 'pending'", args: [now.toISOString(), key] }); });
}
export async function runBudgetedResearch<T>(repo: BudgetRepository, input: OperationReservation, request: () => Promise<{ value: T; actualUsd: number | null }>, now = new Date()): Promise<T> {
  const reservation = await reserveResearchOperation(repo, input, now);
  if (reservation.replay) return reservation.value as T;
  try { const result = await request(); await settleResearchOperation(repo, input.key, result.value, result.actualUsd); return result.value; }
  catch (error) { await markResearchOperationUncertain(repo, input.key).catch(() => {}); throw error; }
}
export async function getBudgetOverview(repo: BudgetRepository, now = new Date()) {
  const month = budgetMonth(now), result = await repo.client.execute('SELECT operationKey,provider,month,createdAt,updatedAt,status,reservedUsdMicros,actualUsdMicros,quotaUnits FROM research_operations');
  const all = result.rows as unknown as Operation[], rows = all.filter(row => row.month === month);
  const spentUsd = rows.filter(row => row.provider === 'openrouter' && row.actualUsdMicros !== null).reduce((sum, row) => sum + Number(row.actualUsdMicros), 0) / MICROS;
  const reservedUsd = rows.filter(row => row.provider === 'openrouter' && row.actualUsdMicros === null).reduce((sum, row) => sum + row.reservedUsdMicros, 0) / MICROS;
  const serpApiUsed = rows.filter(row => row.provider === 'serpapi').reduce((sum, row) => sum + row.quotaUnits, 0);
  const localHourUsed = all.filter(row => row.provider === 'serpapi' && Date.parse(row.createdAt) >= now.getTime() - 3_600_000).reduce((sum, row) => sum + row.quotaUnits, 0);
  const states = await Promise.all([getProviderState(repo, 'serpapi'), getProviderState(repo, 'openrouter')]);
  const googleSinceCheck=states[0]?all.filter(row=>row.provider==='serpapi'&&(row.createdAt>=states[0]!.checkedAt||row.status!=='complete')).reduce((sum,row)=>sum+row.quotaUnits,0):0;
  const serpApiHourUsed=Math.max(localHourUsed,states[0]&&Date.parse(states[0].checkedAt)>=now.getTime()-3_600_000?(states[0].observedHourUsed||0)+googleSinceCheck:0);
  const serpApiDailyUsed = all.filter(row => row.provider === 'serpapi' && budgetDay(new Date(row.createdAt)) === budgetDay(now)).reduce((sum, row) => sum + row.quotaUnits, 0);
  const warnings = states.flatMap(state => state?.warning ? [state.warning] : []);
  if (all.some(row => ['pending', 'uncertain'].includes(row.status) || row.provider === 'openrouter' && row.actualUsdMicros === null)) warnings.push('Certains appels restent réservés : aucune relance payante automatique.');
  const browserlessUsed=all.filter(row=>row.provider==='browserless'&&Date.parse(row.createdAt)>=now.getTime()-31*86400000).reduce((sum,row)=>sum+row.quotaUnits,0);
  const spentEuroEstimate = spentUsd * USD_EURO_ESTIMATE_FACTOR;
  const purchases = await repo.client.execute({ sql: 'SELECT amountEuroCents FROM research_credit_purchases WHERE date LIKE ?', args: [`${month}-%`] });
  const paidEuro = purchases.rows.reduce((sum, row) => sum + Number(row.amountEuroCents), 0) / 100;
  return { browserlessUsed,browserlessRemaining:Math.max(0,1000-browserlessUsed),month, spentUsd, reservedUsd, spentEuroEstimate, paidEuro, remainingCashEuro: Math.max(0, 10 - paidEuro), remainingEuroEstimate: Math.max(0, Math.min(APPLICATION_MONTHLY_EURO_ESTIMATE - (spentUsd + reservedUsd) * USD_EURO_ESTIMATE_FACTOR, (OPENROUTER_MONTHLY_USD - spentUsd - reservedUsd) * USD_EURO_ESTIMATE_FACTOR)), monthlyLimitEuro: APPLICATION_MONTHLY_EURO_ESTIMATE, providerLimitUsd: OPENROUTER_MONTHLY_USD, serpApiUsed, serpApiRemaining: Math.max(0, Math.min(SERPAPI_MONTHLY_SEARCHES - serpApiUsed, (states[0]?.remaining ?? SERPAPI_MONTHLY_SEARCHES)-googleSinceCheck)), serpApiHourUsed, serpApiDailyUsed, serpApiDailyLimit:serpApiDailyLimit(states[0],now), renewalDate: states[0]?.renewalDate || '', warnings };
}
export async function recordCreditPurchase(repo: BudgetRepository, input: { id: string; date: string; amountEuro: number; notes?: string }) {
  const cents = Math.round(input.amountEuro * 100), date = new Date(`${input.date}T12:00:00Z`);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.id) || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date || !Number.isFinite(input.amountEuro) || input.amountEuro <= 0 || cents > 1000 || Math.abs(input.amountEuro * 100 - cents) > .00001 || (input.notes?.length || 0) > 2000) throw new ResearchBudgetError('Renseignez une date réelle et un montant payé entre 0,01 et 10 € avec deux décimales.');
  return repo.transaction(async tx => {
    const prior = await tx.execute({ sql: 'SELECT * FROM research_credit_purchases WHERE id = ?', args: [input.id] });
    if (prior.rows.length) { const row = prior.rows[0]; if (row.date !== input.date || Number(row.amountEuroCents) !== cents) throw new ResearchBudgetError('Cet achat a déjà été enregistré avec un autre montant.'); return; }
    const total = await tx.execute({ sql: 'SELECT COALESCE(SUM(amountEuroCents),0) AS total FROM research_credit_purchases WHERE date LIKE ?', args: [`${input.date.slice(0, 7)}-%`] });
    if (Number(total.rows[0].total) + cents > 1000) throw new ResearchBudgetError('Cet achat dépasserait les 10 € payés pour le mois.');
    await tx.execute({ sql: 'INSERT INTO research_credit_purchases(id,date,amountEuroCents,notes,createdAt) VALUES (?,?,?,?,?)', args: [input.id, input.date, cents, input.notes?.trim() || '', new Date().toISOString()] });
  });
}
