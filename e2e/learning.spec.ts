import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import type { Backup } from '../lib/types';
import { emptyLearningProgress } from '../lib/learning-schema';
import { CRITERION_EXPECTED, CRITERION_ORDER, EMAIL_CHECKS, FOLLOWUP_QUESTIONS, OCCASION_QUESTIONS } from '../lib/learning-exercises';
const read = async (request: APIRequestContext): Promise<Backup> => (await request.get('/api/backup')).json();
function business(backup: Backup) { const {exportedAt: _time, campaignData, ...rest}=backup; const {learningProgress: _learning, ...campaigns}=campaignData!; return {...rest,campaignData:campaigns}; }
async function restore(page: Page, backup: Backup) {
  await page.goto('/sauvegarde');
  await page.getByLabel('Sauvegarde Brine ZIP ou ancien fichier JSON',{exact:true}).setInputFiles({name:'baseline.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.getByRole('button',{name:'Vérifier le fichier',exact:true}).click();
  await page.getByRole('checkbox',{name:'Je confirme le remplacement des données par cette sauvegarde.',exact:true}).check();
  await page.getByRole('button',{name:'Confirmer la restauration',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Restauration terminée.'})).toBeVisible();
}
async function practice(page: Page, moduleId: string) {
  await page.goto('/apprendre/'+moduleId);
  await page.getByRole('button',{name:'Voir un exemple',exact:true}).click();
  await page.getByRole('button',{name:'Essayer',exact:true}).click();
  await expect(page.getByRole('heading',{name:'À vous d’essayer.',exact:true})).toBeVisible();
}
async function complete(page: Page) {
  await page.getByRole('button',{name:'Faire le point',exact:true}).click();
  await page.getByRole('button',{name:'Terminer le module',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Appliquer à votre campagne.',exact:true})).toBeVisible();
}
for (const width of [1280,390]) test(`six modules, reprise et guide sans altération des prospects à ${width}px`,async({page,request})=>{
  test.setTimeout(240000); await page.context().grantPermissions(['clipboard-read','clipboard-write']); await page.setViewportSize({width,height:900}); const baseline=await read(request);
  const clean={...baseline,campaignData:{...baseline.campaignData!,learningProgress:emptyLearningProgress()}};
  await restore(page,clean); const before=await read(request); const campaignId=before.campaignData!.campaigns[0].id;
  try {
    await page.goto('/'); await page.getByRole('link',{name:'Découvrir le parcours',exact:true}).click();
    await expect(page.getByRole('progressbar',{name:'Modules terminés'})).toHaveAttribute('aria-valuenow','0');
    await page.getByRole('link',{name:'Commencer',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Choisir une cible précise',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Voir un exemple',exact:true}).click();await page.getByRole('button',{name:'Essayer',exact:true}).click();
    await page.locator('input[type=radio][value=all]').check();await expect(page.getByRole('button',{name:'Faire le point',exact:true})).toBeDisabled();
    await page.locator('input[type=radio][value=precise]').focus();await page.keyboard.press('Space');await complete(page);
    await page.getByRole('link',{name:'Module suivant',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Repérer une occasion d’aider',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Voir un exemple',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Voir un exemple',exact:true}).click();await page.getByRole('button',{name:'Essayer',exact:true}).click();
    for (let i=0;i<OCCASION_QUESTIONS.length;i++) {await page.locator(`input[type=radio][value="${OCCASION_QUESTIONS[i].correct}"]`).check();if(i<2)await page.getByRole('button',{name:'Entreprise suivante',exact:true}).click();}
    await complete(page);
    await practice(page,'qualification');const score=page.getByTestId('learning-qualification-score');await expect(score).toContainText('0/100');
    await page.getByRole('button',{name:'Confirmer le constat',exact:true}).click();await expect(score).toContainText('0/100');await expect(score).toContainText('0/5');
    await page.getByRole('button',{name:'Passer aux critères',exact:true}).click();
    for (let i=0;i<CRITERION_ORDER.length;i++) {const key=CRITERION_ORDER[i];await page.locator(`input[name="criterion-${key}"][value="${CRITERION_EXPECTED[key]}"]`).check();await page.getByRole('button',{name:'Accepter la réponse et ses points',exact:true}).click();
      if(i===1){await expect(score).toContainText('35/100');await expect(score).toContainText('2/5');}
      await page.getByRole('button',{name:i===4?'Qualifier ce prospect':'Critère suivant',exact:true}).click();
    }
    await expect(score).toContainText('55/100');await expect(score).toContainText('5/5');await page.getByRole('radio',{name:'Garder pour plus tard',exact:true}).check();await complete(page);
    await practice(page,'email');await page.locator('input[type=radio][value=useful]').check();await page.getByRole('button',{name:'Préparer mon email d’essai',exact:true}).click();
    const draft='Bonjour, je suis Rayan de Pickles Studio. Dans votre galerie mobile, le bouton masque une photo. Je peux vous partager deux pistes ciblées. Est-ce vous qui gérez le site ?';
    await page.getByLabel('Votre premier email',{exact:true}).fill(draft);
    await page.getByRole('link',{name:'Le parcours',exact:true}).click();
    await expect.poll(async()=>(await read(request)).campaignData!.learningProgress?.answers.email?.emailText).toBe(draft);
    await page.getByRole('link',{name:'Reprendre',exact:true}).click();await expect(page.getByLabel('Votre premier email',{exact:true})).toHaveValue(draft);
    for(const item of EMAIL_CHECKS)await page.getByRole('checkbox',{name:item.label,exact:true}).check();
    await page.getByRole('button',{name:'Copier cet email d’essai',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Aucun contact'})).toBeVisible();
    await page.getByText('Un bilan PDF en complément, si utile',{exact:true}).click();const pdf=await request.get('/api/learning/example-brief');expect(pdf.headers()['x-brine-learning-example']).toBe('fictional');expect((await PDFDocument.load(await pdf.body())).getPageCount()).toBe(2);
    await complete(page);
    await page.getByLabel('Ma campagne',{exact:true}).selectOption(campaignId);await page.getByRole('button',{name:'Appliquer à ma campagne',exact:true}).click();await expect(page).toHaveURL(new RegExp('/campagnes/'+campaignId+'\\?etape=preparer&guide=email'));
    await practice(page,'suivi');for(let i=0;i<FOLLOWUP_QUESTIONS.length;i++){await page.locator(`input[type=radio][value="${FOLLOWUP_QUESTIONS[i].correct}"]`).check();if(i<4)await page.getByRole('button',{name:'Situation suivante',exact:true}).click();}await complete(page);
    await practice(page,'echange');await page.locator('input[type=radio][value=open]').check();await page.getByRole('button',{name:'Écouter la réponse fictive',exact:true}).click();
    for(const label of [/Besoin confirmé/,/Intervention pertinente/,/Chemin de décision/,/Prochaine étape acceptée/,/Budget : non abordé/])await page.getByRole('checkbox',{name:label}).check();
    await page.getByLabel('Reformulez le besoin et la suite en une ou deux phrases.',{exact:true}).fill('Vous souhaitez améliorer la lecture mobile de la galerie. Je vous envoie les deux pistes convenues.');await page.getByRole('checkbox',{name:/J’ai relu : ma reformulation/}).check();await complete(page);
    await page.goto('/apprendre');await expect(page.getByRole('progressbar',{name:'Modules terminés'})).toHaveAttribute('aria-valuenow','6');
    let after=await read(request);expect(after.campaignData!.learningProgress!.mission.recordedContact).toBe(false);expect(business(after)).toEqual(business(before));
    await page.goto(`/campagnes/${campaignId}?etape=rechercher`);await page.getByText('Ma cible et spécialisation de campagne',{exact:true}).click();
    const field=page.getByLabel('Mots clés de recherche',{exact:true});await field.fill('Mon brouillon non enregistré');await field.evaluate(el=>el.setAttribute('data-learning-preserved','yes'));
    const guide=page.getByRole('complementary',{name:'Guide de campagne'});const open=guide.getByRole('button',{name:'Me guider',exact:true});if(await open.isVisible())await open.click();
    await expect(guide.getByText('LA PROCHAINE ACTION',{exact:true})).toBeVisible();await expect(field).toHaveValue('Mon brouillon non enregistré');await expect(field).toHaveAttribute('data-learning-preserved','yes');
    await guide.getByRole('button',{name:'Fermer le guide',exact:true}).click();await expect(field).toHaveValue('Mon brouillon non enregistré');await expect(field).toHaveAttribute('data-learning-preserved','yes');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    after=await read(request);expect(business(after)).toEqual(business(before));
    await page.goto('/');await page.getByRole('button',{name:'Plus tard',exact:true}).click();await expect(page.getByRole('region',{name:'Apprendre à prospecter',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Apprendre',exact:true})).toBeVisible();
  } finally {await restore(page,{...baseline,campaignData:{...baseline.campaignData!,learningProgress:baseline.campaignData?.learningProgress||emptyLearningProgress()}});}
});

for (const width of [1280,1920,390]) test(`le module après échange mène aux informations réelles dans la campagne, sans changer automatiquement le statut à ${width}px`, async ({page,request}) => {
  test.setTimeout(120000);
  await page.setViewportSize({width,height:900});
  const baseline=await read(request),campaignId=baseline.campaignData!.campaigns[0].id;
  try {
    await page.goto(`/campagnes/${campaignId}?etape=suivre`);
    await page.getByRole('button',{name:'Ajouter un prospect',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByLabel('Nom du prospect',{exact:false}).fill('Atelier essai après échange');await dialog.getByRole('button',{name:'Créer le prospect',exact:true}).click();
    await expect(page).toHaveURL(/\/prospects\//);const companyId=new URL(page.url()).pathname.split('/').at(-1)!;
    await page.goto(`/campagnes/${campaignId}?etape=suivre&prospect=${companyId}&guide=echange`);
    const form=page.getByTestId('after-exchange-form');await expect(form).toBeVisible();
    await form.getByLabel('Besoin reconnu',{exact:true}).selectOption('confirmed');await form.getByLabel('Les propos du prospect sur son besoin',{exact:true}).fill('La galerie est difficile à lire sur téléphone.');
    await form.getByLabel('Intervention envisagée',{exact:true}).selectOption('targeted_improvement');await form.getByLabel('Adéquation de la solution au besoin',{exact:true}).selectOption('confirmed');await form.getByLabel('Pourquoi cette solution répond au besoin',{exact:true}).fill('Améliorer la lecture de la galerie, conformément à la demande.');
    await form.getByLabel('Décision',{exact:true}).selectOption('identified');await form.getByLabel('Personne ou chemin de décision',{exact:true}).fill('L’interlocutrice gère le site.');await form.getByLabel('Description de l’étape convenue',{exact:true}).fill('Partager deux pistes, à lire vendredi.');await form.getByRole('checkbox',{name:'Cette étape a été explicitement acceptée par l’interlocuteur.',exact:true}).check();
    const field=form.getByLabel('Les propos du prospect sur son besoin',{exact:true});await field.evaluate(el=>el.setAttribute('data-learning-preserved','yes'));
    const guide=page.getByRole('complementary',{name:'Guide de campagne'});const open=guide.getByRole('button',{name:'Me guider',exact:true});if(await open.isVisible())await open.click();await guide.getByRole('button',{name:'Fermer le guide',exact:true}).click({timeout:10000});await expect(field).toHaveAttribute('data-learning-preserved','yes');
    await form.getByRole('button',{name:'Enregistrer après l’échange',exact:true}).click();await expect(form.getByRole('status')).toContainText('Échange enregistré');
    const data=await read(request),p=data.campaignData!.participations.find(p=>p.companyId===companyId&&p.campaignId===campaignId)!;
    expect(p.qualification.afterExchange.need).toBe('confirmed');expect(p.qualification.afterExchange.budget).toBe('not_discussed');expect(p.stage).toBe('À étudier');expect(p.contactEvents||[]).toHaveLength(0);
    await expect(page.getByRole('button',{name:'Passer à Opportunité qualifiée',exact:true})).toBeEnabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  } finally {await restore(page,{...baseline,campaignData:{...baseline.campaignData!,learningProgress:baseline.campaignData?.learningProgress||emptyLearningProgress()}});}
});
