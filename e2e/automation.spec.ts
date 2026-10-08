import { expect, test } from '@playwright/test';
import { openCompanyInformation } from './qualification-helpers';

test('recherche accessible, activité configurable et formulaire utilisable sur mobile', async ({ page }) => {
  await page.goto('/prospects/recherche');
  await expect(page.getByRole('heading', { name: 'Trouver des entreprises' })).toBeVisible();
  await expect(page.getByLabel('Commune', { exact: true })).not.toHaveValue('');
  await page.getByLabel('Activité', { exact: true }).selectOption('custom');
  await page.getByLabel('Codes d’activité NAF', { exact: true }).fill('code invalide');
  await page.getByRole('button', { name: 'Rechercher des entreprises' }).click();
  await expect(page.locator('.discovery-layout').getByRole('alert')).toContainText('codes NAF');
  await expect(page.getByLabel('Activité', { exact: true })).toHaveValue('custom');
  await expect(page.getByLabel('Codes d’activité NAF', { exact: true })).toHaveValue('code invalide');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Commune', { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('analyse rejette les sites privés et prépare des questions IA sans inventer de résultat', async ({ page, request }) => {
  await page.goto('/prospects');
  await page.getByRole('button', { name: 'Ajouter un prospect', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Nom du prospect/).fill('Brine — audit sécurisé');
  await dialog.getByLabel('Site web', { exact: true }).fill('http://127.0.0.1/');
  await dialog.getByRole('button', { name: 'Créer le prospect', exact: true }).click();
  await expect(page).toHaveURL(/\/prospects\/[^/?]+\?created=1(?:&campagne=[^&]+)?$/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  await openCompanyInformation(page);
  const audit = page.getByRole('region', { name: 'Vérifier le site et préparer l’approche' });
  await audit.getByRole('button', { name: 'Analyser le site', exact: true }).click();
  await expect(audit.getByRole('alert')).toContainText(/locales|privées|réservées/);
  await page.locator('details.tests-panel > summary').click();
  await expect(page.getByRole('heading', { name: 'Préparer un relevé de visibilité IA' })).toBeVisible();
  await expect(page.locator('.ai-research-prompts li')).toHaveCount(3);
  await expect(page.locator('.ai-record')).toHaveCount(0);
  const backup = await (await request.get('/api/backup')).json();
  const company = backup.companies.find((entry: { id: string }) => entry.id === id);
  expect(company.stage).toBe('À étudier');
  expect(company.qualification.answers.problem.answer).toBe('unknown');
  expect(backup.aiTests.filter((entry: { companyId: string }) => entry.companyId === id)).toHaveLength(0);
});
