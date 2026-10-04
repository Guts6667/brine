import type { Page } from '@playwright/test';

export async function confirmFact(page:Page,factId:string){
  const exact=page.locator(`[data-testid="qualification-finding"][data-fact-id="${factId}"]`).first();
  if(await exact.count()){
    const details=exact.locator('xpath=ancestor::details[1]');
    if(await details.count()&&await details.getAttribute('open')===null)await details.locator(':scope > summary').click();
    const confirm=exact.getByRole('button',{name:'Confirmer le constat',exact:true});
    if(await confirm.count()){await confirm.click();await exact.getByText('Constat confirmé · les points se valident séparément.',{exact:true}).waitFor();}
  }
}

export async function openLegacyInsights(page:Page){
  const details=page.locator('details.review-legacy-details');
  if(await details.count()&&await details.getAttribute('open')===null)await details.locator(':scope > summary').click();
}

/** Full facts remain in their section; opening one section no longer expands the whole dossier. */
export async function openFactSection(page: Page, factId: string) {
  const section = page.locator(`[data-fact-id="${factId}"]`).locator('xpath=ancestor::details[contains(@class,"report-section")][1]');
  if (await section.getAttribute('open') === null) await section.locator('summary').first().click();
}

export async function openContactChoices(page: Page) {
  const details = page.locator('details.review-contact-choices');
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
}
