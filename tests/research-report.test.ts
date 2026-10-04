import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProspectReport, enrichCompanyReport, getCandidateFacts, listCandidateContacts, mergeCandidateReports } from '../lib/research-report';
import { prospectReportSchema, researchDataSchema } from '../lib/research-schemas';
import { emptyQualification } from '../lib/qualification';
import { createApproachPlan, emptyProviderProfile } from '../lib/contact-preparation';
import type { Campaign, DiscoveryCandidate } from '../lib/campaign-types';
import type { Company } from '../lib/types';

const campaign: Campaign = { id: 'campaign', name: 'Artisans Lyon', targetCity: 'Lyon', targetBusiness: 'Artisans', targetOffer: 'Sites et améliorations web', targetExclusions: 'Franchises', activityCodes: '', revision: 1, status: 'active', createdAt: '2026-10-04T12:00:00Z', updatedAt: '2026-10-04T12:00:00Z' };
function candidate(): DiscoveryCandidate {
  return { id: 'candidate', runId: 'run', companyId: null, status: 'review', website: 'https://atelier.example/', websites: [], revision: 3, attempts: {}, htmlError: '', mobileError: '', mobile: null,
    company: { name: 'Atelier', city: 'Lyon', business: 'Menuiserie', address: '', activityCode: '43.32A', siren: '123456789', siret: '12345678900012', sourceUrl: 'https://annuaire-entreprises.data.gouv.fr/entreprise/123456789' },
    html: { website: 'https://atelier.example/', analyzedOn: '2026-10-04', pages: [{ url: 'https://atelier.example/', title: 'Atelier' }], warnings: [],
      contacts: [{ kind: 'email', value: 'contact@atelier.example', sourceUrl: 'https://atelier.example/' }], findings: [
        { id: 'mobile-1', key: 'mobile', note: 'Une balise viewport est présente dans le HTML. Le rendu sur mobile reste à vérifier visuellement.', sourceUrl: 'https://atelier.example/' },
        { id: 'technical-2', key: 'technical', note: 'Le lien devis répond HTTP 404.', sourceUrl: 'https://atelier.example/devis', approach: 'Vérifier le lien.' },
      ] },
    research: { sources: [{ id: 'search', provider: 'google', url: 'https://atelier.example/prestations', title: 'Prestations', excerpt: 'Menuiserie et agencement', collectedAt: '2026-10-04T12:00:00Z' }],
      facts: Array.from({ length: 12 }, (_, index) => ({ id: `service-${index}`, section: 'presentation', kind: 'reported', sentiment: index % 2 ? 'positive' : 'neutral', text: `Prestation documentée ${index + 1}`, sourceIds: ['search'], observedOn: '2026-10-04', scope: 'Déclaration publique du professionnel.' })),
      contacts: [{ kind: 'email', value: 'CONTACT@ATELIER.EXAMPLE', sourceUrl: 'https://atelier.example/prestations' }, { kind: 'phone', value: '04 12 34 56 78', sourceUrl: 'https://atelier.example/prestations', sourceId: 'search' }], profiles: [], warnings: [] },
  };
}
const manualCompany = (): Company => ({ id: 'manual', name: 'Indépendant', website: '', city: 'Lyon', business: 'Photographie', targetFit: 'unknown', problemFound: 'unknown', contactAvailable: 'unknown', observation: '', proofUrl: '', observedOn: '', trigger: '', stage: 'À étudier', archived: false, oppositionActive: false, oppositionDate: '', oppositionNote: '', contact: { name: '', role: '', email: '', phone: '', formUrl: '', profileUrl: '' }, nextAction: null, createdAt: '2026-10-04T12:00:00Z', updatedAt: '2026-10-04T12:00:00Z', qualification: emptyQualification() });

test('full dossier keeps twelve findings and nine sections independently of opening synthesis', () => {
  const report = buildProspectReport(candidate(), campaign);
  assert.equal(report.sections.length, 9);
  for (let index = 0; index < 12; index++) assert.ok(report.facts.some(fact => fact.id === `service-${index}`));
  assert.equal(report.sections.find(section => section.key === 'presentation')?.factIds.filter(id => id.startsWith('service-')).length, 12);
  assert.ok(report.facts.find(fact => fact.id === 'mobile-1')?.sentiment === 'positive');
  assert.ok(report.facts.find(fact => fact.id === 'technical-2')?.sentiment === 'issue');
  assert.ok(prospectReportSchema.safeParse(report).success);
  assert.match(report.coverage.join(' '), /JavaScript non exécuté/);
  assert.match(report.coverage.join(' '), /Budget, besoin reconnu, priorité et décisionnaire restent inconnus/);
  const presentationOpportunity = report.opportunities.find(plan => plan.question.includes('comprennent en priorité'))!;
  assert.equal(presentationOpportunity.evidenceIds.filter(id => id.startsWith('service-')).length, 12);
});
test('same source data produces stable report identity despite counter changes or regeneration', () => {
  const input = candidate(), first = buildProspectReport(input, campaign);
  input.revision++; input.status = 'accepted';
  assert.equal(first.id, buildProspectReport(input, campaign).id);
  assert.notEqual(first.id, buildProspectReport(input, { ...campaign, targetOffer: 'Application métier' }).id);
});
test('legacy contacts stay first and public channels are deduplicated', () => {
  const contacts = listCandidateContacts(candidate());
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].value, 'contact@atelier.example');
  assert.equal(contacts[1].kind, 'phone');
});
test('identical observations merge provenance without removing legacy selection IDs', () => {
  const input = candidate(), original = getCandidateFacts(input).find(fact => fact.id === 'technical-2')!;
  input.research!.facts.push({ ...original, id: 'duplicate', sourceIds: ['search'], observedOn: '2026-10-05' });
  const facts = getCandidateFacts(input), fact = facts.find(item => item.id === 'technical-2')!;
  assert.equal(facts.filter(item => item.text === original.text).length, 1);
  assert.ok(fact.sourceIds.includes('search'));
  assert.equal(fact.observedOn, '2026-10-05');
});
test('social-only identity is reportable without any fictitious site audit or absence conclusion', () => {
  const input = candidate(); input.website = ''; input.html = null; input.company.siren = ''; input.company.siret = '';
  input.research = { sources: [{ id: 'social', provider: 'google', url: 'https://www.instagram.com/atelier/', title: 'Profil', excerpt: 'Menuiserie', collectedAt: '2026-10-04' }], facts: [], contacts: [], profiles: ['https://www.instagram.com/atelier/'], warnings: [] };
  const report = buildProspectReport(input, campaign);
  assert.equal(report.sections.find(section => section.key === 'site')?.status, 'not_applicable');
  assert.equal(report.facts.filter(fact => fact.section === 'site').length, 0);
  assert.match(report.summary, /site non trouvé/);
  assert.match(report.warnings.join(' '), /Cela ne démontre pas/);
});
test('mobile quota failure retains the HTML evidence and explicitly marks partial coverage', () => {
  const input = candidate(); input.mobileError = 'Quota PageSpeed atteint.';
  const report = buildProspectReport(input, campaign);
  assert.ok(report.facts.some(fact => fact.id === 'technical-2'));
  assert.match(report.sections.find(section => section.key === 'site')!.notes.join(' '), /Quota PageSpeed/);
  assert.equal(report.sections.find(section => section.key === 'site')?.status, 'partial');
});
test('invalid or invented narrative cannot replace the full collected report', () => {
  const input = candidate(); input.research!.narrative = 'Cette entreprise perd 90 clients. ROI garanti : 300 %.';
  const report = buildProspectReport(input, campaign);
  assert.equal(report.narrative, undefined);
  assert.equal(report.facts.filter(fact => fact.id.startsWith('service-')).length, 12);
});
test('schemas reject absent source references rather than silently truncating collected data', () => {
  const input = candidate(); input.research!.facts[0].sourceIds = ['invented'];
  assert.equal(researchDataSchema.safeParse(input.research).success, false);
  assert.throws(() => buildProspectReport(input, campaign));
});
test('manual dossier merges qualification, real AI interface tests and channels with explicit provenance', () => {
  const company = manualCompany(); company.contact.email = 'pro@independant.example';
  company.qualification!.answers.references.examples = ['Projet de portraits 2025'];
  company.qualification!.answers.references.sourceUrl = 'https://www.instagram.com/independant/';
  company.qualification!.observations.items.services = { answer: 'yes', notes: 'Portrait et reportage', sourceUrl: 'https://www.instagram.com/independant/', observedOn: '2026-10-04' };
  const tests = [{ id: 'test', companyId: company.id, panel: 'Local', period: 'Octobre 2026', tool: 'ChatGPT', interface: 'Site web', mode: 'web' as const, model: '', questions: 'Photographe Lyon ?', validResponses: 3, recommendations: 0, citations: 1, notes: 'Relevé conservé', proofUrl: 'https://chatgpt.com/share/example', createdAt: '2026-10-04T12:00:00Z' }];
  const report = enrichCompanyReport(null, company, campaign, tests);
  assert.ok(report.facts.some(fact => fact.text.includes('Projet de portraits')));
  assert.ok(report.facts.some(fact => fact.text.includes('ChatGPT') && fact.section === 'visibility'));
  assert.equal(report.contacts.find(contact => contact.kind === 'email')?.value, company.contact.email);
  assert.ok(report.sources.some(source => source.provider === 'manual'));
  assert.equal(report.id, enrichCompanyReport(null, company, campaign, tests).id);
});
test('shared corrections preserve history, invalidate only the exact fact version and change report identity', () => {
  const company = manualCompany(), base = buildProspectReport(candidate(), campaign), old = base.facts.find(fact => fact.id === 'technical-2')!;
  const correction = { id: 'correction', companyId: company.id, factId: old.id, fingerprint: JSON.stringify([old.text, old.observedOn, [...old.sourceIds].sort()]), note: 'Le lien fonctionne lors de ma vérification.', correctedAt: '2026-10-05T12:00:00Z' };
  const before = enrichCompanyReport(base, company, campaign), after = enrichCompanyReport(base, company, campaign, [], [correction]);
  assert.equal(after.facts.find(fact => fact.id === old.id)?.corrected, true);
  assert.ok(after.facts.some(fact => fact.text.includes(correction.note)));
  assert.notEqual(before.id, after.id);
  assert.ok(!after.opportunities.some(plan => plan.evidenceIds.includes(old.id)));
  const later = structuredClone(base); later.facts.find(fact => fact.id === old.id)!.observedOn = '2026-10-06';
  assert.notEqual(enrichCompanyReport(later, company, campaign, [], [correction]).facts.find(fact => fact.id === old.id)?.corrected, true);
});
test('API panel distinguishes mention, citation, recommendation and unresolved namesakes', () => {
  const input = candidate();
  input.research!.panel = { id: 'panel', targetKey: 'Lyon-menuiserie', createdAt: '2026-10-04T12:00:00Z', responses: [
    { question: 'Menuiserie Lyon ?', answer: 'Atelier est une option.', model: 'model', engine: 'API', recordedAt: '2026-10-04T12:00:00Z', sources: input.research!.sources, valid: true,
      recommendations: [{ name: 'Atelier', city: 'Lyon', url: 'https://homonyme.example/' }] },
    { question: 'Autres options ?', answer: '', model: 'model', engine: 'API', recordedAt: '2026-10-04T12:00:00Z', sources: [], valid: false, recommendations: [], error: 'Quota atteint' },
  ] };
  const report = buildProspectReport(input, campaign), fact = report.facts.find(fact => fact.section === 'visibility')!;
  assert.match(fact.text, /1 réponse\(s\) exploitable\(s\) sur 2/);
  assert.match(fact.text, /non déterminée/);
  assert.match(fact.scope, /distinct des interfaces ChatGPT/);
  assert.equal(report.panel!.responses.length, 2);
});
test('historical collections remain complete and newest legacy IDs stay stable', () => {
  const current = candidate(), earlier = candidate(); earlier.html!.analyzedOn = '2026-10-01';
  earlier.research!.facts.push({ id: 'old-project', section: 'presentation', kind: 'reported', sentiment: 'positive', text: 'Projet antérieur documenté', sourceIds: ['search'], observedOn: '2026-10-01', scope: 'Déclaration publique.' });
  const newest = buildProspectReport(current, campaign), oldest = buildProspectReport(earlier, campaign), merged = mergeCandidateReports([newest, oldest], campaign)!;
  assert.ok(merged.facts.some(fact => fact.id === 'old-project'));
  assert.equal(merged.facts.find(fact => fact.id === 'technical-2')!.observedOn, '2026-10-04');
  assert.ok(merged.facts.some(fact => fact.id.startsWith('history-fact-') && fact.observedOn === '2026-10-01'));
  assert.equal(merged.id, mergeCandidateReports([newest, oldest], campaign)!.id);
  assert.equal(prospectReportSchema.safeParse(merged).success, true);
});
test('a correction remains attached to its historical fact after a later audit reuses the ID', () => {
  const company = manualCompany(), oldCandidate = candidate(), currentCandidate = candidate();
  oldCandidate.html!.analyzedOn = '2026-10-01';
  const oldReport = buildProspectReport(oldCandidate, campaign), currentReport = buildProspectReport(currentCandidate, campaign), old = oldReport.facts.find(fact => fact.id === 'technical-2')!;
  const correction = { id: 'correction', companyId: company.id, factId: old.id, fingerprint: JSON.stringify([old.text, old.observedOn, [...old.sourceIds].sort()]), note: 'Correction de l’ancien relevé', correctedAt: '2026-10-02T12:00:00Z' };
  const merged = mergeCandidateReports([currentReport, oldReport], campaign)!;
  const result = enrichCompanyReport(merged, company, campaign, [], [correction]);
  assert.notEqual(result.facts.find(fact => fact.id === 'technical-2')?.corrected, true);
  assert.ok(result.facts.some(fact => fact.observedOn === '2026-10-01' && fact.text === old.text && fact.corrected));
});
test('a refuted consequence preserves the true 404 fact and changes the proposed discussion', () => {
  const company = manualCompany(), base = buildProspectReport(candidate(), campaign), fact = base.facts.find(fact => fact.id === 'technical-2')!;
  const correction = { id: 'hypothesis-correction', companyId: company.id, factId: fact.id, mode: 'hypothesis' as const,
    fingerprint: JSON.stringify([fact.text, fact.observedOn, [...fact.sourceIds].sort()]), note: 'Le dirigeant confirme recevoir les demandes par téléphone ; ce lien ne le gêne pas.', correctedAt: '2026-10-05T12:00:00Z' };
  const report = enrichCompanyReport(base, company, campaign, [], [correction]);
  assert.notEqual(report.facts.find(item => item.id === fact.id)?.corrected, true);
  assert.ok(report.facts.some(item => item.refutesFactId === fact.id && item.text.includes(correction.note)));
  const plan = createApproachPlan(report, campaign, emptyProviderProfile(), [fact.id]);
  assert.match(plan.hypothesis, /réfutée/);
  assert.doesNotMatch(plan.hypothesis, /peut compliquer une demande/);
  assert.match(plan.nextStep, /Si aucun besoin/);
});
test('explicit contact verification supplies public provenance, without replacing unrelated channels', () => {
  const company = manualCompany(); company.contact.email = 'contact@independant.example'; company.contact.phone = '04 12 34 56 78';
  const activities = [{ id: 'activity', companyId: company.id, kind: 'note' as const, type: 'Contact professionnel confirmé', date: '2026-10-04', createdAt: '2026-10-04T12:00:00Z',
    text: 'Email : contact@independant.example\nTéléphone : \nSource : https://www.instagram.com/independant/\nConsultation : 2026-10-04' }];
  const report = enrichCompanyReport(null, company, campaign, [], [], activities);
  const email = report.contacts.find(contact => contact.kind === 'email')!;
  assert.equal(email.sourceUrl, 'https://www.instagram.com/independant/');
  assert.equal(report.sources.find(source => source.id === email.sourceId)?.collectedAt, '2026-10-04');
  assert.equal(report.contacts.find(contact => contact.kind === 'phone')!.value, company.contact.phone);
});
test('every collected public presentation block is reported with its exact excerpt and bounded coverage', () => {
  const input = candidate();
  input.html!.content = [
    { url: 'https://atelier.example/', title: 'Nos prestations', excerpt: 'Fabrication de meubles sur mesure pour les particuliers à Lyon et Villeurbanne.', collectedAt: '2026-10-04T12:00:00Z' },
    { url: 'https://atelier.example/prestations', title: 'Nos réalisations', excerpt: 'Agencement du café Exemple, présenté dans notre portfolio.', collectedAt: '2026-10-04T12:00:01Z' },
    ...Array.from({ length: 10 }, (_, index) => ({ url: 'https://atelier.example/prestations', title: `Projet ${index + 1}`, excerpt: `Description publique du projet ${index + 1}.`, collectedAt: '2026-10-04T12:00:01Z' })),
  ];
  input.html!.warnings.push('La collecte de présentation a atteint une limite ; les autres informations restent à vérifier manuellement.');
  const report = buildProspectReport(input, campaign), facts = report.facts.filter(fact => fact.id.startsWith('website-content-fact-'));
  assert.equal(facts.length, 12);
  assert.ok(facts.every(fact => fact.kind === 'reported' && fact.section === 'presentation' && fact.sentiment === 'neutral'));
  for (const block of input.html!.content) {
    const source = report.sources.find(source => source.excerpt === block.excerpt)!;
    assert.ok(source); assert.equal(source.provider, 'website'); assert.equal(source.collectedAt, block.collectedAt);
    assert.ok(facts.some(fact => fact.text.includes(block.excerpt) && fact.sourceIds.includes(source.id)));
  }
  assert.match(report.coverage.join(' '), /8 blocs par page et 24 au total, 1 200 caractères/);
  assert.match(report.warnings.join(' '), /atteint une limite/);
  assert.match(facts[0].scope, /sans validation indépendante ni difficulté commerciale déduite/);
});
