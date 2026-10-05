import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { openFactSection, openContactChoices, confirmFact } from './report-helpers';
import type { Backup, Company } from '../lib/types';
import type { DiscoveryCandidate } from '../lib/campaign-types';

async function backup(request: APIRequestContext): Promise<Backup> {
  const response = await request.get('/api/backup');
  expect(response.ok()).toBe(true);
  return response.json();
}

async function restore(page: Page, baseline: Backup) {
  await page.goto('/sauvegarde');
  await page.getByLabel('Sauvegarde Brine ZIP ou ancien fichier JSON', { exact: true }).setInputFiles({ name: 'v2-regression-baseline.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(baseline)) });
  await page.getByRole('button', { name: 'Vérifier le fichier', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Je confirme le remplacement des données par cette sauvegarde.', exact: true }).check();
  await page.getByRole('button', { name: 'Confirmer la restauration', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restauration terminée.' })).toBeVisible();
  const restored = await backup(page.request);
  expect(restored.campaignData!.campaigns.map(campaign => campaign.id).sort()).toEqual(baseline.campaignData!.campaigns.map(campaign => campaign.id).sort());
}

async function configureProfile(page: Page) {
  await page.goto('/sauvegarde#profil');
  await page.getByLabel('Votre nom', { exact: true }).fill('Rayan');
  await page.getByLabel('Votre activité', { exact: true }).fill('développeur indépendant');
  await page.getByLabel('Compétences', { exact: true }).fill('Développement et corrections ciblées de sites web');
  await page.getByLabel('Prestations proposées', { exact: true }).fill('Présentation des prestations et parcours de contact sur les sites web');
  await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Votre offre et votre signature sont enregistrées.' })).toBeVisible();
}

async function launch(page: Page, request: APIRequestContext, name: string) {
  await page.goto('/campagnes/nouvelle');
  await page.getByLabel('Nom de la campagne', { exact: true }).fill(name);
  await page.getByLabel('Commune', { exact: true }).fill('Lyon');
  await page.getByLabel('Activité recherchée', { exact: true }).fill('Électricité');
  await page.getByLabel('Mots clés de recherche', { exact: true }).fill('électricien dépannage');
  await page.getByLabel(/Codes d’activité NAF/).fill('43.21A');
  await page.getByLabel('Spécialisation de la campagne (facultatif)', { exact: true }).fill('Sites web et présentation des prestations');
  await page.getByRole('button', { name: 'Créer la campagne', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('button', { name: 'Lancer la recherche et l’analyse', exact: true }).click();
  await expect(page).toHaveURL(/\/campagnes\/lots\//);
  const runId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.goto('/campagnes');
  await expect.poll(async () => (await (await request.get(`/api/campaign-runs/${runId}`)).json()).run.status, { timeout: 45_000 }).toBe('completed');
  const data = await backup(request);
  return { campaignId, runId, candidates: data.campaignData!.candidates.filter(candidate => candidate.runId === runId) };
}

async function keep(page: Page, request: APIRequestContext, runId: string, candidate: DiscoveryCandidate, evidenceId: string, contact: string): Promise<Company> {
  await page.goto(`/campagnes/lots/${runId}?candidat=${candidate.id}`);
  await expect(page.getByRole('heading', { name: candidate.company.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Voir le rapport complet', exact: true }).click();
  await confirmFact(page,evidenceId);await openFactSection(page, evidenceId);
  await page.locator(`[data-fact-id="${evidenceId}"]`).getByRole('button', { name: 'Utiliser pour mon approche', exact: true }).click();
  await openContactChoices(page);
  await page.getByRole('checkbox', { name: new RegExp(contact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).check();
  await page.getByRole('button', { name: 'Valider le prospect', exact: true }).click();
  await expect(page).toHaveURL(/filtre=review/);
  await expect.poll(async () => (await backup(request)).campaignData!.candidates.find(item => item.id === candidate.id)?.status).toBe('accepted');
  const accepted = await backup(request), companyId = accepted.campaignData!.candidates.find(item => item.id === candidate.id)!.companyId;
  return accepted.companies.find(company => company.id === companyId)!;
}

function participation(data: Backup, campaignId: string, companyId: string) {
  return data.campaignData!.participations.find(item => item.campaignId === campaignId && item.companyId === companyId)!;
}

function shiftedDate(date: string, days: number) {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function normalizeNewlines(value: string) { return value.replace(/\r\n?/g, '\n'); }

async function proposePlan(page: Page) {
  await page.getByRole('button', { name: 'Proposer un plan pour cette preuve', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Nouvelle proposition enregistrée.' })).toBeVisible();
}

test('V2 P1 — preuve admise, formulations persistantes et résultat isolé entre deux prospects', async ({ page, request }) => {
  test.setTimeout(150_000);
  const baseline = await backup(request);
  try {
    await configureProfile(page);
    const { campaignId, runId, candidates } = await launch(page, request, 'V2 P1 — isolation et formulations');
    const social = candidates.find(candidate => candidate.company.name === 'Atelier Social Démo')!, atelier = candidates.find(candidate => candidate.company.siren === '490484557')!;
    const companyA = await keep(page, request, runId, social, 'social-fact-8', '04 00 00 01 23');
    const companyB = await keep(page, request, runId, atelier, 'quote404', 'contact@atelier-demo.test');
    await page.goto(`/campagnes/${campaignId}?etape=preparer&prospect=${companyA.id}`);
    await expect(page.getByLabel('Preuve principale', { exact: true })).toHaveValue('social-fact-8');
    await proposePlan(page);
    await expect(page.getByLabel('Motif', { exact: true })).toHaveValue('Le profil présente des exemples de réalisations.');
    const motive = 'J’ai consulté les exemples de réalisations publiés sur votre profil.', question = 'Comment présentez-vous vos réalisations aux personnes qui vous contactent ?';
    const hypothesis = 'Une page dédiée pourrait faciliter la consultation de vos réalisations, à confirmer avec vous.', help = 'Je peux proposer d’examiner la présentation de vos réalisations et le parcours de contact.', nextStep = 'Si cela vous paraît utile, convenir d’un court échange sur votre présentation actuelle.';
    await page.getByLabel('Motif', { exact: true }).fill(motive);
    await page.getByLabel('Hypothèse à confirmer', { exact: true }).fill(hypothesis);
    await page.getByLabel('Aide proportionnée', { exact: true }).fill(help);
    await page.getByLabel('Question principale', { exact: true }).fill(question);
    await page.getByLabel('Suite possible', { exact: true }).fill(nextStep);
    await page.getByRole('button', { name: 'Enregistrer mes formulations', exact: true }).click();
    await expect.poll(async () => participation(await backup(request), campaignId, companyA.id).plan?.question).toBe(question);
    await page.reload();
    await expect(page.getByLabel('Motif', { exact: true })).toHaveValue(motive);
    await expect(page.getByLabel('Hypothèse à confirmer', { exact: true })).toHaveValue(hypothesis);
    await expect(page.getByLabel('Aide proportionnée', { exact: true })).toHaveValue(help);
    await expect(page.getByLabel('Question principale', { exact: true })).toHaveValue(question);
    await expect(page.getByLabel('Suite possible', { exact: true })).toHaveValue(nextStep);
    await expect(page.getByLabel('Preuve principale', { exact: true })).toHaveValue('social-fact-8');
    const saved = participation(await backup(request), campaignId, companyA.id);
    expect(saved.plan!.evidenceIds).toEqual(['social-fact-8']);
    expect(saved.plan!.motive).toBe(motive);
    expect(saved.drafts || []).toHaveLength(0);

    await page.getByRole('checkbox', { name: /Cette entreprise correspond à ma cible/ }).check();
    await page.getByRole('checkbox', { name: /Ce motif est documenté/ }).check();
    await page.getByLabel('Canal professionnel choisi', { exact: true }).selectOption('phone');
    await page.getByRole('checkbox', { name: /J’ai vérifié ce contact professionnel/ }).check();
    await page.getByRole('button', { name: 'Valider et préparer mes textes', exact: true }).click();
    await expect.poll(async () => participation(await backup(request), campaignId, companyA.id).drafts?.length).toBe(2);
    const preparedA = participation(await backup(request), campaignId, companyA.id);
    expect(preparedA.plan!.motive).toBe(motive);
    expect(preparedA.plan!.question).toBe(question);
    expect(preparedA.drafts!.every(draft => draft.planId === preparedA.plan!.id)).toBe(true);
    await page.getByRole('navigation', { name: 'Préparation du contact', exact: true }).getByRole('button', { name: 'Appel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copier pour contacter manuellement', exact: true }),await page.locator('.contact-workspace').innerText()).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Composer le numéro professionnel', exact: true })).toBeVisible();

    // B has a sourced email; an unsaved text or subject must not be presented
    // as a recorded version that can be copied or opened in a mail client.
    await page.goto(`/campagnes/${campaignId}?etape=preparer&prospect=${companyB.id}`);
    await expect(page.getByLabel('Preuve principale', { exact: true })).toHaveValue('quote404');
    await proposePlan(page);
    await page.getByRole('checkbox', { name: /Cette entreprise correspond à ma cible/ }).check();
    await page.getByRole('checkbox', { name: /Ce motif est documenté/ }).check();
    await page.getByLabel('Canal professionnel choisi', { exact: true }).selectOption('email');
    await page.getByRole('checkbox', { name: /J’ai vérifié ce contact professionnel/ }).check();
    await page.getByRole('button', { name: 'Valider et préparer mes textes', exact: true }).click();
    await expect.poll(async () => participation(await backup(request), campaignId, companyB.id).drafts?.length).toBe(2);
    await page.getByRole('navigation', { name: 'Préparation du contact', exact: true }).getByRole('button', { name: 'Email', exact: true }).click();
    const emailText = page.getByLabel('Email à relire', { exact: true }), emailSubject = page.getByLabel('Objet factuel', { exact: true });
    const originalText = await emailText.inputValue(), originalSubject = await emailSubject.inputValue();
    const copy = page.getByRole('button', { name: 'Copier pour contacter manuellement', exact: true }), mail = page.getByRole('link', { name: 'Ouvrir dans mon logiciel email', exact: true });
    await expect(copy).toBeEnabled();
    await expect(mail).toBeVisible();
    const editedText = originalText + '\n\nMerci de votre retour.', editedSubject = originalSubject + ' — point à vérifier';
    await emailText.fill(editedText);
    await expect(copy).toBeDisabled();
    await expect(mail).toHaveCount(0);
    await emailText.fill(originalText);
    await expect(copy).toBeEnabled();
    await expect(mail).toBeVisible();
    await emailSubject.fill(editedSubject);
    await expect(copy).toBeDisabled();
    await expect(mail).toHaveCount(0);
    await emailText.fill(editedText);
    await page.getByRole('button', { name: 'Enregistrer cette version', exact: true }).click();
    await expect.poll(async () => participation(await backup(request), campaignId, companyB.id).drafts?.filter(draft => draft.channel === 'email').length).toBe(2);
    await expect(emailText).toHaveValue(editedText);
    await expect(emailSubject).toHaveValue(editedSubject);
    await expect(copy).toBeEnabled();
    await expect(mail).toBeVisible();
    const recordedB = participation(await backup(request), campaignId, companyB.id), version = recordedB.drafts!.find(draft => draft.channel === 'email' && draft.version === 2)!;
    expect(normalizeNewlines(version.text)).toBe(editedText);expect(version.subject).toBe(editedSubject);expect(version.planId).toBe(recordedB.plan!.id);
    const mailUrl = new URL((await mail.getAttribute('href'))!);
    expect(mailUrl.protocol).toBe('mailto:');expect(mailUrl.pathname).toBe('contact@atelier-demo.test');
    expect(mailUrl.searchParams.get('subject')).toBe(editedSubject);expect(normalizeNewlines(mailUrl.searchParams.get('body')!)).toBe(editedText);
    await page.reload();
    await expect(emailText).toHaveValue(editedText);
    await expect(emailSubject).toHaveValue(editedSubject);
    await expect(copy).toBeEnabled();
    await expect(mail).toBeVisible();

    // A client navigation within the same campaign previously reused A's form for B.
    await page.goto(`/campagnes/${campaignId}?etape=suivre&prospect=${companyA.id}`);
    const today = (await page.getByLabel('Date de réalisation', { exact: true }).getAttribute('max'))!;
    await page.getByLabel('Date de réalisation', { exact: true }).fill(shiftedDate(today, -1));
    await page.getByLabel('Note et propos réellement exprimés', { exact: true }).fill('Note non envoyée réservée au prospect A.');
    await page.getByRole('radio', { name: 'Prévoir une prochaine action', exact: true }).check();
    await page.getByLabel('Prochaine action', { exact: true }).fill('Suite privée du prospect A');
    await page.getByLabel('Date choisie', { exact: true }).fill(shiftedDate(today, 3));
    await page.getByRole('complementary', { name: 'Prospects de cette campagne', exact: true }).getByRole('link', { name: new RegExp(companyB.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await expect(page).toHaveURL(new RegExp(`prospect=${companyB.id}`));
    await expect(page.getByLabel('Note et propos réellement exprimés', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Date de réalisation', { exact: true })).toHaveValue(today);
    await expect(page.getByRole('radio', { name: 'Prévoir une prochaine action', exact: true })).not.toBeChecked();
    await expect(page.getByRole('radio', { name: 'Aucun suivi prévu', exact: true })).not.toBeChecked();
    await page.getByRole('radio', { name: 'Prévoir une prochaine action', exact: true }).check();
    await expect(page.getByLabel('Prochaine action', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Date choisie', { exact: true })).toHaveValue('');
    await page.getByRole('radio', { name: 'Aucun suivi prévu', exact: true }).check();
    await page.getByLabel('Date de réalisation', { exact: true }).fill(shiftedDate(today, -1));
    await page.getByLabel('Note et propos réellement exprimés', { exact: true }).fill('Contact déjà effectué pour B, sans réponse.');
    await page.getByRole('button', { name: 'Enregistrer le résultat et la suite', exact: true }).click();
    await expect.poll(async () => participation(await backup(request), campaignId, companyB.id).contactEvents?.length).toBe(1);
    await expect(page.getByLabel('Note et propos réellement exprimés', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Date de réalisation', { exact: true })).toHaveValue(today);
    await expect(page.getByRole('radio', { name: 'Aucun suivi prévu', exact: true })).not.toBeChecked();
    const after = await backup(request);
    expect(participation(after, campaignId, companyA.id).contactEvents || []).toHaveLength(0);
    expect(participation(after, campaignId, companyB.id).contactEvents![0].note).toBe('Contact déjà effectué pour B, sans réponse.');
    expect(participation(after, campaignId, companyB.id).nextAction).toBeNull();
  } finally { await restore(page, baseline); }
});

test('V2 P1 — reconfirmer une retenue conserve ses preuves et le retrait garde son historique', async ({ page, request }) => {
  test.setTimeout(150_000);
  const baseline = await backup(request);
  try {
    await configureProfile(page);
    const { campaignId, runId, candidates } = await launch(page, request, 'V2 P1 — preuves et retrait');
    const social = candidates.find(candidate => candidate.company.name === 'Atelier Social Démo')!;
    const company = await keep(page, request, runId, social, 'social-fact-8', '04 00 00 01 23');
    await page.goto(`/campagnes/${campaignId}?etape=preparer&prospect=${company.id}`);
    await expect(page.getByLabel('Preuve principale', { exact: true })).toHaveValue('social-fact-8');
    await proposePlan(page);
    await page.getByRole('checkbox', { name: /Cette entreprise correspond à ma cible/ }).check();
    await page.getByRole('checkbox', { name: /Ce motif est documenté/ }).check();
    await page.getByLabel('Canal professionnel choisi', { exact: true }).selectOption('phone');
    await page.getByRole('checkbox', { name: /J’ai vérifié ce contact professionnel/ }).check();
    await page.getByRole('button', { name: 'Valider et préparer mes textes', exact: true }).click();
    await expect.poll(async () => participation(await backup(request), campaignId, company.id).drafts?.length).toBe(2);
    const before = participation(await backup(request), campaignId, company.id);
    await page.goto(`/campagnes/lots/${runId}?filtre=accepted&candidat=${social.id}`);
    await page.getByRole('button', { name: 'Modifier mes choix', exact: true }).click();
    await page.getByRole('button', { name: 'Voir le rapport complet', exact: true }).click();
    await openFactSection(page, 'social-fact-8');
    await expect(page.locator('[data-fact-id="social-fact-8"]').getByRole('button', { name: 'Preuve sélectionnée', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await openContactChoices(page);
    await expect(page.locator('.review-contact-choices').getByText(/^Téléphone public : 04 00 00 01 23/)).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /04 00 00 01 23/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Enregistrer mes choix', exact: true }).click();
    await expect(page).toHaveURL(/filtre=accepted/);
    const reconfirmed = participation(await backup(request), campaignId, company.id);
    expect(reconfirmed.findingIds).toEqual(before.findingIds);
    expect(reconfirmed.findingIds).toContain(`${social.id}:social-fact-8`);
    expect(reconfirmed.plan).toEqual(before.plan);
    expect(reconfirmed.drafts).toEqual(before.drafts);
    expect((await backup(request)).companies.find(item => item.id === company.id)!.contact.phone).toBe('04 00 00 01 23');
    await page.goto(`/campagnes/lots/${runId}?filtre=accepted&candidat=${social.id}`);
    await page.getByText('Retirer le prospect de cette campagne', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Je retire ce prospect de cette campagne, en conservant son historique.', exact: true }).check();
    await page.getByRole('button', { name: 'Retirer de cette campagne', exact: true }).click();
    await expect.poll(async () => participation(await backup(request), campaignId, company.id).archived).toBe(true);
    await page.goto(`/campagnes/${campaignId}?etape=preparer&prospect=${company.id}`);
    await expect(page.getByRole('complementary', { name: 'Prospects de cette campagne', exact: true }).getByRole('link').filter({ hasText: company.name })).toHaveCount(0);
    const removed = await backup(request), retained = participation(removed, campaignId, company.id);
    expect(removed.companies.some(item => item.id === company.id)).toBe(true);
    expect(retained.plan).toEqual(before.plan);
    expect(retained.drafts).toEqual(before.drafts);
    await page.goto(`/prospects/${company.id}?campagne=${campaignId}`);
    await expect(page.getByRole('heading', { name: company.name, exact: true })).toBeVisible();
    await page.getByText('Historique des plans et des messages', { exact: true }).click();
    const history = page.getByText('Historique des plans et des messages', { exact: true }).locator('..');
    await expect(history.locator('article').filter({ hasText: before.plan!.question }).first()).toBeVisible();
    for (let index = 0; index < before.drafts!.length; index++) {
      const version = history.locator('details').nth(index);
      await version.locator('summary').click();
      await expect(version.locator('.plain-text')).toBeVisible();
      await expect(version.locator('.plain-text')).toContainText(before.drafts![index].text);
    }
  } finally { await restore(page, baseline); }
});

test('V2 P1 — contacts réellement effectués sans préparation et opposition commune aux campagnes', async ({ page, request }) => {
  test.setTimeout(150_000);
  const baseline = await backup(request);
  let companyId: string | undefined, cleanupCampaignId: string | undefined;
  try {
    const { campaignId, runId, candidates } = await launch(page, request, 'V2 P1 — historique réel');cleanupCampaignId = campaignId;
    const social = candidates.find(candidate => candidate.company.name === 'Atelier Social Démo')!;
    const company = await keep(page, request, runId, social, 'social-fact-8', '04 00 00 01 23');companyId = company.id;
    await page.goto(`/campagnes/${campaignId}?etape=suivre&prospect=${company.id}`);
    await expect(page.getByRole('button', { name: 'Enregistrer le résultat et la suite', exact: true })).toBeEnabled();
    const today = (await page.getByLabel('Date de réalisation', { exact: true }).getAttribute('max'))!;
    await page.getByLabel('Canal utilisé', { exact: true }).selectOption('phone');
    await page.getByLabel('Résultat du contact', { exact: true }).selectOption('callback');
    await page.getByLabel('Note et propos réellement exprimés', { exact: true }).fill('Contact effectué hors Brine : la personne propose un rappel, sans besoin déclaré.');
    await page.getByRole('radio', { name: 'Prévoir une prochaine action', exact: true }).check();
    await page.getByLabel('Prochaine action', { exact: true }).fill('Rappel convenu pour la campagne A');
    await page.getByLabel('Date choisie', { exact: true }).fill(shiftedDate(today, 3));
    await page.getByRole('button', { name: 'Enregistrer le résultat et la suite', exact: true }).click();
    await expect.poll(async () => participation(await backup(request), campaignId, company.id).contactEvents?.length).toBe(1);
    let data = await backup(request);
    expect(participation(data, campaignId, company.id).readiness?.target).not.toBe(true);
    expect(participation(data, campaignId, company.id).qualification.answers.fit.answer).toBe('unknown');
    expect(participation(data, campaignId, company.id).nextAction!.text).toBe('Rappel convenu pour la campagne A');
    await page.goto(`/campagnes/${campaignId}`);
    await page.getByText('Gestion et entreprises déjà connues', { exact: true }).click();
    await page.getByRole('button', { name: 'Dupliquer la configuration', exact: true }).click();
    await expect(page).not.toHaveURL(new RegExp(`/campagnes/${campaignId}$`));
    const secondCampaignId = new URL(page.url()).pathname.split('/').at(-1)!;
    await page.getByText('Gestion et entreprises déjà connues', { exact: true }).click();
    await page.getByLabel('Entreprise déjà connue', { exact: true }).selectOption(company.id);
    await page.getByRole('button', { name: 'Rattacher à cette campagne', exact: true }).click();
    await expect.poll(async () => (await backup(request)).campaignData!.participations.some(item => item.companyId === company.id && item.campaignId === secondCampaignId)).toBe(true);
    await page.goto(`/campagnes/${secondCampaignId}?etape=suivre&prospect=${company.id}`);
    await page.getByLabel('Canal utilisé', { exact: true }).selectOption('phone');
    await page.getByLabel('Note et propos réellement exprimés', { exact: true }).fill('Tentative effectuée pour B, sans réponse.');
    await page.getByRole('radio', { name: 'Prévoir une prochaine action', exact: true }).check();
    await page.getByLabel('Prochaine action', { exact: true }).fill('Nouvelle tentative pour la campagne B');
    await page.getByLabel('Date choisie', { exact: true }).fill(shiftedDate(today, 4));
    await page.getByRole('button', { name: 'Enregistrer le résultat et la suite', exact: true }).click();
    await expect.poll(async () => participation(await backup(request), secondCampaignId, company.id).contactEvents?.length).toBe(1);
    await expect(page.getByLabel('Note et propos réellement exprimés', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Résultat du contact', { exact: true })).toHaveValue('no_response');
    await page.getByLabel('Résultat du contact', { exact: true }).selectOption('opposition');
    await page.getByLabel('Note et propos réellement exprimés', { exact: true }).fill('La personne demande explicitement de ne plus être contactée.');
    await expect(page.getByText('L’opposition sera appliquée à toutes les campagnes. Les actions prévues seront annulées ; aucun suivi de contact ne sera enregistré.', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Prévoir une prochaine action', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Enregistrer le résultat et la suite', exact: true }).click();
    await expect.poll(async () => (await backup(request)).companies.find(item => item.id === company.id)?.oppositionActive).toBe(true);
    data = await backup(request);
    expect(data.campaignData!.participations.filter(item => item.companyId === company.id).every(item => item.nextAction === null)).toBe(true);
    expect(participation(data, secondCampaignId, company.id).contactEvents!.at(-1)!.outcome).toBe('opposition');
    expect(participation(data, campaignId, company.id).qualification.answers.fit.answer).toBe('unknown');
  } finally {
    // Explicitly undo this test's fictional opposition before restoring the
    // baseline, since production restoration correctly preserves oppositions.
    if (companyId && (await backup(request)).companies.find(company => company.id === companyId)?.oppositionActive) {
      await page.goto(`/prospects/${companyId}?campagne=${cleanupCampaignId}`);
            await page.getByText('Observations, échanges et outils complémentaires', { exact: true }).click();
      await page.getByText('Archivage et opposition', { exact: true }).click();
      await page.getByRole('checkbox', { name: 'Je confirme la levée de l’opposition et la réactivation du contact.', exact: true }).check();
      await page.getByRole('button', { name: 'Réactiver explicitement le contact', exact: true }).click();
      await expect.poll(async () => (await backup(request)).companies.find(company => company.id === companyId)?.oppositionActive).toBe(false);
    }
    await restore(page, baseline);
  }
});

test('V2 P1 — deux réponses successives conservent le plan personnel et affichent les derniers propos', async ({ page, request }) => {
  test.setTimeout(150_000);
  const baseline = await backup(request);
  try {
    await configureProfile(page);
    const { campaignId, runId, candidates } = await launch(page, request, 'V2 P1 — réponses successives');
    const social = candidates.find(candidate => candidate.company.name === 'Atelier Social Démo')!;
    const company = await keep(page, request, runId, social, 'social-fact-8', '04 00 00 01 23');
    await page.goto(`/campagnes/${campaignId}?etape=preparer&prospect=${company.id}`);
    await expect(page.getByLabel('Preuve principale', { exact: true })).toHaveValue('social-fact-8');
    await proposePlan(page);
    const personal = {
      motive: 'J’ai consulté vos exemples de réalisations sur votre profil public.',
      hypothesis: 'Une présentation dédiée pourrait faciliter leur consultation, à confirmer avec vous.',
      help: 'Je peux proposer d’examiner la présentation de vos réalisations et votre parcours de contact.',
      question: 'Comment présentez-vous vos réalisations aux personnes qui vous découvrent ?',
      nextStep: 'Convenir d’un échange uniquement si vous souhaitez préciser cette piste.',
    };
    for (const [field, label] of [['motive', 'Motif'], ['hypothesis', 'Hypothèse à confirmer'], ['help', 'Aide proportionnée'], ['question', 'Question principale'], ['nextStep', 'Suite possible']] as const) {
      await page.getByLabel(label, { exact: true }).fill(personal[field]);
    }
    await page.getByRole('button', { name: 'Enregistrer mes formulations', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Vos formulations sont enregistrées.' })).toBeVisible();
    await page.getByRole('checkbox', { name: /Cette entreprise correspond à ma cible/ }).check();
    await page.getByRole('checkbox', { name: /Ce motif est documenté/ }).check();
    await page.getByLabel('Canal professionnel choisi', { exact: true }).selectOption('phone');
    await page.getByRole('checkbox', { name: /J’ai vérifié ce contact professionnel/ }).check();
    await page.getByRole('button', { name: 'Valider et préparer mes textes', exact: true }).click();
    await expect.poll(async () => participation(await backup(request), campaignId, company.id).drafts?.length).toBe(2);
    await page.getByRole('navigation', { name: 'Préparation du contact', exact: true }).getByRole('button', { name: 'Résultat et suivi', exact: true }).click();
    const notes = [
      'La personne souhaite montrer ses réalisations de cuisines lors du premier échange.',
      'La personne précise ensuite que sa priorité est la présentation de ses chantiers extérieurs.',
    ];
    for (let index = 0; index < notes.length; index++) {
      await page.getByLabel('Canal utilisé', { exact: true }).selectOption('phone');
      await page.getByLabel('Résultat du contact', { exact: true }).selectOption('conversation');
      await page.getByLabel('Note et propos réellement exprimés', { exact: true }).fill(notes[index]);
      await page.getByRole('radio', { name: 'Aucun suivi prévu', exact: true }).check();
      await page.getByRole('button', { name: 'Enregistrer le résultat et la suite', exact: true }).click();
      await expect.poll(async () => participation(await backup(request), campaignId, company.id).contactEvents?.length).toBe(index + 1);
      await expect(page.getByLabel('Note et propos réellement exprimés', { exact: true })).toHaveValue('');
      const eventId = participation(await backup(request), campaignId, company.id).contactEvents![index].id;
      const event = page.locator('details.workspace-detail').filter({ has: page.locator(`input[name="eventId"][value="${eventId}"]`) });
      await event.locator(':scope > summary').click();
      await event.getByRole('button', { name: 'Préparer une réponse à partir de ces propos', exact: true }).click();
      await expect.poll(async () => participation(await backup(request), campaignId, company.id).drafts?.filter(draft => draft.channel === 'reply').length).toBe(index + 1);
      const reply = page.getByLabel('Réponse préparée', { exact: true });
      await expect.poll(async () => reply.inputValue()).toContain(notes[index]);
      if (index) expect(await reply.inputValue()).not.toContain(notes[0]);
      const current = participation(await backup(request), campaignId, company.id);
      expect(current.readiness!.reason).toBe(false);
      expect(current.plan!.evidenceIds).toEqual(['social-fact-8']);
      for (const field of ['motive', 'hypothesis', 'help', 'question', 'nextStep'] as const) expect(current.plan![field]).toBe(personal[field]);
      const latestReply = current.drafts!.filter(draft => draft.channel === 'reply').at(-1)!;
      expect(latestReply.text).toContain(notes[index]);
      if (index) expect(latestReply.text).not.toContain(notes[0]);
      expect(latestReply.planId).toBe(current.plan!.id);
    }
  } finally { await restore(page, baseline); }
});
