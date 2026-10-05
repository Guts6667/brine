import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Backup } from '../lib/types';
import JSZip from 'jszip';

const testPassword = 'brine-browser-test-password';
const origin = 'http://127.0.0.1:3200';

test.describe('accès privé', () => {
  test('connexion requise, création et export authentifiés, puis déconnexion', async ({ page }) => {
    const requestedRoute = '/prospects?filter=archived&q=acc%C3%A8s';
    for (const route of ['/', '/apprendre', '/apprendre/email', '/sauvegarde', '/campagnes/rapports/inconnu?campagne=initial', '/campagnes/rapports/candidat/inconnu', requestedRoute]) {
      await page.goto(route);
      const loginUrl = new URL(page.url());
      expect(loginUrl.pathname).toBe('/connexion');
      expect(loginUrl.searchParams.get('returnTo')).toBe(route);
      await expect(page.getByLabel('Mot de passe', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Déconnexion', exact: true })).toHaveCount(0);
    }

    for(const route of ['/api/campaign-runs/unknown','/api/campaign-runs/reconcile','/api/research-assets/'+ 'a'.repeat(64),'/api/client-briefs/unknown','/api/learning/example-brief'])expect((await page.request.get(route)).status()).toBe(401);
    expect((await page.request.post('/api/client-briefs/preview',{headers:{Origin:origin,'Sec-Fetch-Site':'same-origin'},data:{}})).status()).toBe(401);
    const invalidWorkflow=await page.request.post('/.well-known/workflow/v1/flow',{data:{runId:'unknown'}});expect(invalidWorkflow.status()).toBeGreaterThanOrEqual(400);
    const anonymousBackup = await page.request.get('/api/backup');
    expect(anonymousBackup.status()).toBe(401);
    expect(await anonymousBackup.text()).toBe('Connexion requise.');
    const anonymousMutation = await page.request.post('/prospects', {
      headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
      form: { name: 'Création non autorisée' },
    });
    expect(anonymousMutation.status()).toBe(401);

    await page.getByLabel('Mot de passe', { exact: true }).fill('mot-de-passe-incorrect');
    await page.getByRole('button', { name: 'Entrer dans Brine', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Mot de passe incorrect.' })).toHaveText('Mot de passe incorrect.');
    expect((await page.context().cookies()).some(cookie => cookie.name === 'brine_session')).toBe(false);

    await page.getByLabel('Mot de passe', { exact: true }).fill(testPassword);
    await page.getByRole('button', { name: 'Entrer dans Brine', exact: true }).click();
    await expect(page).toHaveURL(origin + requestedRoute);
    await expect(page.getByRole('heading', { name: /^Prospects/ })).toBeVisible();

    const session = (await page.context().cookies()).find(cookie => cookie.name === 'brine_session');
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(session!.expires).toBeGreaterThan(Date.now() / 1000);
    expect(session!.expires).toBeLessThanOrEqual(Date.now() / 1000 + 8 * 60 * 60 + 60);
    expect(await page.evaluate(() => document.cookie)).not.toContain('brine_session');

    const companyName = 'Brine — accès privé navigateur';
    await page.goto('/prospects');
    await page.getByRole('button', { name: 'Ajouter une entreprise', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nom de l’entreprise', { exact: false }).fill(companyName);
    await dialog.getByRole('button', { name: 'Créer l’entreprise', exact: true }).click();
    await expect(page).toHaveURL(/\/prospects\/[^/?]+\?created=1(?:&campagne=[^&]+)?$/);
    await expect(page.getByRole('heading', { name: companyName, exact: true })).toBeVisible();
    const companyId = new URL(page.url()).pathname.split('/').at(-1)!;

    const authenticatedBackup = await page.request.get('/api/backup');
    expect(authenticatedBackup.status()).toBe(200);
    expect(authenticatedBackup.headers()['cache-control']).toContain('no-store');
    const saved = await authenticatedBackup.json() as Backup;
    expect(saved.companies).toContainEqual(expect.objectContaining({ id: companyId, name: companyName }));
    expect(saved.companies.some(company => company.name === 'Création non autorisée')).toBe(false);

    const blockedRequestHeaders: Record<string, string>[] = [
      {},
      { Origin: 'https://example.com' },
      { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
      { Origin: origin, 'Sec-Fetch-Site': 'same-site' },
    ];
    for (const headers of blockedRequestHeaders) {
      const blocked = await page.request.post('/prospects', { headers, form: { name: 'Mutation externe' } });
      expect(blocked.status()).toBe(403);
    }
    expect((await (await page.request.get('/api/backup')).json()).companies).toEqual(saved.companies);

    await page.goto('/sauvegarde');
    const pendingDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger la sauvegarde complète (ZIP)', exact: true }).click();
    const download = await pendingDownload;
    expect(download.suggestedFilename()).toMatch(/^brine-\d{4}-\d{2}-\d{2}\.zip$/);
    const zip=await JSZip.loadAsync(await readFile((await download.path())!));
    const downloaded = JSON.parse(await zip.file('brine.json')!.async('string')) as Backup;
    expect(downloaded.companies).toEqual(saved.companies);

    await page.getByRole('button', { name: 'Déconnexion', exact: true }).click();
    await expect(page).toHaveURL(origin + '/connexion');
    expect((await page.context().cookies()).some(cookie => cookie.name === 'brine_session')).toBe(false);
    expect((await page.request.get('/api/backup')).status()).toBe(401);
    await page.goto(`/prospects/${companyId}`);
    await expect(page).toHaveURL(/\/connexion\?returnTo=/);
    await expect(page.getByRole('heading', { name: companyName, exact: true })).toHaveCount(0);
  });

  test('connexion au clavier sur mobile et redirection externe neutralisée', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/connexion?returnTo=' + encodeURIComponent('https://example.com/collecte'));
    const password = page.getByLabel('Mot de passe', { exact: true });
    const submit = page.getByRole('button', { name: 'Entrer dans Brine', exact: true });
    await expect(password).toBeVisible();
    await expect(password).toBeFocused();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const buttonBounds = await submit.boundingBox();
    expect(buttonBounds).not.toBeNull();
    expect(buttonBounds!.x).toBeGreaterThanOrEqual(0);
    expect(buttonBounds!.x + buttonBounds!.width).toBeLessThanOrEqual(375);

    await page.keyboard.type(testPassword);
    await page.keyboard.press('Tab');
    await expect(submit).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(origin + '/');
    await expect(page.getByRole('button', { name: 'Déconnexion', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await page.request.get('/api/backup')).status()).toBe(200);
  });
});
