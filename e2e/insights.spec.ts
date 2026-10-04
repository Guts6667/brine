import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Backup } from '../lib/types';

const observation = 'Dans ce jeu de test, un grand ovale sombre recouvre les photos des cartes Avant / après et masque une partie des réalisations.';
const element = 'Cartes Avant / après, bouton Comparer';
const personalNote = 'Vérifier d’abord le comparateur de photos avant de proposer une correction ciblée.';
const today = () => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const frenchDate = (value: string) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'Europe/Paris' }).format(new Date(value + 'T12:00:00Z'));

async function backup(request: APIRequestContext): Promise<Backup> {
  const response = await request.get('/api/backup');
  expect(response.ok()).toBe(true);
  return response.json();
}

async function restore(page: Page, baseline: Backup) {
  await page.goto('/sauvegarde');
  await page.getByLabel('Fichier de sauvegarde JSON', { exact: true }).setInputFiles({ name: 'insights-baseline.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(baseline)) });
  await page.getByRole('button', { name: 'Vérifier le fichier', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Je confirme le remplacement des données par cette sauvegarde.', exact: true }).check();
  await page.getByRole('button', { name: 'Confirmer la restauration', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restauration terminée.' })).toBeVisible();
  const restored = await backup(page.request);
  for (const key of ['campaigns', 'runs', 'candidates'] as const) {
    expect(restored.campaignData![key].map(value => value.id).sort()).toEqual(baseline.campaignData![key].map(value => value.id).sort());
  }
  expect(restored.companies.map(company => company.id).sort()).toEqual(baseline.companies.map(company => company.id).sort());
}

async function configureProfile(page: Page, hasOffer = true) {
  await page.goto('/sauvegarde#profil');
  await page.getByLabel('Votre nom', { exact: true }).fill('Rayan');
  await page.getByLabel('Votre activité', { exact: true }).fill('développeur indépendant');
  await page.getByLabel('Compétences', { exact: true }).fill(hasOffer ? 'Développement web et corrections ciblées des interfaces' : '');
  await page.getByLabel('Prestations proposées', { exact: true }).fill(hasOffer ? 'Sites web et correction des défauts d’affichage des réalisations' : '');
  await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Votre offre et votre signature sont enregistrées.' })).toBeVisible();
}

async function budgetText(page: Page) {
  await page.goto('/sauvegarde#budget');
  return page.locator('.research-status p.small.muted').allTextContents();
}

async function launch(page: Page, request: APIRequestContext, name: string, hasOffer = true) {
  await page.goto('/campagnes/nouvelle');
  await page.getByLabel('Nom de la campagne', { exact: true }).fill(name);
  await page.getByLabel('Commune', { exact: true }).fill('Lyon');
  await page.getByLabel('Activité recherchée', { exact: true }).fill('Électricité');
  await page.getByLabel('Mots clés de recherche', { exact: true }).fill('électricien dépannage');
  await page.getByLabel(/Codes d’activité NAF/).fill('43.21A');
  await page.getByLabel('Offre proposée', { exact: true }).fill(hasOffer ? 'Sites web et correction ciblée de leur interface' : '');
  await page.getByRole('button', { name: 'Créer la campagne', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('button', { name: 'Lancer la recherche et l’analyse', exact: true }).click();
  await expect(page).toHaveURL(/\/campagnes\/lots\//);
  const runId = new URL(page.url()).pathname.split('/').at(-1)!;
  // Closing the screen cannot stop the durable workflow or require an open report.
  await page.goto('/campagnes');
  await expect.poll(async () => (await (await request.get(`/api/campaign-runs/${runId}`)).json()).run.status, { timeout: 45_000 }).toBe('completed');
  const data = await backup(request);
  const candidate = data.campaignData!.candidates.find(value => value.runId === runId && value.company.name === 'Atelier Démo — lot')!;
  expect(candidate).toBeTruthy();
  return { campaignId, runId, candidate, reviewUrl: `/campagnes/lots/${runId}?candidat=${candidate.id}` };
}

async function openVisualForm(page: Page) {
  const form = page.getByTestId('visual-observation-form');
  if (!(await form.evaluate(element => (element as HTMLDetailsElement).open))) await form.locator(':scope > summary').click();
  await expect(form.getByLabel('Ce que vous observez', { exact: true })).toBeVisible();
  return form;
}

test('Examiner — un constat visuel compréhensible mène au contact, le dossier reste complet et imprimable', async ({ page, request }) => {
  test.setTimeout(150_000);
  const baseline = await backup(request);
  try {
    await configureProfile(page);
    const initialBudget = await budgetText(page);
    const { campaignId, runId, candidate, reviewUrl } = await launch(page, request, 'Interface — preuve et prochaine action');
    await page.goto(reviewUrl);
    await expect(page.getByRole('heading', { name: candidate.company.name, exact: true })).toBeVisible();
    const review = page.getByTestId('prospect-review');
    const dossier = page.getByTestId('prospect-report');
    const decision = review.getByRole('button', { name: 'Garder pour préparer un contact', exact: true });
    await expect(decision).toBeVisible();
    await expect(dossier.getByRole('button', { name: 'Voir le rapport complet', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(dossier.getByRole('heading', { name: 'Preuves et méthode', exact: true })).not.toBeVisible();
    expect(await decision.evaluate(button => !!(button.compareDocumentPosition(document.querySelector('[data-testid="prospect-report"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await dossier.getByRole('button', { name: 'Voir le rapport complet', exact: true }).click();
    await expect(dossier.getByRole('heading', { name: 'Analyse du site', exact: true })).toBeVisible();
    expect(await dossier.locator('details.report-section[open]').count()).toBe(0);
    await expect(dossier.locator('[data-fact-id="quote404"]')).not.toBeVisible();
    await dossier.getByRole('button', { name: 'Replier le rapport', exact: true }).click();

    // The uploaded capture is of the deterministic local fixture, never a real prospect.
    const capture = await page.screenshot({ type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width: 640, height: 440 } });
    const form = await openVisualForm(page);
    await form.getByLabel('Page observée', { exact: true }).fill(candidate.website);
    await form.getByLabel('Élément concerné', { exact: true }).fill(element);
    await form.getByLabel('Ce que vous observez', { exact: true }).fill(observation);
    await form.getByLabel('Type de constat', { exact: true }).selectOption('overlap');
    await form.getByLabel('Écran observé', { exact: true }).selectOption('desktop');
    await form.getByLabel('Date de l’observation', { exact: true }).fill(today());
    // An unfinished note survives leaving the page; a capture is attached afterwards.
    await page.goto('/campagnes');
    await page.goto(reviewUrl);
    const resumed = await openVisualForm(page);
    await expect(resumed.getByLabel('Ce que vous observez', { exact: true })).toHaveValue(observation);
    const initialCard = page.getByTestId('priority-insight').filter({ hasText: 'Le lien Demander un devis renvoie HTTP 404.' });
    await initialCard.getByRole('button', { name: 'Choisir ce constat', exact: true }).click();
    await review.locator('.review-personal-note > summary').click();
    await review.getByLabel('Ce que je veux approfondir', { exact: true }).fill(personalNote);
    await resumed.getByLabel('Capture de preuve (facultatif)', { exact: true }).setInputFiles({ name: 'preuve-interface-de-test.jpg', mimeType: 'image/jpeg', buffer: capture });
    await expect(resumed.getByRole('img', { name: 'Capture de preuve à vérifier avant enregistrement', exact: true })).toBeVisible();
    await resumed.getByRole('button', { name: 'Enregistrer ce constat', exact: true }).click();
    await expect.poll(async () => (await backup(request)).campaignData!.candidates.find(value => value.id === candidate.id)?.research?.facts.filter(fact => fact.visual).length).toBe(1);
    // Adding a proof changes the server revision without dropping the ongoing review.
    await expect(initialCard.getByRole('button', { name: 'Retirer ce choix', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(review.getByLabel('Ce que je veux approfondir', { exact: true })).toHaveValue(personalNote);
    await expect(page).toHaveURL(new RegExp(`/campagnes/lots/${runId}\\?candidat=${candidate.id}$`));
    const saved = await backup(request), updated = saved.campaignData!.candidates.find(value => value.id === candidate.id)!;
    const fact = updated.research!.facts.find(value => value.visual)!;
    expect(fact).toMatchObject({ section: 'site', kind: 'observed', sentiment: 'issue', text: observation, observedOn: today(), visual: { pageUrl: candidate.website, element, category: 'overlap', device: 'desktop' } });
    expect(fact.visual!.screenshot).toMatch(/^data:image\/jpeg;base64,/);
    expect(fact.scope).toContain('Observation visuelle humaine');
    expect(fact.scope).toContain('aucune perte de clients');
    const source = updated.research!.sources.find(value => fact.sourceIds.includes(value.id))!;
    expect(source).toMatchObject({ provider: 'manual', url: candidate.website, collectedAt: today() });
    expect(updated.html).toEqual(candidate.html);
    expect(updated.research!.report!.facts.some(value => value.id === 'quote404')).toBe(true);

    const card = page.getByTestId('priority-insight').filter({ hasText: observation });
    await expect(card.getByRole('heading', { name: 'Un élément gêne la lecture des réalisations', exact: true })).toBeVisible();
    await expect(card.getByText('Ce que cela peut gêner', { exact: true })).toBeVisible();
    await expect(card.getByText('L’aide à envisager', { exact: true })).toBeVisible();
    await expect(card.getByRole('link', { name: 'Vérifier la page', exact: true })).toHaveAttribute('href', candidate.website);
    await initialCard.getByRole('button', { name: 'Retirer ce choix', exact: true }).click();
    await card.getByRole('button', { name: 'Choisir ce constat', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Retirer ce choix', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Garder pour préparer un contact', exact: true }).click();
    await expect(page).toHaveURL(/filtre=review/);
    const kept = await backup(request), companyId = kept.campaignData!.candidates.find(value => value.id === candidate.id)!.companyId!;
    const participation = kept.campaignData!.participations.find(value => value.companyId === companyId && value.campaignId === campaignId)!;
    expect(participation.findingIds).toContain(candidate.id + ':' + fact.id);
    expect(participation.approach).toBe(personalNote);
    expect(kept.companies.find(value => value.id === companyId)!.contact.email).toBe('contact@atelier-demo.test');

    const preparationUrl = `/campagnes/${campaignId}?etape=preparer&prospect=${companyId}`;
    await page.goto(preparationUrl);
    await expect(page.getByLabel('Preuve principale', { exact: true })).toHaveValue(fact.id);
    await expect(page.getByLabel('Motif', { exact: true })).toHaveValue(observation);
    await expect(page.getByLabel('Aide proportionnée', { exact: true })).toHaveValue(/corriger l’affichage de cet élément/);
    await expect(page.getByLabel('Aide proportionnée', { exact: true })).not.toHaveValue(/refonte/);
    await page.getByRole('checkbox', { name: /Cette entreprise correspond à ma cible/ }).check();
    await page.getByRole('checkbox', { name: /Ce motif est documenté/ }).check();
    await page.getByRole('checkbox', { name: /J’ai vérifié ce contact professionnel/ }).check();
    await page.getByRole('button', { name: 'Valider et préparer mes textes', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Plan et brouillons enregistrés.' })).toBeVisible();
    const drafted = await backup(request), prepared = drafted.campaignData!.participations.find(value => value.companyId === companyId && value.campaignId === campaignId)!;
    expect(prepared.plan!.evidenceIds).toEqual([fact.id]);
    expect(prepared.drafts!.find(value => value.channel === 'email')!.text).toContain('ovale sombre');
    expect(prepared.drafts!.find(value => value.channel === 'email')!.text).not.toMatch(/perte de clients|audit gratuit|refonte/);

    await page.goto(`/campagnes/lots/${runId}?filtre=accepted&candidat=${candidate.id}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('link', { name: 'Préparer ce contact', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await expect(page.getByTestId('prospect-report').getByRole('button', { name: 'Voir le rapport complet', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({ path: 'test-results/insights-review-mobile.png', fullPage: true });
    await page.goto(preparationUrl);
    await expect(page.getByLabel('Motif', { exact: true })).toHaveValue(observation);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

    await page.goto(`/campagnes/rapports/${companyId}?campagne=${campaignId}`);
    const allFactIds = updated.research!.report!.facts.map(value => value.id);
    for (const id of allFactIds) await expect(page.locator(`[data-fact-id="${id}"]`)).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    const proof = page.locator(`[data-fact-id="${fact.id}"]`).getByRole('img', { name: `Constat visuel : ${element}, sur ordinateur, observé le ${frenchDate(fact.observedOn)}`, exact: true });
    await expect(proof).toBeVisible();
    expect(await proof.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    for (const id of allFactIds) await expect(page.locator(`[data-fact-id="${id}"]`)).toBeVisible();
    const pdf = await page.pdf({ path: 'test-results/insights-complete-report.pdf', format: 'A4', printBackground: true });
    expect(pdf.length).toBeGreaterThan(5000);
    await page.emulateMedia({ media: 'screen' });
    expect(await budgetText(page)).toEqual(initialBudget);
    const afterReads = await backup(request), again = afterReads.campaignData!.candidates.find(value => value.id === candidate.id)!;
    expect(again.research!.facts.filter(value => value.visual)).toHaveLength(1);
    expect(again.attempts).toEqual(candidate.attempts);
    expect(afterReads.campaignData!.runs.find(value => value.id === runId)!.status).toBe('completed');
  } finally {
    await page.emulateMedia({ media: 'screen' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await restore(page, baseline);
  }
});

test('Examiner — une offre manquante appelle une action claire, puis utilise l’offre actualisée sans nouvelle collecte', async ({ page, request }) => {
  test.setTimeout(120_000);
  const baseline = await backup(request);
  try {
    await configureProfile(page, false);
    const { campaignId, runId, candidate, reviewUrl } = await launch(page, request, 'Interface — offre à préciser', false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(reviewUrl);
    await expect(page.getByText('Précisez d’abord ce que vous proposez', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Ce que je propose dans cette campagne', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Garder pour préparer un contact', exact: true })).toBeVisible();
    await expect(page.getByTestId('prospect-report').getByRole('button', { name: 'Voir le rapport complet', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Choisir ce constat', exact: true })).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByLabel('Ce que je propose dans cette campagne', { exact: true }).fill('Sites web et correction ciblée des interfaces');
    await page.getByRole('button', { name: 'Enregistrer mon offre', exact: true }).click();
    await expect.poll(async () => (await backup(request)).campaignData!.campaigns.find(value => value.id === campaignId)!.targetOffer).toBe('Sites web et correction ciblée des interfaces');
    await expect(page).toHaveURL(new RegExp(`/campagnes/lots/${runId}\\?candidat=${candidate.id}$`));
    await expect(page.getByText('Précisez d’abord ce que vous proposez', { exact: true })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Choisir ce constat', exact: true }).first()).toBeVisible();
    const after = await backup(request), unchanged = after.campaignData!.candidates.find(value => value.id === candidate.id)!;
    expect(unchanged.html).toEqual(candidate.html);
    expect(unchanged.attempts).toEqual(candidate.attempts);
    expect(after.campaignData!.runs.find(value => value.id === runId)!.target.targetOffer).toBe('');
    expect(after.campaignData!.campaigns.find(value => value.id === campaignId)!.targetOffer).toBe('Sites web et correction ciblée des interfaces');

    // A first-time user can finish preparation without filling an entire provider dossier.
    // A hidden optional value must still survive saving the two visible identity fields.
    const savedReference = 'Référence de test : interface de démonstration locale.';
    await page.goto('/sauvegarde#profil');
    await page.getByLabel('Votre nom', { exact: true }).fill('');
    await page.getByLabel('Votre activité', { exact: true }).fill('');
    await page.getByLabel('Références réelles et liens', { exact: true }).fill(savedReference);
    await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Votre offre et votre signature sont enregistrées.' })).toBeVisible();
    await page.goto(reviewUrl);
    await page.getByTestId('priority-insight').filter({ hasText: 'Le lien Demander un devis renvoie HTTP 404.' }).getByRole('button', { name: 'Choisir ce constat', exact: true }).click();
    await page.getByRole('button', { name: 'Garder pour préparer un contact', exact: true }).click();
    await expect(page).toHaveURL(/filtre=review/);
    const kept = await backup(request), companyId = kept.campaignData!.candidates.find(value => value.id === candidate.id)!.companyId!;
    await page.goto(`/campagnes/${campaignId}?etape=preparer&prospect=${companyId}`);
    await expect(page.getByLabel('Votre nom', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Votre activité', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Motif', { exact: true })).toHaveValue('Le lien Demander un devis renvoie HTTP 404.');
    await expect(page.getByLabel('Motif', { exact: true })).toBeVisible();
    const optional = page.locator('details.profile-optional');
    await expect(optional.locator(':scope > summary')).toHaveText('Compléter ma présentation (facultatif)');
    expect(await optional.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
    for (const label of ['Compétences', 'Prestations proposées', 'Votre site ou portfolio', 'Références réelles et liens', 'Conditions et engagements que vous proposez', 'Tarifs déclarés (facultatif)', 'Signature des messages']) {
      await expect(optional.getByLabel(label, { exact: true })).toHaveCount(1);
      await expect(optional.getByLabel(label, { exact: true })).not.toBeVisible();
    }
    await expect(optional.getByLabel('Références réelles et liens', { exact: true })).toHaveValue(savedReference);
    await expect(optional.getByLabel('Prestations proposées', { exact: true })).toHaveValue('');
    await expect(optional.getByLabel('Prestations proposées', { exact: true })).not.toHaveAttribute('required');
    await expect(page.getByRole('button', { name: 'Valider et préparer mes textes', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await optional.locator(':scope > summary').click();
    await expect(optional.getByLabel('Prestations proposées', { exact: true })).toBeVisible();
    await optional.locator(':scope > summary').click();
    await page.getByLabel('Votre nom', { exact: true }).fill('Rayan Démo');
    await page.getByLabel('Votre activité', { exact: true }).fill('développeur indépendant');
    await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Valider et préparer mes textes', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Motif', { exact: true })).toHaveValue('Le lien Demander un devis renvoie HTTP 404.');
    await expect(optional.getByLabel('Prestations proposées', { exact: true })).not.toBeVisible();
    const withProfile = await backup(request), profile = withProfile.campaignData!.providerProfile!;
    expect(profile).toMatchObject({ name: 'Rayan Démo', activity: 'développeur indépendant', skills: '', services: '', references: savedReference });
    expect(withProfile.campaignData!.candidates.find(value => value.id === candidate.id)!.attempts).toEqual(candidate.attempts);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  } finally {
    await page.setViewportSize({ width: 1280, height: 720 });
    await restore(page, baseline);
  }
});
