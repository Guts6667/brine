import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import type { Backup } from '../lib/types';
import { openFactSection, openContactChoices } from './report-helpers';

async function backup(request: APIRequestContext): Promise<Backup> {
  const response = await request.get('/api/backup');
  expect(response.ok()).toBe(true);
  return response.json();
}
async function restore(page: Page, baseline: Backup, discardedRunId?: string) {
  await page.goto('/sauvegarde');
  await page.getByLabel('Fichier de sauvegarde JSON', { exact: true }).setInputFiles({ name: 'baseline-v2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(baseline)) });
  await page.getByRole('button', { name: 'Vérifier le fichier', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Je confirme le remplacement des données par cette sauvegarde.', exact: true }).check();
  await page.getByRole('button', { name: 'Confirmer la restauration', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restauration terminée.' })).toBeVisible();
  const restored = await backup(page.request);
  for (const key of ['campaigns', 'runs', 'candidates'] as const) {
    expect(restored.campaignData![key].map(item => item.id).sort()).toEqual(baseline.campaignData![key].map(item => item.id).sort());
  }
  if (discardedRunId) expect((await page.request.get(`/api/campaign-runs/${discardedRunId}`)).status()).toBe(404);
}
async function configureProfile(page: Page) {
  await page.goto('/sauvegarde#profil');
  await page.getByLabel('Votre nom', { exact: true }).fill('Rayan');
  await page.getByLabel('Votre activité', { exact: true }).fill('développeur indépendant');
  await page.getByLabel('Compétences', { exact: true }).fill('Développement de sites web et corrections ciblées');
  await page.getByLabel('Prestations proposées', { exact: true }).fill('Sites web, présentation des prestations et parcours de contact');
  await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Votre offre et votre signature sont enregistrées.' })).toBeVisible();
}
async function launchCampaign(page: Page, request: APIRequestContext, name: string, onRunCreated?: (runId: string) => void) {
  await page.goto('/campagnes/nouvelle');
  await page.getByLabel('Nom de la campagne', { exact: true }).fill(name);
  await page.getByLabel('Commune', { exact: true }).fill('Lyon');
  await page.getByLabel('Activité recherchée', { exact: true }).fill('Électricité');
  await page.getByLabel('Mots clés de recherche', { exact: true }).fill('électricien dépannage\nélectricité Instagram');
  await page.getByLabel(/Codes d’activité NAF/).fill('43.21A');
  await page.getByLabel('Offre proposée', { exact: true }).fill('Sites web et amélioration du parcours de contact');
  await page.getByRole('button', { name: 'Créer la campagne', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('button', { name: /Lancer la recherche et l’analyse|Trouver et analyser 10 professionnels/ }).click();
  await expect(page).toHaveURL(/\/campagnes\/lots\//);
  const runUrl = page.url(), runId = new URL(runUrl).pathname.split('/').at(-1)!;
  onRunCreated?.(runId);
  // The display no longer polls this lot: the compiled production Workflow must finish alone.
  await page.goto('/campagnes');
  let completedCandidateIds: string[] = [];
  await expect.poll(async () => {
    const response = await request.get(`/api/campaign-runs/${runId}`);
    const data = await response.json();
    if (data.run.status === 'completed') completedCandidateIds = data.candidates.map((candidate: {id: string}) => candidate.id);
    return data.run.status;
  }, { timeout: 45_000 }).toBe('completed');
  const data = await backup(request), candidates = data.campaignData!.candidates.filter(candidate => candidate.runId === runId);
  expect(data.campaignData!.runs.find(run => run.id === runId)?.status).toBe('completed');
  expect(candidates.map(candidate => candidate.id).sort()).toEqual(completedCandidateIds.sort());
  expect(candidates.some(candidate => candidate.company.name === 'Atelier Social Démo')).toBe(true);
  return { campaignId, runId, runUrl, candidates };
}

test('V2 — dossier intégral, professionnel social sans site, préparation et suivi dans la campagne', async ({ page, request }) => {
  test.setTimeout(150_000);
  const baseline = await backup(request);
  let discardedRunId: string | undefined;
  try {
    await configureProfile(page);
    const { campaignId, runId, candidates } = await launchCampaign(page, request, 'V2 — première conversation', id => {discardedRunId=id;});
    const social = candidates.find(candidate => candidate.company.name === 'Atelier Social Démo')!;
    expect(social.company.siren).toBe(''); expect(social.website).toBe('');
    await page.goto(`/campagnes/lots/${runId}?candidat=${social.id}`);
    await expect(page.getByRole('heading', { name: 'Atelier Social Démo', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Voir le rapport complet', exact: true }).click();
    const dossier = page.getByTestId('prospect-report');
    await openFactSection(page, 'social-fact-0');
    for (let index = 0; index < 12; index++) { await openFactSection(page, `social-fact-${index}`); await expect(dossier.locator(`[data-fact-id="social-fact-${index}"]`)).toBeVisible(); }
    await expect(dossier.getByRole('heading', { name: 'Analyse du site', exact: true })).toBeVisible();
    await dossier.getByRole('heading', { name: 'Analyse du site', exact: true }).click();
    await expect(dossier.getByText('Aucun site identifié ; aucun audit de site réalisé.', { exact: true })).toBeVisible();
    await dossier.locator('[data-fact-id="social-fact-8"]').getByRole('button', { name: 'Utiliser pour mon approche', exact: true }).click();
    await openContactChoices(page);
    await page.getByRole('checkbox', { name: /04 00 00 01 23/ }).check();
    await page.getByRole('button', { name: 'Garder pour préparer un contact', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Atelier Social Démo', exact: true })).not.toBeVisible();
    const accepted = await backup(request), company = accepted.companies.find(company => company.name === 'Atelier Social Démo')!;
    expect(company).toBeTruthy(); expect(company.contact.phone).toBe('04 00 00 01 23');
    const participation = accepted.campaignData!.participations.find(participation => participation.companyId === company.id && participation.campaignId === campaignId)!;
    expect(participation.qualification.answers.fit.answer).toBe('unknown');
    await page.getByRole('navigation', { name: 'Votre parcours', exact: true }).getByRole('link', { name: /Préparer$/ }).click();
    await expect(page.getByRole('heading', { name: 'Préparer votre conversation', exact: true })).toBeVisible();
    await expect(page.getByLabel('Preuve principale', { exact: true })).toHaveValue('social-fact-8');
    await page.getByRole('button', { name: 'Proposer un plan pour cette preuve', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Nouvelle proposition enregistrée.' })).toBeVisible();
    await expect(page.getByLabel('Motif', { exact: true })).toHaveValue('Le profil présente des exemples de réalisations.');
    await page.getByRole('checkbox', { name: /Cette entreprise correspond à ma cible/ }).check();
    await page.getByRole('checkbox', { name: /Ce motif est documenté/ }).check();
    await page.getByLabel('Canal professionnel choisi', { exact: true }).selectOption('phone');
    await page.getByRole('checkbox', { name: /J’ai vérifié ce contact professionnel/ }).check();
    await page.getByRole('button', { name: 'Valider et préparer mes textes', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Plan et brouillons enregistrés.' })).toBeVisible();
    await page.getByRole('button', { name: 'Email', exact: true }).click();
    await expect(page.getByLabel('Email à relire', { exact: true })).toHaveValue(/Rayan, développeur indépendant/);
    const emailText = await page.getByLabel('Email à relire', { exact: true }).inputValue();
    expect((emailText.match(/\?/g) || []).length).toBe(1);
    expect(emailText).not.toMatch(/perte de clients|ROI|audit gratuit|notre échange/);
    await page.getByLabel('Email à relire', { exact: true }).fill(emailText + '\n\nMerci de votre retour.');
    await page.getByRole('button', { name: 'Enregistrer cette version', exact: true }).click();
    await expect(page.getByText(/Version 2 · Modification personnelle/)).toBeVisible();
    const versioned = await backup(request), savedParticipation = versioned.campaignData!.participations.find(participation => participation.companyId === company.id && participation.campaignId === campaignId)!;
    expect(savedParticipation.drafts!.filter(draft => draft.channel === 'email')).toHaveLength(2);
    expect(savedParticipation.drafts!.find(draft => draft.channel === 'email' && draft.version === 2)!.text).toContain('Merci de votre retour.');
    expect(savedParticipation.contactEvents || []).toHaveLength(0);
    await page.getByRole('button', { name: 'Appel', exact: true }).click();
    await expect(page.getByLabel('Trame d’appel', { exact: true })).toHaveValue(/Écouter|Laisser la personne répondre/);
    await page.getByRole('button', { name: 'Question suivante', exact: true }).click();
    await expect(page.getByRole('heading',{name:'Motif et interlocuteur',exact:true})).toBeVisible();
    await page.getByRole('button', { name: 'Question suivante', exact: true }).click();
    await expect(page.getByText('Comprendre le fonctionnement avant de proposer une solution.', { exact: true })).toBeVisible();
    await page.getByLabel('Adapter à sa réponse', { exact: true }).selectOption('taken');
    await expect(page.getByRole('status').filter({ hasText: 'clôturer' })).toBeVisible();
    await page.getByRole('button', { name: 'Résultat et suivi', exact: true }).click();
    await page.getByLabel('Canal utilisé', { exact: true }).selectOption('phone');
    await page.getByLabel('Résultat du contact', { exact: true }).selectOption('no_response');
    await page.getByLabel('Note et propos réellement exprimés', { exact: true }).fill('Tentative sans réponse ; aucun besoin supposé.');
    await page.getByRole('radio', { name: 'Prévoir une prochaine action', exact: true }).check();
    await page.getByLabel('Prochaine action', { exact: true }).fill('Nouvelle tentative à la date choisie');
    await page.getByLabel('Date choisie', { exact: true }).fill('2026-10-15');
    await page.getByRole('button', { name: 'Enregistrer le résultat et la suite', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Résultat et prochaine étape enregistrés ensemble.' })).toBeVisible();
    const after = await backup(request), result = after.campaignData!.participations.find(participation => participation.companyId === company.id && participation.campaignId === campaignId)!;
    expect(result.contactEvents).toHaveLength(1);
    expect(result.contactEvents![0].outcome).toBe('no_response');
    expect(result.nextAction!.text).toBe('Nouvelle tentative à la date choisie');
    expect(result.stage).not.toBe('En échange');
    await page.goto(`/campagnes/rapports/${company.id}?campagne=${campaignId}`);
    await expect(page.getByRole('heading', { name: 'Dossier complet · Atelier Social Démo', exact: true })).toBeVisible();
    for (let index = 0; index < 12; index++) await expect(page.locator(`[data-fact-id="social-fact-${index}"]`)).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    for (let index = 0; index < 12; index++) await expect(page.locator(`[data-fact-id="social-fact-${index}"]`)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Toutes les sources et leurs extraits', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/v2-complete-report.png', fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    await page.setViewportSize({ width: 390, height: 844 });
    const preparationUrl = `/campagnes/${campaignId}?etape=preparer&prospect=${company.id}`;
    await page.goto(preparationUrl);
    await page.getByRole('button', { name: 'Email', exact: true }).click();
    await expect(page.getByLabel('Email à relire', { exact: true })).toHaveValue(/Merci de votre retour\./);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const mobileDraft = await page.getByLabel('Email à relire', { exact: true }).inputValue() + '\nBrouillon de reprise mobile.';
    await page.getByLabel('Email à relire', { exact: true }).fill(mobileDraft);
    await page.goto('/');
    await page.goto(preparationUrl);
    await expect(page.getByLabel('Email à relire', { exact: true })).toHaveValue(mobileDraft);
    await page.screenshot({ path: 'test-results/v2-preparation-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Résultat et suivi', exact: true }).click();
    await expect(page.getByLabel('Date de réalisation', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.reload();
    await expect(page.getByLabel('Date de réalisation', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: 'test-results/v2-result-mobile.png', fullPage: true });
  } finally { await page.emulateMedia({ media: 'screen' }); await restore(page, baseline, discardedRunId); }
});

test('V2 — revue mobile 390 px, tous les constats et reprise sans débordement', async ({ page, request }) => {
  test.setTimeout(120_000);
  const baseline = await backup(request);
  let discardedRunId: string | undefined;
  try {
    const { campaignId, runId, candidates } = await launchCampaign(page, request, 'V2 — mobile', id => {discardedRunId=id;});
    const social = candidates.find(candidate => candidate.company.name === 'Atelier Social Démo')!;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/campagnes/lots/${runId}?candidat=${social.id}`);
    await expect(page.getByRole('heading', { name: 'Atelier Social Démo', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Voir le rapport complet', exact: true }).click();
    await openFactSection(page, 'social-fact-0');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    for (let index = 0; index < 12; index++) { await openFactSection(page, `social-fact-${index}`); await expect(page.locator(`[data-fact-id="social-fact-${index}"]`)).toBeVisible(); }
    await page.locator('.review-decisions').scrollIntoViewIfNeeded();
    const commands = await page.locator('.review-decisions').boundingBox();
    expect(commands).toBeTruthy(); expect(commands!.y).toBeGreaterThanOrEqual(0);
    expect(commands!.y + commands!.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: 'test-results/v2-review-mobile.png', fullPage: true });
    await page.goto('/');
    await expect(page.locator('.preparation-waiting').filter({ hasText: 'V2 — mobile' }).getByRole('link', { name: 'Examiner →', exact: true })).toBeVisible();
    await page.goto(`/campagnes/${campaignId}`);
    await page.getByRole('navigation', { name: 'Votre parcours', exact: true }).getByRole('link', { name: /Examiner$/ }).click();
    await expect(page).toHaveURL(new RegExp(`/campagnes/lots/${runId}`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  } finally { await restore(page, baseline, discardedRunId); }
});
