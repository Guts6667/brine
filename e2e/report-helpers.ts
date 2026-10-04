import type { Page } from '@playwright/test';

/** Full facts remain in their section; opening one section no longer expands the whole dossier. */
export async function openFactSection(page: Page, factId: string) {
  const section = page.locator(`[data-fact-id="${factId}"]`).locator('xpath=ancestor::details[contains(@class,"report-section")][1]');
  if (await section.getAttribute('open') === null) await section.locator('summary').first().click();
}

export async function openContactChoices(page: Page) {
  const details = page.locator('details.review-contact-choices');
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
}
