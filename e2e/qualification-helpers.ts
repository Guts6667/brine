import type { Page } from '@playwright/test';

export async function openCompanyInformation(page: Page) {
  await page.getByRole('button', { name: 'Fiche et historique', exact: true }).click();
}

export async function openCompanyContacts(page: Page) {
  await page.getByRole('button', { name: 'Qualifier', exact: true }).click();
  await page.getByRole('combobox', { name: 'Espace de travail', exact: true }).selectOption('contact');
}

export async function openQualificationCriterion(page: Page, criterion: string) {
  await page.getByRole('button', { name: 'Qualifier', exact: true }).click();
  await page.getByRole('combobox', { name: 'Espace de travail', exact: true }).selectOption('qualification');
  await page.getByRole('combobox', { name: 'Critère à vérifier · 5', exact: true }).selectOption(criterion);
  const editor = page.getByTestId(`qualification-question-${criterion}`).locator('details.qualification-response-editor');
  if (await editor.getAttribute('open') === null) await editor.locator('summary').first().click();
}
