import {expect,type Page} from '@playwright/test';

export async function saveCandidateQualification(page:Page){
  const form=page.getByTestId('qualification-form');
  if(!await form.locator('.qualification-wizard-review').isVisible()){
    for(let step=0;step<5;step++){
      if(await form.getByRole('button',{name:'Voir le récapitulatif',exact:true}).isVisible())break;
      await form.getByRole('button',{name:'Suivant',exact:true}).click();
    }
    await form.getByRole('button',{name:'Voir le récapitulatif',exact:true}).click();
  }
  await expect(form.getByRole('region',{name:'Récapitulatif des cinq critères'})).toBeVisible();
  await form.getByRole('button',{name:'Enregistrer la qualification',exact:true}).click();
  await expect(form.getByRole('status').filter({hasText:/Qualification enregistrée|Brouillon enregistré/})).toBeVisible();
}

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
