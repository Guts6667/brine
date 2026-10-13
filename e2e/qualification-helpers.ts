import {expect,type Page} from '@playwright/test';

const criteria=['fit','problem','trigger','references','access'];

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
  const form=page.getByTestId('qualification-form');
  if(await form.locator('.qualification-wizard-review').isVisible())await form.getByRole('button',{name:'Précédent',exact:true}).click();
  for(let step=0;step<criteria.length;step++){
    const active=await form.locator('fieldset.qual-question:visible').first().getAttribute('data-testid');
    const current=criteria.indexOf((active||'').replace('qualification-question-',''));
    const target=criteria.indexOf(criterion);
    if(current===target)break;
    await form.getByRole('button',{name:current<target?'Suivant':'Précédent',exact:true}).click();
  }
  await expect(page.getByTestId(`qualification-question-${criterion}`)).toBeVisible();
  const editor = page.getByTestId(`qualification-question-${criterion}`).locator('details.qualification-response-editor');
  if (await editor.getAttribute('open') === null) await editor.locator('summary').first().click();
}

export async function openQualificationReview(page:Page){
  await openQualificationCriterion(page,'access');
  await page.getByTestId('qualification-form').getByRole('button',{name:'Voir le récapitulatif',exact:true}).click();
  await expect(page.getByRole('region',{name:'Récapitulatif des cinq critères'})).toBeVisible();
}

export async function openQualificationEvidence(page:Page){
  await page.getByRole('tab',{name:'Qualifier',exact:true}).click();
  const details=page.locator('details.qualification-evidence');
  if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();
}
