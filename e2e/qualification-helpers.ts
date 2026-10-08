import type { Page } from '@playwright/test';

export async function openCompanyInformation(page: Page) {
  await page.getByRole('tab', { name: 'Historique', exact: true }).click();
}

export async function openCompanyContacts(page: Page) {
  await page.getByRole('tab', { name: 'Contacter', exact: true }).click();
  const coordinates = page.locator('details.prospect-contact-section');
  if (await coordinates.getAttribute('open') === null) await coordinates.locator(':scope > summary').click();
}

export async function openQualificationCriterion(page: Page, criterion: string) {
  await page.getByRole('tab', { name: 'Qualifier', exact: true }).click();
  await page.getByRole('combobox', { name: 'Critère à vérifier · 5', exact: true }).selectOption(criterion);
  const editor = page.getByTestId(`qualification-question-${criterion}`).locator('details.qualification-response-editor');
  if (await editor.getAttribute('open') === null) await editor.locator('summary').first().click();
}
