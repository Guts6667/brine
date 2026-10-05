import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Backup } from '../lib/types';
import { emptyLearningProgress } from '../lib/learning-schema';

const read = async (request: APIRequestContext): Promise<Backup> => (await request.get('/api/backup')).json();
function stable({ exportedAt: _time, ...data }: Backup) { return data; }
async function restore(page: Page, backup: Backup) {
  await page.goto('/sauvegarde');
  await page.getByLabel('Sauvegarde Brine ZIP ou ancien fichier JSON', { exact: true }).setInputFiles({ name: 'baseline.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByRole('button', { name: 'Vérifier le fichier', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Je confirme le remplacement des données par cette sauvegarde.', exact: true }).check();
  await page.getByRole('button', { name: 'Confirmer la restauration', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restauration terminée.' })).toBeVisible();
}

for (const width of [1280, 390]) test(`le design reste clair, tactile et utilisable avec mouvement réduit à ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  const before = await read(request);
  await expect(page.getByRole('region', { name: 'Votre prochaine action' })).toBeVisible();
  const colors = await page.evaluate(() => ({
    canvas: getComputedStyle(document.body).backgroundColor,
    left: getComputedStyle(document.querySelector('.sidebar')!).backgroundColor,
    top: getComputedStyle(document.querySelector('.topbar')!).backgroundColor,
    frame: getComputedStyle(document.querySelector('.workspace')!).borderRadius,
    margin: getComputedStyle(document.body).margin,
  }));
  expect(colors).toEqual({ canvas: 'rgb(243, 240, 232)', left: 'rgb(23, 23, 23)', top: 'rgb(23, 23, 23)', frame: '0px', margin: '0px' });
  for (const link of await page.locator('.sidebar .nav-link').all()) {
    const box = await link.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  const action = page.getByRole('region', { name: 'Votre prochaine action' }).getByRole('link');
  expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  if (width === 390) { const box = (await action.boundingBox())!; expect(box.y + box.height).toBeLessThanOrEqual(844); }
  await action.hover(); expect(await action.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  for (const route of ['/apprendre', '/campagnes/initial?etape=rechercher', '/prospects']) {
    await page.goto(route); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await page.goto('/apprendre');
  const button = page.getByRole('link', { name: 'Commencer', exact: true });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.locator('.learn-start-copy > p').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  expect(stable(await read(request))).toEqual(stable(before));
});

test('la prochaine action reprend une action réellement prévue sans créer de contact ni la terminer', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const baseline = await read(request);
  try {
    await page.goto('/prospects');
    await page.getByRole('button', { name: 'Ajouter une entreprise', exact: true }).first().click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom de l’entreprise', { exact: false }).fill('Atelier Papier · essai du design');
    await dialog.getByRole('button', { name: 'Créer l’entreprise', exact: true }).click();
    await expect(page).toHaveURL(/\/prospects\//);
    const id = new URL(page.url()).pathname.split('/').at(-1)!;
    await page.getByRole('button', { name: 'Prévoir la suite', exact: true }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Action(?:\s|$)/).fill('Relire les notes de la conversation');
    await dialog.getByLabel('Date de l’action', { exact: true }).fill('2000-01-01');
    await dialog.getByRole('button', { name: 'Enregistrer l’action', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Prochaine action enregistrée.');
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
    const before = await read(request);
    await page.goto('/');
    const card = page.getByRole('region', { name: 'Votre prochaine action' });
    await expect(card).toContainText('Atelier Papier · essai du design');
    await expect(card).toContainText('Relire les notes de la conversation');
    await card.getByRole('link', { name: 'Reprendre cette action', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/campagnes/initial\\?etape=suivre&prospect=${id}`));
    expect(stable(await read(request))).toEqual(stable(before));
    await page.goto('/campagnes/initial/qualification?filtre=accepted');
    const search = page.getByRole('searchbox', { name: 'Rechercher une entreprise', exact: true });
    await search.fill('Atelier Papier');
    await search.evaluate(el => el.setAttribute('data-preserved-draft', 'yes'));
    const guide = page.getByRole('complementary', { name: 'Guide de campagne' });
    const open = guide.getByRole('button', { name: 'Me guider', exact: true });
    if (await open.isVisible()) await open.click();
    const close = guide.getByRole('button', { name: 'Fermer le guide', exact: true });
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    const row = page.locator('.qualification-table tbody tr');
    await expect(row).toHaveCount(1);
    await expect.poll(() => row.evaluate(el => getComputedStyle(el).display)).toBe('grid');
    const view = row.getByRole('link', { name: 'Qualifier Atelier Papier · essai du design', exact: true });
    expect((await view.boundingBox())!.width).toBeGreaterThan(250);
    await close.click();
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(search).toHaveValue('Atelier Papier');
    await expect(search).toHaveAttribute('data-preserved-draft', 'yes');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const { learningProgress: _learningAfter, ...afterCampaigns } = (await read(request)).campaignData!;
    const { learningProgress: _learningBefore, ...beforeCampaigns } = before.campaignData!;
    expect(afterCampaigns).toEqual(beforeCampaigns);
  } finally { await restore(page, { ...baseline, campaignData: { ...baseline.campaignData!, learningProgress: baseline.campaignData?.learningProgress || emptyLearningProgress() } }); }
});
