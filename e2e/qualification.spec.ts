import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Backup, Company } from '../lib/types';

async function backup(request: APIRequestContext): Promise<Backup> {
  const response = await request.get('/api/backup');
  expect(response.ok()).toBeTruthy();
  const data:Backup=await response.json();
  return {...data,companies:data.companies.map(c=>{const p=data.campaignData?.participations.find(p=>p.companyId===c.id&&p.campaignId==='initial');return p?{...c,stage:p.stage,archived:p.archived,nextAction:c.oppositionActive?null:p.nextAction,qualification:{...p.qualification,observations:c.qualification!.observations}}:c;})};
}

async function savedCompany(request: APIRequestContext, id: string): Promise<Company> {
  return (await backup(request)).companies.find(company => company.id === id)!;
}

async function createCompany(page: Page, name: string): Promise<string> {
  await page.goto('/prospects');
  await page.getByRole('button', { name: 'Ajouter une entreprise', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Nom de l’entreprise/).fill(name);
  await dialog.getByRole('button', { name: 'Créer l’entreprise', exact: true }).click();
  await expect(page).toHaveURL(/\/prospects\/[^/?]+\?created=1(?:&campagne=[^&]+)?$/);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

function parisDate(offset = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function choose(page: Page, criterion: string, label: string) {
  await page.getByTestId(`qualification-question-${criterion}`).getByRole('radio', { name: label, exact: true }).check();
}

async function saveQualification(page: Page, request: APIRequestContext, id: string) {
  const form = page.getByTestId('qualification-form');
  const input = JSON.parse(await form.locator('input[name="payload"]').inputValue());
  await form.getByRole('button', { name: 'Enregistrer la qualification', exact: true }).click();
  await expect(form.getByRole('status').filter({ hasText: /Qualification enregistrée|Brouillon enregistré/ })).toBeVisible();
  await expect.poll(async () => (await savedCompany(request, id)).qualification!.answers).toEqual(input.answers);
}

async function saveContact(page: Page, request: APIRequestContext, id: string, email: string) {
  await page.getByLabel('Email professionnel', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Enregistrer la fiche', exact: true }).click();
  await expect.poll(async () => (await savedCompany(request, id)).contact.email).toBe(email);
}

async function fillObservation(page: Page, key: string, answer: string, notes?: string, source?: string) {
  const row = page.getByTestId(`observation-${key}`);
  await row.getByRole('combobox').first().selectOption(answer);
  if (notes || source) {
    await row.locator('summary').click();
    if (notes) await row.getByLabel(/^Note ·/).fill(notes);
    if (source) await row.getByLabel(/^Source ·/).fill(source);
    await row.getByLabel(/^Date du relevé ·/).fill(parisDate());
  }
}

async function fillRecognizedExchange(page: Page) {
  const section = page.locator('details.after-exchange-block');
  if (!(await section.evaluate(element => (element as HTMLDetailsElement).open))) await section.locator('summary').first().click();
  const form = page.getByTestId('after-exchange-form');
  await form.getByLabel('Besoin reconnu', { exact: true }).selectOption('confirmed');
  await form.getByLabel('Les propos du prospect sur son besoin', { exact: true }).fill('Le prospect souhaite rendre sa nouvelle prestation visible et expliquer ses réalisations.');
  await form.getByLabel('Décision', { exact: true }).selectOption('identified');
  await form.getByLabel('Personne ou chemin de décision', { exact: true }).fill('La dirigeante décide après lecture du diagnostic avec son associé.');
  await form.getByLabel('Intervention envisagée', { exact: true }).selectOption('targeted_improvement');
  await form.getByLabel('Adéquation de la solution au besoin', { exact: true }).selectOption('confirmed');
  await form.getByLabel('Pourquoi cette solution répond au besoin', { exact: true }).fill('Clarifier la prestation et montrer deux réalisations répond aux demandes exprimées.');
  await form.getByLabel('Description de l’étape convenue', { exact: true }).fill('Présenter un diagnostic du site à la dirigeante.');
  await form.getByRole('checkbox', { name: 'Cette étape a été explicitement acceptée par l’interlocuteur.', exact: true }).check();
}

test('observations sans points automatiques, qualification manuelle 80/100 et revalidation de la cible', async ({ page, request }) => {
  const name = 'Brine — qualification documentée';
  const id = await createCompany(page, name);
  const summary = page.getByTestId('qualification-summary');
  await expect(summary).toContainText('Non évalué');
  await expect(page.getByTestId('qualification-form').locator('fieldset')).toHaveCount(5);

  const mobileNote = 'Le menu recouvre le numéro de téléphone sur un écran de 375 px.';
  const mobileSource = 'https://qualification.example/preuve-mobile';
  await fillObservation(page, 'mobile', 'yes', mobileNote, mobileSource);
  await fillObservation(page, 'mainAction', 'no', 'Aucun lien clair ne permet de demander un devis depuis l’accueil.');
  await fillObservation(page, 'contact', 'no', 'Le même menu empêche d’atteindre le téléphone ; ce constat ne constitue pas un second défaut.');
  await fillObservation(page, 'siteAge', 'yes');
  await page.getByLabel('Sur quoi repose ce constat d’ancienneté ?', { exact: true }).selectOption('visual_impression');
  await fillObservation(page, 'googleReviews', 'yes');
  await page.getByLabel('Nombre d’avis Google observé (facultatif)', { exact: true }).fill('25');
  await page.getByLabel('Note Google affichée sur 5 (facultative)', { exact: true }).fill('4.6');
  await fillObservation(page, 'siteSatisfactory', 'yes');
  await fillObservation(page, 'inactivity', 'no');
  await page.getByLabel('Taille de l’entreprise (si connue et utile)', { exact: true }).fill('Une personne, selon sa présentation publique.');
  const observationForm = page.getByTestId('observation-form');
  await observationForm.getByRole('button', { name: 'Enregistrer les observations', exact: true }).click();
  await expect(observationForm.getByRole('status')).toContainText('Observations enregistrées.');
  await expect.poll(async () => (await savedCompany(request, id)).qualification!.observations.items.mobile.notes).toBe(mobileNote);
  await expect(summary).toContainText('Non évalué');
  for (const criterion of ['fit', 'problem', 'trigger', 'references', 'access']) {
    await expect(page.getByTestId(`qualification-question-${criterion}`).getByRole('radio', { name: 'À vérifier', exact: true })).toBeChecked();
  }

  await saveContact(page, request, id, 'contact@qualification.example');
  await choose(page, 'fit', 'Exactement');
  await page.getByRole('checkbox', { name: 'Je confirme cette évaluation par rapport à la cible actuelle.', exact: true }).check();
  await choose(page, 'problem', 'Plusieurs problèmes distincts ou un blocage important');
  const problem = page.getByTestId('qualification-question-problem');
  await problem.locator('summary').filter({ hasText: 'Relier mes observations' }).click();
  await problem.locator('input[type="checkbox"][value="mobile"]').check();
  await problem.locator('input[type="checkbox"][value="contact"]').check();
  await problem.getByRole('button', { name: 'Reprendre les notes sélectionnées', exact: true }).click();
  await expect(page.getByLabel('Le problème concret observé', { exact: true })).toHaveValue(/Le menu recouvre le numéro de téléphone/);
  await page.getByLabel('Motif des points maximum', { exact: true }).selectOption('blocking');
  await page.getByLabel('Pourquoi ce blocage est-il important ?', { exact: true }).fill('Sur mobile, le menu empêche de lire le numéro nécessaire pour prendre contact.');

  await choose(page, 'trigger', 'Changement récent pertinent');
  await page.getByLabel('Le déclencheur vérifié', { exact: true }).fill('Une nouvelle prestation de rénovation de cuisine a été annoncée.');
  await page.getByLabel('Origine de l’information', { exact: true }).fill('https://qualification.example/nouvelle-prestation');
  await page.getByLabel('Date de vérification du déclencheur', { exact: true }).fill(parisDate());
  await page.getByLabel('Date de l’événement ou de l’annonce', { exact: true }).fill(parisDate(-1));
  await page.getByLabel('Lien avec l’intervention proposée', { exact: true }).fill('La page doit expliquer la prestation annoncée et comment demander un devis.');
  await choose(page, 'references', 'Plusieurs réalisations ou références');
  await page.getByLabel('Exemple 1 · réalisation ou référence', { exact: true }).fill('Cuisine de la maison des Arceaux.');
  await page.getByLabel('Exemple 2 · réalisation ou référence', { exact: true }).fill('Salle de bain de l’appartement du Lez.');
  await page.getByLabel('Ce qui pourrait être mieux présenté', { exact: true }).fill('Les deux chantiers sont montrés sans description du besoin ni du travail réalisé.');
  await page.getByLabel('Source des réalisations (facultative)', { exact: true }).fill('https://qualification.example/realisations');
  await choose(page, 'access', 'Canal professionnel générique de l’entreprise');
  await saveQualification(page, request, id);
  await expect(summary).toContainText('80/100');
  await expect(summary).toContainText('Priorité haute');
  await expect(summary).toContainText('Prêt à contacter');
  let saved = await savedCompany(request, id);
  expect(saved.stage).toBe('À étudier');
  expect(saved.nextAction).toBeNull();
  expect(saved.qualification!.answers.problem.observationKeys).toEqual(['mobile', 'contact']);
  expect(saved.qualification!.answers.problem.proofUrl).toBe(mobileSource);

  await page.reload();
  await summary.locator('summary').filter({ hasText: 'Pourquoi ce score ?' }).click();
  const problemDetails = summary.locator('.qual-criterion-detail').filter({ hasText: 'Ai-je identifié un problème concret que je peux améliorer ?' });
  await expect(problemDetails).toContainText('30/30 points');
  await expect(problemDetails).toContainText(mobileNote);
  await expect(problemDetails.getByRole('link', { name: 'Consulter la preuve du problème', exact: true })).toHaveAttribute('href', mobileSource);
  await expect(problemDetails.locator('.qual-linked-observation')).toHaveCount(2);
  expect((await savedCompany(request, id)).qualification!.observations.googleReviewCount).toBe(25);
  const originalTarget = saved.qualification!.targetSnapshot!;

  await page.goto('/prospects?filter=ready');
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await page.goto('/campagnes/initial');
  await page.getByText('Modifier la cible et l’offre', {exact:true}).click();
  await page.getByLabel('Commune', { exact: true }).fill('Sète — cible E2E modifiée');
  await page.getByRole('button', { name: 'Enregistrer la campagne', exact: true }).click();
  await expect.poll(async () => (await backup(request)).campaignData!.campaigns.find(c=>c.id==='initial')!.targetCity).toBe('Sète — cible E2E modifiée');
  await page.goto(`/prospects/${id}`);
  await expect(summary).toContainText('80/100');
  await expect(summary).toContainText('Adéquation à revérifier');
  await expect(summary.getByText('À vérifier', { exact: true }).first()).toBeVisible();
  saved = await savedCompany(request, id);
  expect(saved.qualification!.targetSnapshot).toEqual(originalTarget);
  expect(saved.qualification!.answers.fit.answer).toBe('exact');
  await page.goto('/prospects?filter=ready');
  await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
  await page.goto(`/prospects/${id}`);
  await page.getByRole('checkbox', { name: 'Je confirme cette évaluation par rapport à la cible actuelle.', exact: true }).check();
  await saveQualification(page, request, id);
  await expect(summary).toContainText('Prêt à contacter');
  expect((await savedCompany(request, id)).qualification!.targetSnapshot!.targetCity).toBe('Sète — cible E2E modifiée');
});

test('brouillon positif incomplet conservé sans score définitif et sans zéro implicite', async ({ page, request }) => {
  const name = 'Brine — brouillon incomplet';
  const id = await createCompany(page, name);
  const summary = page.getByTestId('qualification-summary');
  await choose(page, 'access', 'Aucun canal trouvé après recherche');
  await saveQualification(page, request, id);
  await expect(summary).toContainText('Contact à trouver');
  await expect(summary).toContainText('0 points confirmés');
  await expect(summary).not.toContainText('/100');
  await page.goto('/prospects?filter=verify');
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await page.goto(`/prospects/${id}`);
  await choose(page, 'access', 'À vérifier');
  await choose(page, 'fit', 'Exactement');
  await page.getByRole('checkbox', { name: 'Je confirme cette évaluation par rapport à la cible actuelle.', exact: true }).check();
  await choose(page, 'problem', 'Un problème concret vérifié');
  await choose(page, 'trigger', 'Aucun déclencheur repéré après recherche');
  await choose(page, 'references', 'Aucune trouvée après vérification');
  await saveQualification(page, request, id);
  await expect(summary).toContainText('20 points confirmés');
  await expect(summary).toContainText('3 critères sur 5 renseignés');
  await expect(summary).not.toContainText('/100');
  await expect(summary).not.toContainText('Priorité haute');
  await page.reload();
  await expect(page.getByTestId('qualification-question-problem').getByRole('radio', { name: 'Un problème concret vérifié', exact: true })).toBeChecked();
  await expect(page.getByLabel('Le problème concret observé', { exact: true })).toHaveValue('');
  await page.getByLabel('Le problème concret observé', { exact: true }).fill('Le détail de la prestation ne précise pas la zone d’intervention.');
  await page.getByLabel('Date d’observation du problème', { exact: true }).fill(parisDate());
  await saveQualification(page, request, id);
  await expect(summary).toContainText('35 points confirmés');
  await expect(summary).toContainText('4 critères sur 5 renseignés');
  await expect(summary).not.toContainText('/100');
  expect((await savedCompany(request, id)).qualification!.answers.access.answer).toBe('unknown');
});

test('après échange : budget inconnu permis, passage manuel et opposition bloquante', async ({ page, request }) => {
  const id = await createCompany(page, 'Brine — opportunité après échange');
  const section = page.locator('details.after-exchange-block');
  await expect(section).not.toHaveAttribute('open', '');
  await fillRecognizedExchange(page);
  const form = page.getByTestId('after-exchange-form');
  await expect(form.getByLabel('Budget envisageable', { exact: true })).toHaveValue('not_discussed');
  await expect(form.getByLabel('Capacité à avancer', { exact: true })).toHaveValue('unknown');
  await form.getByRole('button', { name: 'Enregistrer après l’échange', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Échange enregistré : Qualification possible.');
  let saved = await savedCompany(request, id);
  expect(saved.stage).toBe('À étudier');
  expect(saved.nextAction).toBeNull();
  expect(saved.qualification!.afterExchange.budget).toBe('not_discussed');
  await expect(page.getByTestId('qualification-summary')).toContainText('Non évalué');
  await expect(form).toContainText('Le budget de la solution discutée reste à vérifier.');
  await page.getByRole('button', { name: 'Passer à Opportunité qualifiée', exact: true }).click();
  await expect.poll(async () => (await savedCompany(request, id)).stage).toBe('Opportunité qualifiée');
  saved = await savedCompany(request, id);
  expect(saved.qualification!.afterExchange.qualifiedAt).not.toBe('');
  expect((await backup(request)).activities.some(activity => activity.companyId === id && activity.text.includes('Opportunité qualifiée'))).toBe(true);
  await form.getByLabel('Besoin reconnu', { exact: true }).selectOption('not_recognized');
  await form.getByRole('button', { name: 'Enregistrer après l’échange', exact: true }).click();
  await expect(section.getByRole('alert').filter({ hasText: 'Qualification à réévaluer.' })).toBeVisible();
  expect((await savedCompany(request, id)).stage).toBe('Opportunité qualifiée');

  const opposedId = await createCompany(page, 'Brine — échange avec opposition');
  await fillRecognizedExchange(page);
  await page.getByTestId('after-exchange-form').getByRole('button', { name: 'Enregistrer après l’échange', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Passer à Opportunité qualifiée', exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Archivage et opposition' }).click();
  await page.getByRole('button', { name: 'Marquer Ne plus contacter', exact: true }).click();
  await expect(page.getByTestId('qualification-summary')).toContainText('Ne plus contacter');
  await expect(page.getByTestId('after-exchange-form')).toContainText('Qualification bloquée');
  await expect(page.getByRole('button', { name: 'Passer à Opportunité qualifiée', exact: true })).toHaveCount(0);
  await page.locator('summary').filter({ hasText: 'Informations et étape de l’entreprise' }).click();
  await page.getByLabel('Étape commerciale', { exact: true }).selectOption('Opportunité qualifiée');
  await page.getByRole('button', { name: 'Enregistrer la fiche', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Les conditions après échange doivent être confirmées avant de qualifier cette opportunité.' })).toBeVisible();
  saved = await savedCompany(request, opposedId);
  expect(saved.stage).toBe('À étudier');
  expect(saved.oppositionActive).toBe(true);
  expect(saved.qualification!.afterExchange.qualifiedAt).toBe('');
});
