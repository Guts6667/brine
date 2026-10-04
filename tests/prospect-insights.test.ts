import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProspectInsights } from '../lib/prospect-insights';
import { emptyProviderProfile } from '../lib/contact-preparation';
import type { Campaign } from '../lib/campaign-types';
import type { ProspectReport, ResearchFact, ResearchSource } from '../lib/research-types';

const campaign: Campaign = { id: 'campaign', name: 'Artisans Montpellier', targetCity: 'Montpellier', targetBusiness: 'Rénovation', targetOffer: 'Corrections ciblées de sites et interfaces web', activityCodes: '', revision: 4, status: 'active', createdAt: '2026-10-04T12:00:00Z', updatedAt: '2026-10-04T12:00:00Z' };
const profile = { ...emptyProviderProfile(), name: 'Rayan', activity: 'Développeur indépendant', services: 'Sites web, interfaces et corrections', revision: 2 };
const source: ResearchSource = { id: 'site-source', provider: 'website', url: 'https://artisan.example/', title: 'Page de réalisations consultée', excerpt: '', collectedAt: '2026-10-04T12:00:00Z' };
const fact = (id: string, text: string, overrides: Partial<ResearchFact> = {}): ResearchFact => ({ id, section: 'site', kind: 'observed', sentiment: 'issue', text, sourceIds: [source.id], observedOn: '2026-10-04', scope: 'Vérification visuelle dans un navigateur, écran 1440 px ; aucune action de contact réalisée.', ...overrides });
const report = (facts: ResearchFact[] = []): ProspectReport => ({ version: 1, id: 'report', generatedAt: '2026-10-04T12:00:00Z', companyName: 'Sésam Rénovation', summary: 'Ancienne synthèse du lot', sources: [source], facts, contacts: [], profiles: [], sections: [], warnings: [], coverage: [], opportunities: [] });
const identity = { name: 'Sésam Rénovation', city: 'Montpellier', business: 'Rénovation', website: 'https://artisan.example/' };

test('a concrete portfolio obstruction is prioritized with a conditional usage impact and targeted correction', () => {
  const dossier = report([
    fact('declared', 'L’entreprise présente ses prestations de rénovation et des réalisations.', { section: 'presentation', kind: 'reported', sentiment: 'neutral' }),
    fact('visual', 'Dans « Avant / après », le bouton « Comparer » recouvre une grande partie des photos de réalisations.'),
    fact('speed', 'Le LCP simulé atteint 5200 ms dans ce test de laboratoire.'),
  ]);
  const result = buildProspectInsights(dossier, campaign, profile, identity);
  const insight = result.highlights[0];
  assert.equal(insight.category, 'visual');
  assert.equal(insight.title, 'Un élément gêne la lecture des réalisations');
  assert.equal(insight.confidence, 'observed');
  assert.equal(insight.priority, 'high');
  assert.match(insight.possibleEffect!, /Si ce rendu se reproduit/);
  assert.match(insight.possibleEffect!, /finition incomplète/);
  assert.match(insight.proportionateHelp!, /corriger|correction/);
  assert.doesNotMatch(insight.proportionateHelp!, /refonte|revenu|clients|gratuit|garanti/);
  assert.deepEqual(insight.evidenceIds, ['visual']);
  assert.equal(insight.sources[0].url, source.url);
  assert.equal(insight.observedOn, '2026-10-04');
  assert.match(insight.scope, /1440/);
  assert.equal(result.identity.name, identity.name);
  assert.equal(result.identity.activity, identity.business);
  assert.equal(result.identity.location, identity.city);
  assert.equal(result.identity.website, identity.website);
  assert.ok(result.unknowns.some(item => /besoin et leur priorité/.test(item)));
  assert.ok(!result.unknowns.some(item => /rendu visuel.*reste à vérifier/.test(item)));
});

test('a failing quote link ranks before public declarations and preserves the narrowly scoped help', () => {
  const result = buildProspectInsights(report([
    fact('services', 'Prestations : rénovation de cuisines et salles de bain.', { section: 'presentation', kind: 'reported', sentiment: 'neutral' }),
    fact('404', 'Le lien « Demander un devis » répond HTTP 404.', { section: 'contact' }),
  ]), campaign, profile, identity);
  assert.equal(result.highlights[0].category, 'contact_access');
  assert.equal(result.highlights[0].eligibleForApproach, true);
  assert.match(result.highlights[0].possibleEffect!, /autres canaux|impact réel/);
  assert.match(result.highlights[0].proportionateHelp!, /correction ciblée/);
  assert.equal(result.nextAction.kind, 'review_finding');
  assert.doesNotMatch(JSON.stringify(result), /perte de chiffre|audit gratuit|budget disponible/);
});

test('missing offer is an explicit next step and never an absence-of-opportunity verdict', () => {
  const dossier = report([fact('broken', 'Le lien « Demander un devis » répond HTTP 404.')]);
  dossier.opportunities = [{ version: 1, method: 'conversation-v1', id: 'obsolete', reportId: dossier.id, evidenceIds: ['broken'], motive: 'Offre ancienne', rationale: '', hypothesis: '', help: 'Refondre tout le site', question: '', nextStep: '', offer: 'ancienne offre', createdAt: dossier.generatedAt }];
  const result = buildProspectInsights(dossier, { ...campaign, targetOffer: '' }, emptyProviderProfile(), identity);
  assert.equal(result.offer.status, 'missing');
  assert.equal(result.nextAction.kind, 'complete_offer');
  assert.equal(result.nextAction.label, 'Préciser mon offre');
  assert.match(result.offer.message, /Votre offre n’est pas renseignée/);
  assert.doesNotMatch(JSON.stringify(result), /aucune aide pertinente|Refondre tout le site/);
  assert.equal(result.highlights[0].proportionateHelp, null);
  assert.equal(result.highlights[0].eligibleForApproach, false);
});

test('changing the current offer recomputes eligibility without relying on the old lot narrative or opportunities', () => {
  const dossier = report([fact('broken', 'Le lien « Demander un devis » répond HTTP 404.')]);
  const missing = buildProspectInsights(dossier, { ...campaign, targetOffer: '' }, emptyProviderProfile(), identity);
  const filled = buildProspectInsights(dossier, campaign, emptyProviderProfile(), identity);
  const unrelated = buildProspectInsights(dossier, { ...campaign, targetOffer: 'Formation en comptabilité' }, emptyProviderProfile(), identity);
  assert.equal(missing.offer.status, 'missing');
  assert.equal(filled.offer.status, 'ready');
  assert.equal(filled.highlights[0].eligibleForApproach, true);
  assert.equal(unrelated.offer.status, 'unrelated');
  assert.equal(unrelated.highlights[0].eligibleForApproach, false);
  assert.equal(unrelated.highlights[0].proportionateHelp, null);
});

test('raw addresses, discovered actions, satisfactory metadata and generic score do not become commercial motives', () => {
  const dossier = report([
    fact('mail', 'Email : pro@artisan.example', { section: 'contact', kind: 'reported', sentiment: 'positive' }),
    fact('phone', 'Téléphone : 04 67 00 00 00', { section: 'contact', kind: 'reported', sentiment: 'positive' }),
    fact('link', 'Lien d’action détecté : « Contact » vers https://artisan.example/contact', { section: 'contact', sentiment: 'positive' }),
    fact('viewport', 'Une balise viewport est présente dans le HTML. Le rendu mobile reste à vérifier visuellement.', { sentiment: 'positive', scope: 'HTML public consulté, sans exécution JavaScript.' }),
    fact('score', 'Performance : 45/100 ; SEO : 80/100.', { sentiment: 'neutral' }),
    fact('taste', 'Le site est daté et semble peu professionnel.'),
  ]);
  dossier.contacts = [{ kind: 'email', value: 'pro@artisan.example', sourceUrl: source.url, sourceId: source.id }];
  const result = buildProspectInsights(dossier, campaign, profile, identity);
  assert.equal(result.highlights.length, 0);
  assert.equal(result.otherInsights.length, 0);
  assert.equal(result.identity.contacts[0].value, 'pro@artisan.example');
  assert.equal(result.nextAction.kind, 'inspect_site');
  assert.equal(result.totalFacts, 6);
});

test('social-only presence keeps real channels and never generates a fictitious site audit', () => {
  const dossier = report([fact('instagram', 'Profil public identifié : https://www.instagram.com/atelier', { section: 'presence', kind: 'reported', sentiment: 'neutral' })]);
  dossier.profiles = ['https://www.instagram.com/atelier'];
  dossier.contacts = [{ kind: 'profileUrl', value: dossier.profiles[0], sourceUrl: dossier.profiles[0] }];
  const result = buildProspectInsights(dossier, campaign, profile, { ...identity, website: '' });
  assert.equal(result.identity.website, '');
  assert.equal(result.identity.profiles[0], dossier.profiles[0]);
  assert.equal(result.highlights.length, 0);
  assert.equal(result.nextAction.kind, 'discover_need');
  assert.ok(result.unknowns.some(item => /aucun site n’a été confirmé/.test(item)));
  assert.doesNotMatch(JSON.stringify(result), /site inexistant|manque de clients|mauvais rendu|refonte/);
});

test('a positive presentation is useful context without inventing an anomaly', () => {
  const dossier = report([fact('projects', 'L’entreprise présente des réalisations de cuisines à Montpellier.', { section: 'presentation', kind: 'reported', sentiment: 'positive' })]);
  const result = buildProspectInsights(dossier, campaign, profile, identity);
  assert.equal(result.positives.length, 1);
  assert.equal(result.positives[0].priority, 'context');
  assert.match(result.positives[0].possibleEffect!, /aucun défaut n’est déduit/);
  assert.doesNotMatch(JSON.stringify(result), /finition incomplète|lien.*échoue|manque de clients/);
});

test('twelve distinct useful findings remain reachable although the opening view prioritizes five', () => {
  const facts = Array.from({ length: 12 }, (_, index) => fact(`broken-${index}`, `Le lien « Prestation ${index + 1} » répond HTTP 404.`));
  const dossier = report(facts), original = structuredClone(dossier);
  const result = buildProspectInsights(dossier, campaign, profile, identity);
  assert.equal(result.highlights.length, 5);
  assert.equal(result.otherInsights.length, 7);
  assert.equal(result.totalFacts, 12);
  assert.equal(result.prioritizedCount, 12);
  assert.deepEqual([...result.highlights, ...result.otherInsights].flatMap(item => item.evidenceIds).sort(), facts.map(item => item.id).sort());
  assert.deepEqual(dossier, original);
});

test('duplicate observations retain every evidence reference and source in one useful item', () => {
  const anotherSource = { ...source, id: 'second-source', url: 'https://artisan.example/devis', collectedAt: '2026-10-05T12:00:00Z' };
  const dossier = report([
    fact('first', 'Le lien « Demander un devis » répond HTTP 404.'),
    fact('second', 'Le lien « Demander un devis » répond HTTP 404.', { sourceIds: [anotherSource.id], observedOn: '2026-10-05' }),
  ]);
  dossier.sources.push(anotherSource);
  const result = buildProspectInsights(dossier, campaign, profile, identity);
  assert.equal(result.highlights.length, 1);
  assert.deepEqual(result.highlights[0].evidenceIds, ['first', 'second']);
  assert.deepEqual(result.highlights[0].sourceIds, [source.id, anotherSource.id]);
  assert.equal(result.highlights[0].observedOn, '2026-10-05');
  assert.equal(result.totalFacts, 2);
  assert.equal(dossier.facts.length, 2);
});

test('unsupported, corrected and hypothetical findings cannot drive the opening view', () => {
  const dossier = report([
    fact('missing-proof', 'Le lien « Devis » répond HTTP 404.', { sourceIds: ['missing'] }),
    fact('corrected', 'Le lien « Devis » répond HTTP 404.', { corrected: true }),
    fact('hypothesis', 'Le lien « Devis » répond HTTP 404.', { kind: 'hypothesis' }),
  ]);
  const result = buildProspectInsights(dossier, campaign, profile, identity);
  assert.equal(result.highlights.length, 0);
  assert.equal(result.totalFacts, 3);
});

test('a refuted effect is downgraded instead of continuing to suggest a commercial consequence', () => {
  const dossier = report([
    fact('broken', 'Le lien « Devis » répond HTTP 404.'),
    fact('refutation', 'Cet accès est réservé aux anciens clients ; aucune demande publique ne passe par ce lien.', { kind: 'hypothesis', sentiment: 'neutral', refutesFactId: 'broken' }),
  ]);
  const result = buildProspectInsights(dossier, campaign, profile, identity);
  assert.equal(result.highlights[0].priority, 'context');
  assert.match(result.highlights[0].possibleEffect!, /réfutée/);
  assert.match(result.highlights[0].proportionateHelp!, /Comprendre le fonctionnement/);
  assert.notEqual(result.nextAction.kind, 'review_finding');
});

test('an AI absence stays a contextual recorded observation and never becomes an alarmist finding', () => {
  const result = buildProspectInsights(report([fact('panel', 'Réponses IA via API : 3 réponses exploitables, 0 recommandent cette présence.', { section: 'visibility', kind: 'reported', sentiment: 'neutral' })]), campaign, profile, identity);
  assert.equal(result.highlights[0].category, 'search_presence');
  assert.equal(result.highlights[0].priority, 'context');
  assert.match(result.highlights[0].possibleEffect!, /requêtes et réponses enregistrées/);
  assert.match(result.highlights[0].possibleEffect!, /ne permet pas de conclure/);
  assert.doesNotMatch(JSON.stringify(result), /invisible|n.apparaît pas sur ChatGPT|urgent/);
});

test('generic public wording is not misread as a documented change', () => {
  const ordinary = fact('ordinary', 'La présentation annonce des interventions pour les particuliers.', { section: 'presentation', kind: 'reported', sentiment: 'neutral' });
  const realChange = fact('change', 'Ouverture d’une nouvelle prestation de rénovation le 15 septembre 2026.', { section: 'presentation', kind: 'reported', sentiment: 'neutral' });
  const result = buildProspectInsights(report([ordinary, realChange]), campaign, profile, identity);
  assert.equal(result.highlights[0].category, 'change');
  assert.equal(result.highlights[1].category, 'presentation');
});

test('long useful observations are excerpted in the view while their complete text remains reachable', () => {
  const long = `Prestations : ${'rénovation de cuisines et présentation de réalisations documentées. '.repeat(30)}`;
  const dossier = report([fact('long', long, { section: 'presentation', kind: 'reported', sentiment: 'neutral' })]);
  const result = buildProspectInsights(dossier, campaign, profile, identity);
  assert.ok(result.highlights[0].observation.length <= 301);
  assert.equal(result.highlights[0].supportingObservations[0], long);
  assert.equal(dossier.facts[0].text, long);
});

test('an explicitly reported need precedes a speculative problem while negated needs remain unknown', () => {
  const expressed = fact('need', 'Besoin exprimé lors de l’échange : simplifier la demande de devis.', { section: 'fit', kind: 'reported', sentiment: 'neutral' });
  const broken = fact('broken', 'Le lien « Devis » répond HTTP 404.');
  const result = buildProspectInsights(report([broken, expressed]), campaign, profile, identity);
  assert.equal(result.highlights[0].category, 'stated_need');
  assert.ok(!result.unknowns.some(item => /besoin et leur priorité/.test(item)));
  const negative = buildProspectInsights(report([fact('unknown', 'Aucun besoin exprimé n’est documenté.', { section: 'fit', kind: 'reported', sentiment: 'neutral' })]), campaign, profile, identity);
  assert.equal(negative.highlights.length, 0);
  assert.ok(negative.unknowns.some(item => /besoin et leur priorité/.test(item)));
});

test('rendering claims inferred from HTML stay below a directly verified visual defect', () => {
  const html = fact('html', 'Le bouton « Comparer » masque les photos de réalisations.', { scope: 'HTML public reçu uniquement, JavaScript non exécuté.' });
  const verified = fact('verified', 'Les textes du bandeau sont illisibles à cause du recouvrement de la navigation.');
  const result = buildProspectInsights(report([html, verified]), campaign, profile, identity);
  assert.equal(result.highlights[0].evidenceIds[0], 'verified');
  assert.equal(result.highlights[0].priority, 'high');
  assert.equal(result.highlights[1].priority, 'medium');
});

test('a failing accessibility check describes a concrete reading or touch task without claiming a visual audit', () => {
  const result = buildProspectInsights(report([
    fact('contrast', 'L’audit Lighthouse « color-contrast » échoue : contraste insuffisant de certains textes.', { scope: 'Contrôle Lighthouse de laboratoire ponctuel, aucun audit visuel manuel.' }),
    fact('targets', 'L’audit Lighthouse « target-size » échoue : taille des cibles tactiles insuffisante.', { scope: 'Contrôle Lighthouse de laboratoire ponctuel.' }),
    fact('passed', 'Les contrôles de rendu Lighthouse ont passé ce test mobile.', { sentiment: 'positive', scope: 'Contrôle Lighthouse de laboratoire ponctuel.' }),
  ]), campaign, profile, identity);
  assert.equal(result.highlights.length, 2);
  assert.equal(result.highlights[0].title, 'La lisibilité de certains textes est à vérifier');
  assert.equal(result.highlights[1].title, 'L’utilisation de certains boutons est à vérifier');
  assert.ok(result.highlights.every(item => item.priority === 'medium'));
  assert.ok(result.unknowns.some(item => /rendu visuel.*reste à vérifier/.test(item)));
});

test('structured visual evidence is available to the concrete insight and usable as an approach motive', () => {
  const screenshot = 'data:image/jpeg;base64,/9j/AA==';
  const visual = { category: 'overlap' as const, device: 'desktop' as const, pageUrl: source.url, element: 'Comparateur de réalisations Avant / après', viewport: { width: 1440, height: 900 }, screenshot };
  const dossier = report([fact('visual-typed', 'La pastille de comparaison recouvre les images des chantiers.', { visual, scope: 'Page consultée ; observation humaine enregistrée.' })]);
  const result = buildProspectInsights(dossier, campaign, profile, identity);
  const insight = result.highlights[0];
  assert.equal(insight.category, 'visual');
  assert.equal(insight.priority, 'high');
  assert.equal(insight.eligibleForApproach, true);
  assert.equal(insight.visualEvidence[0].screenshot, screenshot);
  assert.deepEqual(insight.visualEvidence[0].viewport, visual.viewport);
  assert.match(insight.proportionateHelp!, /corriger|correction/);
  assert.doesNotMatch(insight.proportionateHelp!, /refonte/);
  assert.equal(result.nextAction.kind, 'review_finding');
});
