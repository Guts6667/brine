import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProspectReport } from '../lib/research-report';
import { buildContactDrafts, buildFollowupDraft, buildReplyDraft, createApproachPlan, emptyProviderProfile, evaluateContactReadiness, getEligibleApproachEvidence, validateGeneratedPreparation, validateReportNarrative } from '../lib/contact-preparation';
import { captureTarget, emptyQualification } from '../lib/qualification';
import { contactEventSchema } from '../lib/research-schemas';
import type { Campaign, DiscoveryCandidate } from '../lib/campaign-types';
import type { Company } from '../lib/types';
import type { ContactEvent, ProspectReport } from '../lib/research-types';

const campaign: Campaign = { id: 'campaign', name: 'Lyon', targetCity: 'Lyon', targetBusiness: 'Artisans', targetOffer: 'Améliorations de sites web', activityCodes: '', revision: 2, status: 'active', createdAt: '2026-10-04T12:00:00Z', updatedAt: '2026-10-04T12:00:00Z' };
const profile = { ...emptyProviderProfile(), name: 'Rayan', activity: 'développeur indépendant', services: 'Sites web et corrections ciblées', revision: 1 };
const now = new Date('2026-10-04T12:00:00Z');
function report(): ProspectReport {
  const candidate: DiscoveryCandidate = { id: 'candidate', runId: 'run', companyId: null, status: 'review', website: 'https://atelier.example/', websites: [], revision: 1, attempts: {}, htmlError: '', mobileError: '', mobile: null,
    company: { name: 'Atelier', city: 'Lyon', business: 'Menuiserie', address: '', activityCode: '', siren: '', siret: '', sourceUrl: 'https://atelier.example/' },
    html: { website: 'https://atelier.example/', analyzedOn: '2026-10-04', pages: [{ url: 'https://atelier.example/', title: 'Atelier' }], contacts: [{ kind: 'email', value: 'pro@atelier.example', sourceUrl: 'https://atelier.example/' }], warnings: [], findings: [
      { id: 'broken', key: 'technical', note: 'Le lien « Demander un devis » répond HTTP 404.', sourceUrl: 'https://atelier.example/devis', approach: 'Vérifier cet accès.' },
      { id: 'positive', key: 'mobile', note: 'Une balise viewport est présente dans le HTML. Le rendu sur mobile reste à vérifier visuellement.', sourceUrl: 'https://atelier.example/' },
    ] } };
  return buildProspectReport(candidate, campaign);
}
function company(): Company {
  return { id: 'company', name: 'Atelier', city: 'Lyon', business: 'Menuiserie', website: 'https://atelier.example/', targetFit: 'unknown', problemFound: 'unknown', contactAvailable: 'unknown', observation: '', observedOn: '', proofUrl: '', trigger: '', stage: 'À étudier', archived: false, oppositionActive: false, oppositionDate: '', oppositionNote: '', contact: { email: 'pro@atelier.example', phone: '', formUrl: '', profileUrl: '', name: '', role: '' }, nextAction: null, createdAt: now.toISOString(), updatedAt: now.toISOString(), qualification: emptyQualification() };
}
const event = (outcome: ContactEvent['outcome']): ContactEvent => ({ id: 'event', submittedKey: 'submission', date: '2026-10-04', channel: 'email', outcome, note: '', nextAction: null });

test('plan is grounded in one evidence and proposes a targeted correction rather than automatic redesign', () => {
  const dossier = report(), plan = createApproachPlan(dossier, campaign, profile, ['broken'], now);
  assert.deepEqual(plan.evidenceIds, ['broken']);
  assert.equal(plan.motive, dossier.facts.find(fact => fact.id === 'broken')!.text);
  assert.match(plan.hypothesis, /si le défaut se reproduit/);
  assert.match(plan.help, /correction ciblée/);
  assert.doesNotMatch(plan.help, /refonte/);
  assert.match(plan.question, /Quel canal/);
  assert.ok(plan.rationale && plan.nextStep && plan.offer);
});
test('a satisfactory metric alone does not create a fabricated commercial motive', () => {
  assert.throws(() => createApproachPlan(report(), campaign, profile, ['positive']), /Aucun motif pertinent/);
  assert.throws(() => createApproachPlan(report(), { ...campaign, targetOffer: '' }, emptyProviderProfile(), ['broken']), /offre réelle/);
  assert.throws(() => createApproachPlan(report(), { ...campaign, targetOffer: 'Formation en comptabilité' }, emptyProviderProfile(), ['broken']), /Aucun motif pertinent/);
});
test('hypotheses, corrected facts and invented evidence cannot become the motive', () => {
  const dossier = report(); dossier.facts.find(fact => fact.id === 'broken')!.corrected = true;
  assert.throws(() => createApproachPlan(dossier, campaign, profile, ['broken']), /constat sourcé/);
  assert.throws(() => createApproachPlan(dossier, campaign, profile, ['invented']), /constat sourcé/);
  dossier.facts.find(fact => fact.id === 'broken')!.corrected = false;
  dossier.facts.find(fact => fact.id === 'broken')!.kind = 'hypothesis';
  assert.throws(() => createApproachPlan(dossier, campaign, profile, ['broken']), /hypothèse/);
});
test('email and call use explicit structure, one opening question and progressive listening branches', () => {
  const dossier = report(), plan = createApproachPlan(dossier, campaign, profile, ['broken'], now), drafts = buildContactDrafts(plan, dossier, profile, { now });
  const email = drafts.find(draft => draft.channel === 'email')!, call = drafts.find(draft => draft.channel === 'call')!;
  assert.equal((email.text.match(/\?/g) || []).length, 1);
  assert.match(email.text, /Rayan, développeur indépendant/);
  assert.doesNotMatch(email.text, /audit gratuit|maquette|garanti|retour sur investissement/);
  assert.ok(call.blocks.some(block => block.label === 'Écouter et reformuler'));
  assert.ok(call.blocks.some(block => block.label === 'Conséquence vécue'));
  assert.ok(call.blocks.some(block => block.label === 'Déjà pris en charge'));
  assert.ok(call.blocks.some(block => block.label === 'Refus'));
  assert.equal(validateGeneratedPreparation(plan, drafts, dossier, profile), true);
});
test('recorded conversation drafts quote actual notes and no-response followups never claim an exchange', () => {
  const dossier = report(), plan = createApproachPlan(dossier, campaign, profile, ['broken'], now);
  const conversation = { ...event('conversation'), note: 'Nous recevons surtout les demandes par téléphone.' };
  const reply = buildReplyDraft(plan, dossier, profile, conversation, now);
  assert.match(reply.text, /Nous recevons surtout les demandes par téléphone/);
  assert.throws(() => buildReplyDraft(plan, dossier, profile, event('conversation')), /propos de l’échange/);
  const followup = buildFollowupDraft(plan, dossier, profile, event('no_response'), now);
  assert.match(followup.text, /mon message/);
  assert.doesNotMatch(followup.text, /notre échange|notre conversation/);
  assert.throws(() => buildFollowupDraft(plan, dossier, profile, conversation), /sans réponse/);
});
test('stale plan and changed evidence require revalidation before drafting', () => {
  const dossier = report(), plan = createApproachPlan(dossier, campaign, profile, ['broken'], now);
  assert.throws(() => buildContactDrafts({ ...plan, reportId: 'old' }, dossier, profile), /revalidez/);
  assert.throws(() => buildContactDrafts({ ...plan, revalidateReason: 'Observation corrigée' }, dossier, profile), /revalidez/);
});
test('three manual checks allow first contact without the five old commercial criteria', () => {
  const c = company(), dossier = report();
  c.readiness = { target: true, reason: true, channel: true, evidenceIds: ['broken'], channelKind: 'email', confirmedAt: now.toISOString(), targetRevision: campaign.revision, reportId: dossier.id };
  const result = evaluateContactReadiness(c, campaign, dossier, '2026-10-04');
  assert.equal(result.ready, true); assert.equal(result.firstContact, true); assert.equal(result.legacy, false);
  c.contactEvents = [event('no_response')];
  assert.equal(evaluateContactReadiness(c, campaign, dossier).firstContact, false);
});
test('opposition, campaign/report changes, missing channel and correction block readiness', () => {
  const c = company(), dossier = report();
  c.readiness = { target: true, reason: true, channel: true, evidenceIds: ['broken'], channelKind: 'email', confirmedAt: now.toISOString(), targetRevision: campaign.revision, reportId: dossier.id };
  c.oppositionActive = true; assert.equal(evaluateContactReadiness(c, campaign, dossier).ready, false);
  c.oppositionActive = false; assert.equal(evaluateContactReadiness(c, { ...campaign, revision: 3 }, dossier).stale, true);
  assert.equal(evaluateContactReadiness(c, campaign, { ...dossier, id: 'new' }).ready, false);
  c.contact.email = ''; assert.equal(evaluateContactReadiness(c, campaign, dossier).ready, false);
  c.contact.email = 'pro@atelier.example'; dossier.facts.find(fact => fact.id === 'broken')!.corrected = true;
  assert.equal(evaluateContactReadiness(c, campaign, dossier).ready, false);
  c.stage = 'En échange'; assert.equal(evaluateContactReadiness(c, campaign, dossier).firstContact, false);
});
test('legacy complete qualification stays usable when target and professional channel remain valid', () => {
  const c = company(), q = c.qualification!; q.targetSnapshot = captureTarget(campaign);
  q.answers.fit = { answer: 'exact', note: 'Artisan Lyon', observationKeys: [] };
  q.answers.problem = { ...q.answers.problem, answer: 'one', description: 'Lien devis 404', observedOn: '2026-10-04', proofUrl: 'https://atelier.example/devis' };
  q.answers.trigger.answer = 'none'; q.answers.references.answer = 'none'; q.answers.access.answer = 'generic';
  assert.equal(evaluateContactReadiness(c, campaign, null, '2026-10-04').ready, true);
  assert.equal(evaluateContactReadiness(c, { ...campaign, targetCity: 'Paris' }, null, '2026-10-04').ready, false);
});
test('generated narratives and preparations reject unknown numbers, addresses and promises', () => {
  const dossier = report(), plan = createApproachPlan(dossier, campaign, profile, ['broken'], now), drafts = buildContactDrafts(plan, dossier, profile, { now });
  assert.equal(validateReportNarrative('La page de devis répond HTTP 404.', dossier), true);
  assert.equal(validateReportNarrative('85 clients perdus.', dossier), false);
  assert.equal(validateReportNarrative('Contactez invente@autre.example.', dossier), false);
  const changed = structuredClone(drafts); changed[0].text += '\nUn audit gratuit vous garantit 80 clients.';
  assert.equal(validateGeneratedPreparation(plan, changed, dossier, profile), false);
  assert.equal(validateGeneratedPreparation({ ...plan, motive: 'Besoin urgent inventé' }, drafts, dossier, profile), false);
});
test('an HTTP 404 cannot authorize a 404 euro offer, and known references cannot authorize Nike', () => {
  const dossier = report(), plan = createApproachPlan(dossier, campaign, profile, ['broken'], now), drafts = buildContactDrafts(plan, dossier, profile, { now });
  const price = structuredClone(drafts); price[0].text += '\nCette correction coûte 404 €.';
  assert.equal(validateGeneratedPreparation(plan, price, dossier, profile), false);
  const titlePrice = structuredClone(drafts); titlePrice[0].subject = 'Correction pour 404 €';
  assert.equal(validateGeneratedPreparation(plan, titlePrice, dossier, profile), false);
  const knownReferences = { ...profile, references: 'Projet de site web pour ABC' };
  const nike = structuredClone(drafts); nike[0].text += '\nJ’ai travaillé pour Nike.';
  assert.equal(validateGeneratedPreparation(plan, nike, dossier, knownReferences), false);
});
test('contact event schema requires a real calendar date and a dated next action', () => {
  assert.equal(contactEventSchema.safeParse({ ...event('conversation'), date: '2026-02-31' }).success, false);
  assert.equal(contactEventSchema.safeParse({ ...event('callback'), nextAction: { text: 'Rappeler', date: '' } }).success, false);
});
test('long presentation is quoted as a bounded literal excerpt while the full dossier and motive remain intact', () => {
  const dossier = report(), sourceId = dossier.sources[0].id;
  const fullText = 'Nos prestations de menuiserie pour les particuliers à Lyon. ' + 'Nous présentons la fabrication de meubles, les agencements et les projets réalisés dans notre atelier. '.repeat(12);
  dossier.facts.push({ id: 'long-presentation', section: 'presentation', kind: 'reported', sentiment: 'neutral', text: fullText, sourceIds: [sourceId], observedOn: '2026-10-04', scope: 'Déclaration publique.' });
  const plan = createApproachPlan(dossier, campaign, profile, ['long-presentation'], now), email = buildContactDrafts(plan, dossier, profile, { now }).find(draft => draft.channel === 'email')!;
  assert.match(email.text, /cet extrait/);
  assert.ok(email.text.includes('…'));
  assert.ok(email.text.trim().split(/\s+/).length <= 160);
  assert.equal((email.text.match(/\?/g) || []).length, 1);
  assert.equal(plan.motive, fullText);
  assert.equal(dossier.facts.find(fact => fact.id === 'long-presentation')!.text, fullText);
});
test('an announcement of existing services is a presentation opportunity without an invented dated change', () => {
  const dossier = report(), sourceId = dossier.sources[0].id;
  const text = 'La présentation annonce des interventions pour les particuliers.';
  dossier.facts.push({ id: 'services-announcement', section: 'fit', kind: 'reported', sentiment: 'neutral', text, sourceIds: [sourceId], observedOn: '2026-10-04', scope: 'Prestations déclarées sur le site.' });
  const plan = createApproachPlan(dossier, campaign, profile, ['services-announcement'], now);
  assert.equal(plan.motive, text);
  assert.match(plan.help, /présenter ces prestations ou réalisations/);
  assert.doesNotMatch(plan.hypothesis + plan.question, /changement documenté|cette évolution/);
  const email = buildContactDrafts(plan, dossier, profile, { now }).find(draft => draft.channel === 'email')!;
  assert.match(email.text, /proposer d’examiner avec vous/);
  assert.doesNotMatch(email.text, /proposer de examiner/);
});
test('a change motive requires an explicit event and its public date, rather than a consultation date', () => {
  const dossier = report(), sourceId = dossier.sources[0].id;
  dossier.facts.push({ id: 'dated-opening', section: 'presentation', kind: 'reported', sentiment: 'neutral', text: 'Ouverture du nouvel atelier le 12 octobre 2026.', sourceIds: [sourceId], observedOn: '2026-10-04', scope: 'Événement déclaré sur le site.' });
  const dated = createApproachPlan(dossier, campaign, profile, ['dated-opening'], now);
  assert.match(dated.hypothesis, /Ce changement documenté/);
  dossier.facts.push({ id: 'undated-opening', section: 'presentation', kind: 'reported', sentiment: 'neutral', text: 'Ouverture du nouvel atelier.', sourceIds: [sourceId], observedOn: '2026-10-04', scope: 'Date de l’événement inconnue.' });
  const undated = createApproachPlan(dossier, campaign, profile, ['undated-opening'], now);
  assert.doesNotMatch(undated.hypothesis + undated.question, /changement documenté|cette évolution/);
  const consonant = buildContactDrafts(createApproachPlan(dossier, campaign, profile, ['broken'], now), dossier, profile, { now })[0];
  assert.match(consonant.text, /proposer de vérifier cet accès/);
});
test('a personally worded help sentence passes into the email intact without a second introduction', () => {
  const dossier = report(), initial = createApproachPlan(dossier, campaign, profile, ['broken'], now);
  for (const help of ['Je peux vous aider à vérifier le parcours de demande de devis.', 'J’examine avec vous cet accès si vous le souhaitez.', 'Nous pouvons vérifier ensemble cet accès.']) {
    const plan = { ...initial, help }, drafts = buildContactDrafts(plan, dossier, profile, { now }), email = drafts.find(draft => draft.channel === 'email')!;
    assert.equal(email.blocks.find(block => block.label === 'Aide proportionnée')!.text, help);
    assert.doesNotMatch(email.text, /proposer de je|proposer de j’|proposer de nous/i);
    assert.equal((email.text.match(/\?/g) || []).length, 1);
    assert.deepEqual(plan.evidenceIds, ['broken']);
    assert.equal(plan.motive, dossier.facts.find(fact => fact.id === 'broken')!.text);
  }
  const emptyHelp = { ...initial, help: '   ' }, email = buildContactDrafts(emptyHelp, dossier, profile, { now }).find(draft => draft.channel === 'email')!;
  assert.equal(email.blocks.find(block => block.label === 'Aide proportionnée')!.text, '');
  assert.doesNotMatch(email.text, /Je peux vous proposer|Je peux vous aider|promets|garantis/);
  assert.ok(email.text.includes(initial.motive));
  assert.ok(email.text.includes(initial.question));
  assert.equal((email.text.match(/\?/g) || []).length, 1);
  assert.deepEqual(emptyHelp.evidenceIds, initial.evidenceIds);
});
test('eligible evidence excludes incompatible, hypothetical, corrected and unsourced facts with stable ordering', () => {
  const dossier = report(), sourceId = dossier.sources[0].id;
  const base = { section: 'presentation' as const, kind: 'reported' as const, sentiment: 'neutral' as const, sourceIds: [sourceId], observedOn: '2026-10-04', scope: 'Déclaration publique.' };
  dossier.facts.push(
    { ...base, id: 'presentation-a', text: 'Prestations pour les particuliers.' },
    { ...base, id: 'presentation-b', text: 'Réalisations présentées dans une galerie.' },
    { ...base, id: 'corrected-presentation', text: 'Déclaration corrigée.', corrected: true },
    { ...base, id: 'hypothesis-presentation', text: 'Il serait peut-être utile de refaire le site.', kind: 'hypothesis' },
    { ...base, id: 'orphan-presentation', text: 'Déclaration sans source disponible.', sourceIds: ['missing-source'] },
    { ...base, id: 'declared-need', section: 'fit', text: 'Besoin exprimé : préciser le parcours de demande de devis.' },
    { ...base, id: 'dated-change', text: 'Nouvelle activité de restauration de meubles depuis septembre 2026.' },
  );
  const eligible = getEligibleApproachEvidence(dossier, campaign, profile), ids = eligible.map(fact => fact.id);
  assert.equal(ids[0], 'declared-need');
  assert.equal(ids[1], 'broken');
  assert.equal(ids[2], 'dated-change');
  assert.ok(ids.indexOf('presentation-a') < ids.indexOf('presentation-b'));
  for (const id of ['positive', 'corrected-presentation', 'hypothesis-presentation', 'orphan-presentation']) assert.ok(!ids.includes(id));
  assert.deepEqual(getEligibleApproachEvidence(dossier, campaign, profile).map(fact => fact.id), ids);
  for (const fact of eligible) assert.doesNotThrow(() => createApproachPlan(dossier, campaign, profile, [fact.id], now));
  assert.deepEqual(getEligibleApproachEvidence(dossier, { ...campaign, targetOffer: 'Formation en comptabilité' }, emptyProviderProfile()), []);
  const plan = createApproachPlan(dossier, campaign, profile, ['broken'], now);
  assert.ok(plan.alternatives?.every(alternative => alternative.evidenceIds.every(id => ids.includes(id))));
});
