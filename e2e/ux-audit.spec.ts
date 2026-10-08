import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Backup } from '../lib/types';
import { openQualificationCriterion, openCompanyContacts } from './qualification-helpers';
import { confirmFact, openContactChoices, openFactSection } from './report-helpers';

// playwright.config.ts starts the server after e2e/reset-database.mjs has cleared
// only test-results/e2e/brine.sqlite. This test restores the original backup too.
const outputDirectory = path.resolve('test-results/ux');
const widths = [390, 820, 1280] as const;
const viewportHeight = 900;

type SmallText = { selector: string; text: string; px: number };
type SmallTarget = { selector: string; label: string; width: number; height: number };
type Measurement = {
  page: string;
  width: number;
  screenshot: string;
  bodyScrollWidth: number;
  documentScrollWidth: number;
  viewportWidth: number;
  firstScreenControls: number;
  smallText: SmallText[];
  smallTargets: SmallTarget[];
};

async function backup(request: APIRequestContext): Promise<Backup> {
  const response = await request.get('/api/backup');
  expect(response.ok()).toBe(true);
  return response.json();
}

async function restore(page: Page, baseline: Backup) {
  await page.goto('/sauvegarde');
  await page.getByLabel('Sauvegarde Brine ZIP ou ancien fichier JSON', { exact: true }).setInputFiles({
    name: 'ux-baseline.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(baseline)),
  });
  await page.getByRole('button', { name: 'Vérifier le fichier', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Je confirme le remplacement des données par cette sauvegarde.', exact: true }).check();
  await page.getByRole('button', { name: 'Confirmer la restauration', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restauration terminée.' })).toBeVisible();
}

async function createCompany(page: Page, campaignId: string, name: string): Promise<string> {
  await page.goto(`/campagnes/${campaignId}`);
  await page.getByRole('button', { name: 'Ajouter un prospect', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nom du prospect', { exact: false }).fill(name);
  await dialog.getByRole('button', { name: 'Créer le prospect', exact: true }).click();
  await expect(page).toHaveURL(/\/prospects\/[^/?]+/);
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

async function answer(page: Page, criterion: string, label: string) {
  await openQualificationCriterion(page, criterion);
  await page.getByTestId(`qualification-question-${criterion}`).getByRole('radio', { name: label, exact: true }).check();
}

async function saveQualification(page: Page) {
  const form = page.getByTestId('qualification-form');
  await form.getByRole('button', { name: 'Enregistrer la qualification', exact: true }).click();
  await expect(form.getByRole('status').filter({ hasText: /Qualification enregistrée|Brouillon enregistré/ })).toBeVisible();
}

function parisToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function seed(page: Page, request: APIRequestContext) {
  const campaignName = 'Audit UX — électricité';
  await page.goto('/campagnes/nouvelle');
  await page.getByLabel('Nom de la campagne', { exact: true }).fill(campaignName);
  await page.getByLabel('Commune', { exact: true }).fill('Lyon');
  await page.getByLabel('Activité recherchée', { exact: true }).fill('Électricité');
  await page.getByLabel(/Codes d’activité NAF/).fill('43.21A');
  await page.getByRole('button', { name: 'Créer la campagne', exact: true }).click();
  await expect(page.getByRole('heading', { name: campaignName, exact: true })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split('/').at(-1)!;

  await page.getByRole('button', { name: /Lancer la recherche et l’analyse|Trouver et analyser 10 professionnels/ }).click();
  await expect(page).toHaveURL(/\/campagnes\/lots\//);
  const runId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.goto('/campagnes');
  await expect.poll(async () => (await (await request.get(`/api/campaign-runs/${runId}`)).json()).run.status, { timeout: 45_000 }).toBe('completed');
  const data = await backup(request);
  const candidate = data.campaignData!.candidates.find(item => item.runId === runId && item.company.name === 'Atelier Démo — lot');
  expect(candidate).toBeTruthy();

  await page.goto(`/campagnes/lots/${runId}?candidat=${candidate!.id}`);
  await page.getByRole('button', { name: 'Voir le rapport complet', exact: true }).click();
  await confirmFact(page, 'quote404');
  await openFactSection(page, 'quote404');
  await page.getByTestId('prospect-report').locator('[data-fact-id="quote404"]').getByRole('button', { name: 'Utiliser pour mon approche', exact: true }).click();
  await openContactChoices(page);
  await page.getByRole('checkbox', { name: /contact@atelier-demo.test/ }).check();
  await page.getByRole('button', { name: 'Valider le prospect', exact: true }).click();
  const accepted = await backup(request);
  const qualified = accepted.companies.find(item => item.name === 'Atelier Démo — lot');
  expect(qualified).toBeTruthy();

  await page.goto(`/prospects/${qualified!.id}?campagne=${campaignId}`);
  await answer(page, 'fit', 'Exactement');
  await page.getByRole('checkbox', { name: 'Je confirme cette évaluation par rapport à la cible actuelle.', exact: true }).check();
  await saveQualification(page);

  const readyId = await createCompany(page, campaignId, 'Atelier Contact — audit UX');
  await openCompanyContacts(page);
  await page.getByLabel('Email professionnel', { exact: true }).fill('bonjour@atelier-contact.example');
  await page.getByRole('button', { name: 'Enregistrer la fiche', exact: true }).click();
  await answer(page, 'fit', 'Exactement');
  await page.getByRole('checkbox', { name: 'Je confirme cette évaluation par rapport à la cible actuelle.', exact: true }).check();
  await answer(page, 'problem', 'Un problème concret vérifié');
  await answer(page, 'trigger', 'Aucun déclencheur repéré après recherche');
  await answer(page, 'references', 'Aucune trouvée après vérification');
  await answer(page, 'access', 'Canal professionnel générique de l’entreprise');
  await openQualificationCriterion(page, 'problem');
  await page.getByLabel('Le problème concret constaté', { exact: true }).fill('Le formulaire de contact ne confirme pas l’envoi du message.');
  await page.getByLabel('Date du constat', { exact: true }).fill(parisToday());
  await saveQualification(page);
  await expect(page.getByTestId('qualification-summary')).toContainText('Prêt à contacter');

  return { campaignId, candidateId: candidate!.id, qualifiedId: qualified!.id, readyId };
}

async function measure(page: Page): Promise<Omit<Measurement, 'page' | 'width' | 'screenshot'>> {
  return page.evaluate(() => {
    const selector = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body) {
        const parent: Element | null = current.parentElement;
        const siblings = parent ? Array.from(parent.children).filter(child => child.tagName === current!.tagName) : [];
        const position = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
        parts.unshift(`${current.tagName.toLowerCase()}${position}`);
        current = parent;
      }
      return `body > ${parts.join(' > ')}`;
    };
    const visible = (element: Element): boolean => {
      if (element.closest('[aria-hidden="true"], [hidden], .sr-only, .visually-hidden')) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const smallText: SmallText[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent?.replace(/\s+/g, ' ').trim();
      const parent = node.parentElement;
      if (!text || !parent || !visible(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (!Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) continue;
      const px = Number.parseFloat(getComputedStyle(parent).fontSize);
      if (px < 14) smallText.push({ selector: selector(parent), text: text.slice(0, 120), px: Math.round(px * 100) / 100 });
    }
    const controlSelector = 'a[href], button, summary, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [tabindex]:not([tabindex="-1"])';
    const controls = Array.from(document.querySelectorAll<HTMLElement>(controlSelector)).filter(element => visible(element) && !element.matches(':disabled, [aria-disabled="true"]'));
    const smallTargets: SmallTarget[] = controls.flatMap(element => {
      const rect = element.getBoundingClientRect();
      if (rect.width >= 44 && rect.height >= 44) return [];
      return [{ selector: selector(element), label: (element.getAttribute('aria-label') || element.innerText || element.getAttribute('title') || element.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 100), width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 }];
    });
    return {
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      firstScreenControls: controls.filter(element => { const rect = element.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0 && rect.right > 0 && rect.left < innerWidth; }).length,
      smallText,
      smallTargets,
    };
  });
}

function markdown(rows: Measurement[]): string {
  const escape = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const overflow = rows.filter(row => Math.max(row.bodyScrollWidth, row.documentScrollWidth) > row.viewportWidth);
  const targets = rows.flatMap(row => row.smallTargets.map(item => ({ row, item })));
  const texts = rows.flatMap(row => row.smallText.map(item => ({ row, item })));
  const lines = [
    '# Audit UX — baseline', '',
    `Mesures : ${rows.length} vues, ${new Set(rows.map(row => row.page)).size} pages, largeurs ${widths.join(', ')} px. Hauteur du premier écran : ${viewportHeight} px.`,
    'Les constats ci-dessous sont informatifs : ce test ne fixe aucun seuil bloquant.', '',
    '## Gravité élevée — débordements horizontaux', '',
    overflow.length ? '| Page | Largeur | Débordement | Capture |\n| --- | ---: | ---: | --- |' : 'Aucun débordement horizontal mesuré.',
    ...overflow.map(row => `| ${escape(row.page)} | ${row.width} px | ${Math.max(row.bodyScrollWidth, row.documentScrollWidth) - row.viewportWidth} px | [PNG](${row.screenshot}) |`),
    '', '## Gravité moyenne — cibles interactives inférieures à 44 × 44 px', '',
    targets.length ? '| Page | Largeur | Sélecteur | Libellé | Taille |\n| --- | ---: | --- | --- | ---: |' : 'Aucune cible sous le seuil.',
    ...targets.map(({ row, item }) => `| ${escape(row.page)} | ${row.width} px | \`${escape(item.selector)}\` | ${escape(item.label)} | ${item.width} × ${item.height} px |`),
    '', '## Gravité moyenne — textes visibles inférieurs à 14 px', '',
    texts.length ? '| Page | Largeur | Sélecteur | Texte | Taille |\n| --- | ---: | --- | --- | ---: |' : 'Aucun texte sous le seuil.',
    ...texts.map(({ row, item }) => `| ${escape(row.page)} | ${row.width} px | \`${escape(item.selector)}\` | ${escape(item.text)} | ${item.px} px |`),
    '', '## Information — contrôles visibles au premier écran', '',
    '| Page | Largeur | Contrôles | Capture |', '| --- | ---: | ---: | --- |',
    ...rows.map(row => `| ${escape(row.page)} | ${row.width} px | ${row.firstScreenControls} | [PNG](${row.screenshot}) |`),
    '',
  ];
  return lines.join('\n');
}

test('baseline UX des parcours de prospection', async ({ page, request }) => {
  test.setTimeout(240_000);
  await mkdir(outputDirectory, { recursive: true });
  const baseline = await backup(request);
  const results: Measurement[] = [];
  try {
    const { campaignId, candidateId, qualifiedId, readyId } = await seed(page, request);
    const routes = [
      { name: 'accueil', url: '/' },
      { name: 'campagnes', url: '/campagnes' },
      { name: 'campagne-rechercher', url: `/campagnes/${campaignId}?etape=rechercher` },
      { name: 'campagne-preparer', url: `/campagnes/${campaignId}?etape=preparer&prospect=${readyId}` },
      { name: 'campagne-suivre', url: `/campagnes/${campaignId}?etape=suivre&prospect=${readyId}` },
      { name: 'qualification-liste', url: `/campagnes/${campaignId}/qualification` },
      { name: 'qualification-candidat', url: `/campagnes/${campaignId}/qualification?candidat=${candidateId}` },
      { name: 'prospects', url: '/prospects' },
      { name: 'prospect-qualifie', url: `/prospects/${qualifiedId}?campagne=${campaignId}` },
      { name: 'prospect-pret', url: `/prospects/${readyId}?campagne=${campaignId}` },
      { name: 'apprendre', url: '/apprendre' },
    ];
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of widths) {
      await page.setViewportSize({ width, height: viewportHeight });
      for (const route of routes) {
        await page.goto(route.url);
        await page.locator('h1').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        const screenshot = `${route.name}-${width}.png`;
        await page.screenshot({ path: path.join(outputDirectory, screenshot), fullPage: true, animations: 'disabled' });
        results.push({ page: route.url, width, screenshot, ...await measure(page) });
      }
    }
  } finally {
    await writeFile(path.join(outputDirectory, 'report.md'), markdown(results), 'utf8');
    await restore(page, baseline);
  }
});
