import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openCompanyInformation, openCompanyContacts, openQualificationCriterion } from './qualification-helpers';
import type { Backup } from '../lib/types';

const questions = [
  'Cette entreprise correspond-elle à ma cible ?',
  'Ai-je identifié un problème concret que je peux améliorer ?',
  'Y a-t-il une raison pertinente de la contacter maintenant ?',
  'Cette entreprise possède-t-elle des preuves de son savoir-faire à mieux valoriser ?',
  'Ai-je un moyen professionnel de joindre le bon interlocuteur ?',
];

async function backup(request: APIRequestContext): Promise<Backup> {
  const response = await request.get('/api/backup');
  expect(response.ok()).toBeTruthy();
  const data:Backup=await response.json();
  return {...data,companies:data.companies.map(c=>{const p=data.campaignData?.participations.find(p=>p.companyId===c.id&&p.campaignId==='initial');return p?{...c,stage:p.stage,archived:p.archived,nextAction:c.oppositionActive?null:p.nextAction,qualification:{...p.qualification,observations:c.qualification!.observations}}:c;})};
}

async function createCompany(page: Page, name: string): Promise<string> {
  await page.goto('/prospects');
  await page.getByRole('button', { name: 'Ajouter un prospect', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nom du prospect', { exact: false }).fill(name);
  await dialog.getByRole('button', { name: 'Créer le prospect', exact: true }).click();
  await expect(page).toHaveURL(/\/prospects\/[^/?]+\?created=1(?:&campagne=[^&]+)?$/);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

async function answer(page: Page, index: number, value: string) {
  await openQualificationCriterion(page, ['fit', 'problem', 'trigger', 'references', 'access'][index]);
  await page.getByRole('group', { name: questions[index], exact: true }).getByRole('radio', { name: value, exact: true }).check();
}

async function saveQualification(page: Page) {
  const form = page.getByTestId('qualification-form');
  await form.getByRole('button', { name: 'Enregistrer la qualification', exact: true }).click();
  await expect(form.getByRole('status').filter({ hasText: /Qualification enregistrée|Brouillon enregistré/ })).toBeVisible();
}

async function saveCompany(page: Page) {
  await page.getByRole('button', { name: 'Enregistrer la fiche', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Fiche enregistrée. La qualification a été recalculée.' })).toBeVisible();
}

async function closeDialog(page: Page) {
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
}

async function planAction(page: Page, text: string, date: string) {
  await page.getByRole('tab', { name: 'Contacter', exact: true }).click();
  await page.getByRole('button', { name: 'Prévoir la suite', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Action(?:\s|$)/).fill(text);
  await dialog.getByLabel('Date de l’action', { exact: true }).fill(date);
  await dialog.getByRole('button', { name: 'Enregistrer l’action', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Prochaine action enregistrée.');
  await closeDialog(page);
}

function dateInParis(offset = 0) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test('nom seul, qualification recalculée et action planifiée, reportée puis terminée', async ({ page, request }) => {
  await page.goto('/');
  await page.screenshot({ path: 'test-results/preview-accueil.png', fullPage: true, caret: 'initial' });
  const name = 'Atelier du Lez — parcours navigateur';
  const id = await createCompany(page, name);
  let saved = (await backup(request)).companies.find(company => company.id === id)!;
  expect(saved).toMatchObject({ city: '', business: '', targetFit: 'unknown', problemFound: 'unknown', contactAvailable: 'unknown', stage: 'À étudier' });
  await expect(page.getByTestId('qualification-summary')).toContainText('0/100');
  await page.getByRole('tab',{name:'Qualifier',exact:true}).click();
  for (const question of questions) {await page.getByRole('combobox',{name:'Critère à vérifier · 5',exact:true}).selectOption(['fit','problem','trigger','references','access'][questions.indexOf(question)]);await expect(page.getByRole('group', { name: question, exact: true }).getByRole('radio', { name: 'À vérifier', exact: true })).toBeChecked();}

  await openCompanyContacts(page);
  await page.getByLabel('Email professionnel', { exact: true }).fill('bonjour@atelier-du-lez.example');
  await saveCompany(page);
  await expect.poll(async () => (await backup(request)).companies.find(company => company.id === id)!.contact.email).toBe('bonjour@atelier-du-lez.example');
  await answer(page, 0, 'Exactement');
  await answer(page, 1, 'Un problème concret vérifié');
  await answer(page, 2, 'Aucun déclencheur repéré après recherche');
  await answer(page, 3, 'Aucune trouvée après vérification');
  await answer(page, 4, 'Canal professionnel générique de l’entreprise');
  await openQualificationCriterion(page, 'fit');
  await page.getByRole('checkbox', { name: 'Je confirme cette évaluation par rapport à la cible actuelle.', exact: true }).check();
  await saveQualification(page);
  await expect(page.getByTestId('qualification-summary')).toContainText('25/100');
  await expect(page.getByTestId('qualification-summary')).toContainText('4/5 critères renseignés');
  await openQualificationCriterion(page, 'problem');
  await expect(page.getByRole('group', { name: questions[1], exact: true }).getByRole('radio', { name: 'Un problème concret vérifié', exact: true })).toBeChecked();

  await page.getByLabel('Le problème concret constaté', { exact: true }).fill('Le formulaire de devis ne permet pas d’envoyer la demande.');
  await page.getByLabel('Date du constat', { exact: true }).fill(dateInParis());
  await saveQualification(page);
  await expect(page.getByTestId('qualification-summary')).toContainText('40/100');
  await expect(page.getByTestId('qualification-summary')).toContainText('Prêt à contacter');
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.screenshot({ path: 'test-results/preview-fiche.png', fullPage: true, caret: 'initial' });

  await answer(page, 0, 'Non');
  await saveQualification(page);
  await expect(page.getByTestId('qualification-summary')).toContainText('Hors cible');
  await answer(page, 0, 'Exactement');
  await saveQualification(page);
  await expect(page.getByTestId('qualification-summary')).toContainText('Prêt à contacter');
  await openCompanyContacts(page);
  await page.getByLabel('Email professionnel', { exact: true }).fill('');
  await saveCompany(page);
  await page.getByRole('tab',{name:'Qualifier',exact:true}).click();
  await expect(page.getByTestId('qualification-summary')).toContainText('35/100');
  await expect(page.getByTestId('qualification-summary')).toContainText('4/5 critères renseignés');
  await page.getByTestId('qualification-summary').locator(':scope > details > summary').click();
  await expect(page.getByTestId('qualification-summary').getByText('À vérifier', { exact: true }).first()).toBeVisible();
  saved = (await backup(request)).companies.find(company => company.id === id)!;
  expect(saved.qualification!.answers.access.answer).toBe('generic');
  expect(saved.contact.email).toBe('');

  await openCompanyContacts(page);
  await page.getByLabel('Email professionnel', { exact: true }).fill('bonjour@atelier-du-lez.example');
  await saveCompany(page);
  await page.getByRole('tab',{name:'Qualifier',exact:true}).click();
  await expect(page.getByTestId('qualification-summary')).toContainText('Prêt à contacter');
  await planAction(page, 'Appeler pour présenter le constat', dateInParis(-1));
  await page.goto('/');
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /En retard/ })).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Reporter', exact: true }).click();
  const reportDialog = page.getByRole('dialog');
  await reportDialog.getByLabel('Nouvelle date', { exact: true }).fill(dateInParis());
  await reportDialog.getByRole('button', { name: 'Confirmer le report', exact: true }).click();
  // Moving the action from overdue to today remounts its row and closes the dialog.
  await expect.poll(async () => (await backup(request)).companies.find(company => company.id === id)!.nextAction!.date).toBe(dateInParis());
  await expect(reportDialog).not.toBeVisible();
  expect((await backup(request)).companies.find(company => company.id === id)!.nextAction!.date).toBe(dateInParis());

  await page.goto('/');
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Enregistrer le résultat', exact: true }).click();
  await page.getByLabel('Ce que vous avez fait', {exact:true}).selectOption('action');
  await page.getByRole('radio', {name:'Aucun suivi prévu',exact:true}).check();
  await page.getByRole('button',{name:'Enregistrer le résultat et la suite',exact:true}).click();
  await expect.poll(async () => (await backup(request)).companies.find(company => company.id === id)!.nextAction).toBeNull();
  await page.goto(`/prospects/${id}`);
  await openCompanyInformation(page);
  await expect(page.getByRole('region', { name: 'Notes et échanges', exact: true }).getByRole('listitem').filter({ hasText: 'Action terminée' })).toContainText('Appeler pour présenter le constat');
  const history = (await backup(request)).activities.filter(activity => activity.companyId === id);
  expect(history.some(activity => activity.kind === 'action_done')).toBeTruthy();
  expect(history.some(activity => activity.kind === 'action_rescheduled')).toBeTruthy();
  await page.getByRole('tab', { name: 'Contacter', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Prévoir la suite', exact: true }).first()).toBeVisible();
});

test('notes conservées à l’archivage, relevés IA manuels et opposition sans relance implicite', async ({ page, request }) => {
  const name = 'Rénovation des Arceaux — historique navigateur';
  const id = await createCompany(page, name);
  await openCompanyInformation(page);
  await page.getByRole('button', { name: 'Ajouter une note', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Note(?:\s|$)/).fill('Observation conservée : <script>window.hacked = true</script>');
  await dialog.getByRole('button', { name: 'Enregistrer la note', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Ajouté à l’historique.');
  await closeDialog(page);
  await openCompanyInformation(page);
  await expect(page.getByRole('region', { name: 'Notes et échanges', exact: true }).getByRole('list').getByText('Observation conservée : <script>window.hacked = true</script>', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => 'hacked' in window)).toBe(false);

  await openCompanyInformation(page);
  await page.getByText('Archivage et opposition', { exact: true }).click();
  await page.getByRole('button', { name: 'Archiver', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Désarchiver', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Désarchiver', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Archiver', exact: true })).toBeVisible();
  await openCompanyInformation(page);
  await expect(page.getByRole('region', { name: 'Notes et échanges', exact: true }).getByRole('list').getByText('Observation conservée : <script>window.hacked = true</script>', { exact: true })).toBeVisible();

  const testsSummary = page.locator('summary').filter({ hasText: 'Visibilité IA' });
  await expect(testsSummary.locator('..')).not.toHaveAttribute('open', '');
  await testsSummary.click();
  await page.getByRole('button', { name: 'Ajouter un relevé', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nom du panel', { exact: true }).fill('Panel Montpellier');
  await dialog.getByLabel('Outil', { exact: true }).fill('ChatGPT');
  await dialog.getByLabel('Interface exacte', { exact: true }).fill('Application web sur ordinateur');
  await dialog.getByLabel('Mode utilisé', { exact: true }).selectOption('web');
  await dialog.getByLabel('Réponses valides', { exact: true }).fill('10');
  await dialog.getByLabel('Recommandations de l’entreprise', { exact: true }).fill('12');
  await dialog.getByLabel('Réponses citant directement le site', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Enregistrer le relevé', exact: true }).click();
  await expect(dialog.getByText('Ce nombre ne peut pas dépasser le nombre de réponses valides.', { exact: true })).toBeVisible();
  expect((await backup(request)).aiTests.filter(aiTest => aiTest.companyId === id)).toHaveLength(0);
  await dialog.getByLabel('Recommandations de l’entreprise', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Enregistrer le relevé', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Relevé enregistré.');
  await closeDialog(page);
  await expect(page.getByText('Recommandée dans 2 réponses sur 10', { exact: true })).toBeVisible();
  await expect(page.getByText('Site cité dans 1 réponse sur 10', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Ajouter un relevé', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nom du panel', { exact: true }).fill('Panel sans réponse valide');
  await dialog.getByLabel('Réponses valides', { exact: true }).fill('0');
  await dialog.getByLabel('Recommandations de l’entreprise', { exact: true }).fill('0');
  await dialog.getByLabel('Réponses citant directement le site', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'Enregistrer le relevé', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Relevé enregistré.');
  await closeDialog(page);
  await expect(page.getByText('Non mesuré', { exact: true }).first()).toBeVisible();
  expect((await backup(request)).companies.find(company => company.id === id)!.stage).toBe('À étudier');

  await planAction(page, 'Prendre contact pour la rénovation', dateInParis());
  await openCompanyInformation(page);
  await page.getByText('Archivage et opposition', { exact: true }).click();
  await page.getByRole('button', { name: 'Marquer Ne plus contacter', exact: true }).click();
  await expect(page.getByText('Ne plus contacter', { exact: true }).first()).toBeVisible();
  const saved = (await backup(request)).companies.find(company => company.id === id)!;
  expect(saved.oppositionActive).toBe(true);
  expect(saved.nextAction).toBeNull();
  await openCompanyContacts(page);
  await expect(page.getByRole('button', { name: 'Prévoir la suite', exact: true })).toHaveCount(0);
  await page.getByText('Informations et étape du prospect', { exact: true }).click();
  await page.getByLabel('Étape commerciale', { exact: true }).selectOption('En échange');
  await saveCompany(page);
  await expect.poll(async () => (await backup(request)).companies.find(company => company.id === id)!.stage).toBe('En échange');
  expect((await backup(request)).companies.find(company => company.id === id)!.oppositionActive).toBe(true);
  await page.goto('/');
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
});

test('sauvegarde complète restaurée avec aperçu et conservation d’une opposition postérieure', async ({ page, request }) => {
  const name = 'Entreprise de sauvegarde — navigateur';
  const id = await createCompany(page, name);
  await planAction(page, 'Préparer la conversation', dateInParis(1));
  const prior = await backup(request);
  expect(prior.companies.find(company => company.id === id)!.oppositionActive).toBe(false);

  await page.goto('/sauvegarde');
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger la sauvegarde complète (ZIP)', exact: true }).click();
  const download = await downloadPending;
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();

  await page.goto(`/prospects/${id}`);
  await openCompanyInformation(page);
  await page.getByText('Archivage et opposition', { exact: true }).click();
  await page.getByLabel('Note d’opposition (facultative)', { exact: true }).fill('Opposition enregistrée après la sauvegarde.');
  await page.getByRole('button', { name: 'Marquer Ne plus contacter', exact: true }).click();
  await expect(page.getByText('Ne plus contacter', { exact: true }).first()).toBeVisible();

  await page.goto('/sauvegarde');
  await page.getByLabel('Sauvegarde Brine ZIP ou ancien fichier JSON', { exact: true }).setInputFiles(downloadedPath!);
  await page.getByRole('button', { name: 'Vérifier le fichier', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Aperçu du fichier', exact: true })).toBeVisible();
  await expect(page.getByText(`${prior.companies.length} entreprise(s)`, { exact: false })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Je confirme le remplacement des données par cette sauvegarde.', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Je confirme le remplacement des données par cette sauvegarde.', exact: true }).check();
  await page.getByRole('button', { name: 'Confirmer la restauration', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restauration terminée.' })).toBeVisible();

  const restored = await backup(request);
  expect(restored.companies).toHaveLength(prior.companies.length);
  expect(restored.aiTests).toEqual(prior.aiTests);
  for (const activity of prior.activities) expect(restored.activities).toContainEqual(activity);
  const opposed = restored.companies.find(company => company.id === id)!;
  expect(opposed.oppositionActive).toBe(true);
  expect(opposed.oppositionNote).toBe('Opposition enregistrée après la sauvegarde.');
  expect(opposed.nextAction).toBeNull();

  // A second preview in the same page must ask for a fresh confirmation.
  await page.getByLabel('Sauvegarde Brine ZIP ou ancien fichier JSON', { exact: true }).setInputFiles(downloadedPath!);
  await page.getByRole('button', { name: 'Vérifier le fichier', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Aperçu du fichier', exact: true })).toBeVisible();
  const secondConfirmation = page.getByRole('checkbox', { name: 'Je confirme le remplacement des données par cette sauvegarde.', exact: true });
  await expect(secondConfirmation).not.toBeChecked();
  await secondConfirmation.check();
  await page.getByRole('button', { name: 'Confirmer la restauration', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restauration terminée.' })).toBeVisible();
  expect((await backup(request)).companies.find(company => company.id === id)!.oppositionActive).toBe(true);

  // Older complete JSON files remain restorable and are exported in the new format.
  const legacyBackup = {
    exportedAt:prior.exportedAt,activities:prior.activities,aiTests:prior.aiTests,
    schemaVersion: 1,
    settings: { targetCity: prior.settings.targetCity, targetBusiness: prior.settings.targetBusiness },
    companies: prior.companies.map(({ qualification: _qualification, ...company }) => company),
  };
  await page.getByLabel('Sauvegarde Brine ZIP ou ancien fichier JSON', { exact: true }).setInputFiles({
    name: 'brine-sauvegarde-v1.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacyBackup)),
  });
  await page.getByRole('button', { name: 'Vérifier le fichier', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Aperçu du fichier', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Je confirme le remplacement des données par cette sauvegarde.', exact: true }).check();
  await page.getByRole('button', { name: 'Confirmer la restauration', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restauration terminée.' })).toBeVisible();
  const normalized = await backup(request);
  expect(normalized.schemaVersion).toBe(7);
  expect(normalized.companies).toHaveLength(prior.companies.length);
  expect(normalized.aiTests).toEqual(prior.aiTests);
  for (const activity of prior.activities) expect(normalized.activities).toContainEqual(activity);
  for (const company of normalized.companies) {
    expect(company.qualification!.version).toBe(1);
    expect(company.qualification!.answers.fit.answer).toBe('unknown');
  }
  expect(normalized.companies.find(company => company.id === id)!.oppositionActive).toBe(true);

  await page.goto(`/prospects/${id}`);
  await expect(page.getByText('Ne plus contacter', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prévoir la suite', exact: true })).toHaveCount(0);
});

test('création au clavier et écrans étroits sans débordement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/prospects');
  const add = page.getByRole('button', { name: 'Ajouter un prospect', exact: true }).first();
  await add.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Nom du prospect', { exact: false })).toBeFocused();
  await page.keyboard.type('Entreprise créée au clavier');
  for (let index = 0; index < 4; index++) await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Créer le prospect', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Entreprise créée au clavier', exact: true })).toBeVisible();
  const detailUrl = page.url();
  for (const url of [detailUrl, '/prospects', '/', '/sauvegarde']) {
    await page.goto(url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.goto('/prospects');
  await page.screenshot({ path: 'test-results/preview-etroit.png', fullPage: true, caret: 'initial' });
});
