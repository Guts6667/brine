import type { Campaign, DiscoveryCandidate } from './campaign-types';
import type { FactSection, ProspectReport, ResearchContact, ResearchCorrection, ResearchFact, ResearchSource } from './research-types';
import type { Activity, AiTest, Company } from './types';
import { createApproachPlan, emptyProviderProfile, validateReportNarrative } from './contact-preparation';
import { prospectReportSchema, researchContactSchema, researchUrlSchema } from './research-schemas';

/** Stable browser-safe identity: no random IDs, network requests, or hidden AI calls. */
export function researchId(prefix: string, value: unknown): string {
  const input = JSON.stringify(value);
  let first = 2166136261, second = 2246822519;
  for (let index = 0; index < input.length; index++) {
    first = Math.imul(first ^ input.charCodeAt(index), 16777619);
    second = Math.imul(second ^ input.charCodeAt(index), 3266489917);
  }
  return `${prefix}-${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}
const normalize = (value: string) => value.trim().toLocaleLowerCase('fr').replace(/\s+/g, ' ');
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
function contactKey(contact: ResearchContact): string {
  return `${contact.kind}:${contact.kind === 'phone' ? contact.value.replace(/\D/g, '').replace(/^33(?=\d{9}$)/, '0') : normalize(contact.value).replace(/\/$/, '')}`;
}
/** Keep the legacy selection indices stable; append newly collected channels afterwards. */
export function listCandidateContacts(candidate: DiscoveryCandidate): ResearchContact[] {
  const result: ResearchContact[] = [], seen = new Set<string>();
  for (const contact of [...(candidate.html?.contacts || []), ...(candidate.mobile?.contacts || []), ...(candidate.research?.contacts || [])]) {
    if (!researchContactSchema.safeParse(contact).success) continue;
    const key = contactKey(contact);
    if (seen.has(key)) continue;
    seen.add(key); result.push({ ...contact });
  }
  return result;
}
function findingSentiment(note: string, approach?: string): ResearchFact['sentiment'] {
  if (approach || /(?:répond|renvoie) HTTP [45]\d\d|audit.*échoue|blocage d.indexation|aucune balise viewport/i.test(note)) return 'issue';
  if (/balise viewport est présente|contact publié|contact.*détecté|lien (?:d.action|de prestations) détecté/i.test(note)) return 'positive';
  return 'neutral';
}
function sourceForFinding(candidate: DiscoveryCandidate, url: string, provider: 'website' | 'pagespeed', date: string, excerpt: string): ResearchSource {
  const existing = candidate.research?.sources.find(source => source.url === url && source.provider === provider && source.collectedAt.startsWith(date));
  return existing || { id: researchId('source', [provider, url, date]), provider, url, title: provider === 'pagespeed' ? 'Mesure PageSpeed mobile' : 'HTML public consulté', excerpt, collectedAt: date };
}
function sourceForContent(block: { url: string; title: string; excerpt: string; collectedAt: string }): ResearchSource {
  return { id: researchId('website-content-source', block), provider: 'website', url: block.url, title: block.title || 'Présentation déclarée sur le site', excerpt: block.excerpt, collectedAt: block.collectedAt };
}
/** Old findings retain their original IDs so accepted findings and backups stay usable. */
export function getCandidateFacts(candidate: DiscoveryCandidate): ResearchFact[] {
  const result: ResearchFact[] = [], bySignature = new Map<string, ResearchFact>(), seenIds = new Set<string>();
  const add = (fact: ResearchFact) => {
    const signature = JSON.stringify([fact.section, fact.kind, normalize(fact.text), fact.corrected || false, fact.visual || null]);
    const duplicate = bySignature.get(signature);
    if (duplicate) {
      if(fact.review)duplicate.review={...fact.review};
      duplicate.sourceIds = unique([...duplicate.sourceIds, ...fact.sourceIds]);
      if (fact.observedOn > duplicate.observedOn) duplicate.observedOn = fact.observedOn;
      if (fact.scope && !duplicate.scope.includes(fact.scope)) duplicate.scope = unique([duplicate.scope, fact.scope]).join(' ');
      return;
    }
    const item = { ...fact, sourceIds: [...fact.sourceIds] };
    if (seenIds.has(item.id)) item.id = researchId('fact', [item.id, signature]);
    seenIds.add(item.id); bySignature.set(signature, item); result.push(item);
  };
  for (const [provider, analysis] of [['website', candidate.html], ['pagespeed', candidate.mobile]] as const) {
    if (!analysis) continue;
    for (const finding of analysis.findings) {
      const source = sourceForFinding(candidate, finding.sourceUrl, provider, analysis.analyzedOn, finding.note);
      const section: FactSection = finding.key === 'contact' || finding.key === 'mainAction' ? 'contact' : finding.key === 'services' ? 'presentation' : 'site';
      add({ id: finding.id, section, kind: 'observed', sentiment: finding.id === 'pagespeed-rendered-checks-passed' ? 'positive' : findingSentiment(finding.note, finding.approach), text: finding.note,
        sourceIds: [source.id], observedOn: analysis.analyzedOn,
        scope: provider === 'pagespeed' ? 'Test de laboratoire ponctuel avec simulation mobile ; le résultat peut varier.' : 'HTML public reçu sur cette page ; JavaScript non exécuté et actions non réalisées.' });
    }
    if (provider === 'website') for (const block of analysis.content || []) {
      const source = sourceForContent(block);
      add({ id: researchId('website-content-fact', block), section: 'presentation', kind: 'reported', sentiment: 'neutral',
        text: [block.title, block.excerpt].filter(Boolean).join('\n'), sourceIds: [source.id], observedOn: block.collectedAt,
        scope: 'Déclaration publique présente dans le HTML consulté ; prestations, réalisations, clientèle ou zone déclarées uniquement, sans validation indépendante ni difficulté commerciale déduite.' });
    }
  }
  for (const fact of candidate.research?.facts || []) add(fact);
  return result;
}

const sectionTitles: Record<FactSection | 'method', string> = {
  identity: 'Identité et activité', fit: 'Adéquation à la campagne', presence: 'Présence numérique', presentation: 'Présentation et réalisations',
  contact: 'Parcours de contact', site: 'Analyse du site', visibility: 'Présence dans les recherches', opportunities: 'Pistes d’intervention', method: 'Preuves et méthode',
};
/** Group the same proposed use, without limiting or deleting the observations supporting it. */
function supportedOpportunities(report: ProspectReport, campaign: Campaign): ProspectReport['opportunities'] {
  if (!campaign.targetOffer?.trim()) return [];
  const groups = new Map<string, ProspectReport['opportunities'][number]>();
  for (const fact of report.facts.filter(fact => fact.kind !== 'hypothesis' && !fact.corrected && fact.sourceIds.length)) {
    try {
      const plan = createApproachPlan(report, campaign, emptyProviderProfile(), [fact.id]);
      const key = JSON.stringify([plan.help, plan.question, plan.hypothesis]);
      const previous = groups.get(key);
      if (previous) previous.evidenceIds = unique([...previous.evidenceIds, ...plan.evidenceIds]);
      else groups.set(key, plan);
    } catch { /* This fact remains in the dossier without inventing an intervention. */ }
  }
  return [...groups.values()];
}

export function buildProspectReport(candidate: DiscoveryCandidate, campaign: Campaign): ProspectReport {
  const sources: ResearchSource[] = [], sourceIds = new Set<string>();
  const addSource = (source: ResearchSource) => { if (!sourceIds.has(source.id)) { sourceIds.add(source.id); sources.push({ ...source }); } return source.id; };
  for (const source of candidate.research?.sources || []) addSource(source);
  for (const response of candidate.research?.panel?.responses || []) for (const source of response.sources) addSource(source);
  for (const [provider, analysis] of [['website', candidate.html], ['pagespeed', candidate.mobile]] as const) {
    if (!analysis) continue;
    for (const page of analysis.pages) addSource(sourceForFinding(candidate, page.url, provider, analysis.analyzedOn, page.title || 'Page consultée.'));
    for (const finding of analysis.findings) addSource(sourceForFinding(candidate, finding.sourceUrl, provider, analysis.analyzedOn, finding.note));
    if (provider === 'website') for (const block of analysis.content || []) addSource(sourceForContent(block));
  }
  const facts = getCandidateFacts(candidate);
  const addFact = (fact: ResearchFact) => {
    if (!facts.some(existing => existing.id === fact.id || (existing.section === fact.section && normalize(existing.text) === normalize(fact.text) && existing.kind === fact.kind))) facts.push(fact);
  };
  const reference = candidate.company.sourceUrl;
  if (reference && researchUrlSchema.safeParse(reference).success) {
    const original = sources.find(source => source.url === reference);
    const provider = /recherche-entreprises\.api\.gouv\.fr|annuaire-entreprises\.data\.gouv\.fr/.test(reference) ? 'registry' : original?.provider || 'manual';
    const sourceId = original?.id || addSource({ id: researchId('source', [provider, reference]), provider, url: reference, title: provider === 'registry' ? 'Recherche officielle d’entreprises' : 'Source de l’identité proposée', excerpt: `${candidate.company.name} — ${candidate.company.business} — ${candidate.company.city}`, collectedAt: '' });
    const identity = [candidate.company.name, candidate.company.business, candidate.company.city, candidate.company.address,
      candidate.company.siren ? `SIREN ${candidate.company.siren}` : '', candidate.company.siret ? `SIRET ${candidate.company.siret}` : ''].filter(Boolean).join(' · ');
    addFact({ id: researchId('identity', [candidate.company, sourceId]), section: 'identity', kind: 'reported', sentiment: 'neutral', text: identity,
      sourceIds: [sourceId], observedOn: original?.collectedAt || '', scope: provider === 'registry' ? 'Identité et activité rapportées par le registre ; le code NAF ne décrit pas toutes les prestations.' : 'Identité proposée par cette source ; rapprochement à confirmer si ambigu.' });
  }
  const contacts = listCandidateContacts(candidate).map(contact => {
    let sourceId = contact.sourceId;
    if (!sourceId || !sourceIds.has(sourceId)) {
      sourceId = sources.find(source => source.url === contact.sourceUrl)?.id;
      if (!sourceId) sourceId = addSource({ id: researchId('source', ['contact', contact.sourceUrl]), provider: 'manual', url: contact.sourceUrl, title: 'Source de la coordonnée publique', excerpt: contact.value, collectedAt: '' });
    }
    addFact({ id: researchId('contact', [contact.kind, contact.value, sourceId]), section: 'contact', kind: 'reported', sentiment: 'positive',
      text: `${contact.kind === 'email' ? 'Email' : contact.kind === 'phone' ? 'Téléphone' : contact.kind === 'formUrl' ? 'Formulaire repéré' : 'Profil professionnel'} : ${contact.value}`,
      sourceIds: [sourceId], observedOn: sources.find(source => source.id === sourceId)?.collectedAt || '',
      scope: contact.kind === 'formUrl' ? 'Formulaire repéré uniquement ; aucun envoi réalisé.' : 'Coordonnée publiée ; association professionnelle à confirmer avant contact.' });
    return { ...contact, sourceId };
  });
  const profiles = unique([...(candidate.research?.profiles || []), ...contacts.filter(contact => contact.kind === 'profileUrl').map(contact => contact.value)]);
  for (const profile of profiles) {
    const original = sources.find(source => source.url === profile);
    const sourceId = original?.id || addSource({ id: researchId('source', ['profile', profile]), provider: 'manual', url: profile, title: 'Profil public identifié', excerpt: profile, collectedAt: '' });
    addFact({ id: researchId('presence', profile), section: 'presence', kind: 'reported', sentiment: 'neutral', text: `Profil public identifié : ${profile}`,
      sourceIds: [sourceId], observedOn: original?.collectedAt || '', scope: 'Profil à rattacher à la bonne entreprise ; cette présence ne prouve pas l’absence d’un site.' });
  }
  if (candidate.website && researchUrlSchema.safeParse(candidate.website).success) {
    const original = sources.find(source => source.url === candidate.website);
    const proposal = candidate.websites.find(website => website.url === candidate.website);
    const url = proposal?.sourceUrl || candidate.website;
    const sourceId = original?.id || addSource({ id: researchId('source', ['website', url]), provider: 'website', url, title: 'Adresse de site identifiée', excerpt: candidate.website, collectedAt: '' });
    addFact({ id: researchId('website', candidate.website), section: 'presence', kind: 'reported', sentiment: 'neutral', text: `Site identifié : ${candidate.website}`, sourceIds: [sourceId],
      observedOn: original?.collectedAt || '', scope: 'Adresse identifiée ; une correspondance ambiguë nécessite une confirmation.' });
  }
  const panel = candidate.research?.panel;
  if (panel) {
    const responses = panel.responses.filter(response => response.valid);
    const knownUrls = [candidate.website, ...profiles].filter(Boolean);
    const matchesUrl = (value: string) => {
      try {
        const actual = new URL(value);
        return knownUrls.some(known => {
          const expected = new URL(known);
          const sameHost = actual.hostname.replace(/^www\./, '') === expected.hostname.replace(/^www\./, '');
          // A social hostname belongs to many professionals; require the exact profile path.
          const social = /(?:^|\.)(?:instagram\.com|facebook\.com|linkedin\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com)$/i.test(actual.hostname);
          const sameProfilePath = actual.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '');
          const sameFacebookId = !/facebook\.com$/i.test(actual.hostname) || actual.pathname !== '/profile.php' || (!!expected.searchParams.get('id') && actual.searchParams.get('id') === expected.searchParams.get('id'));
          return sameHost && (!social || (sameProfilePath && sameFacebookId));
        });
      } catch { return false; }
    };
    let recommendations = 0, citations = 0, mentions = 0, ambiguous = 0;
    for (const response of responses) {
      const exact = response.recommendations.filter(recommendation => matchesUrl(recommendation.url));
      const possible = response.recommendations.filter(recommendation => !matchesUrl(recommendation.url) && normalize(recommendation.name) === normalize(candidate.company.name) && normalize(recommendation.city) === normalize(candidate.company.city));
      if (exact.length) recommendations++;
      if (possible.length) ambiguous++;
      if (response.sources.some(source => matchesUrl(source.url))) citations++;
      if (normalize(response.answer).includes(normalize(candidate.company.name))) mentions++;
    }
    const text = `Réponses IA via API : ${responses.length} réponse(s) exploitable(s) sur ${panel.responses.length}. Dans ce panel daté, ${mentions} réponse(s) mentionnent le nom, ${citations} citent une adresse identifiée, ${ambiguous ? 'recommandation : non déterminée dans les réponses à identité ambiguë' : `${recommendations} recommandent une présence identifiée`}.${ambiguous ? ` ${ambiguous} réponse(s) demandent une confirmation d’identité.` : ''}`;
    const sourceId = addSource({ id: researchId('panel-source', panel.id), provider: 'openrouter', url: `https://brine-iota.vercel.app/campagnes/rapports/candidat/${encodeURIComponent(candidate.id)}`,
      title: 'Questions et réponses API conservées dans ce dossier', excerpt: panel.responses.map(response => `${response.question}\n${response.answer || response.error || 'Réponse indisponible'}`).join('\n').slice(0, 12000), collectedAt: panel.createdAt });
    addFact({ id: researchId('panel-fact', [panel.id, candidate.id]), section: 'visibility', kind: 'reported', sentiment: 'neutral', text, sourceIds: [sourceId], observedOn: panel.createdAt,
      scope: 'Relevé API uniquement, distinct des interfaces ChatGPT/Claude. Une mention du nom ne confirme pas l’identité ; une absence porte seulement sur les réponses exploitables enregistrées.' });
  }
  const warnings = unique([...(candidate.research?.warnings || []), ...(candidate.html?.warnings || []), ...(candidate.mobile?.warnings || []), candidate.htmlError, candidate.mobileError]);
  if (!candidate.website) warnings.push('Aucun site identifié dans les sources consultées. Cela ne démontre pas qu’aucun site n’existe.');
  if (!candidate.company.siren) warnings.push('Identité officielle non confirmée : aucun SIREN inventé.');
  if (sources.some(source => !source.collectedAt)) warnings.push('Certaines sources héritées n’ont pas de date de collecte enregistrée ; leur date reste inconnue.');
  const coverage = [
    'HTML public : accueil et jusqu’à deux pages internes de contact/prestations ; JavaScript non exécuté.',
    facts.some(fact => fact.visual)
      ? `Contrôle visuel humain : ${facts.filter(fact => fact.visual).length} observation(s) datée(s), limitée(s) aux éléments et écrans indiqués ; aucun audit visuel exhaustif. Aucun envoi de formulaire ni test de réservation ou de paiement.`
      : 'Aucun audit visuel du design, aucun envoi de formulaire et aucun test de réservation ou de paiement.',
    'PageSpeed : mesures ponctuelles de laboratoire sur la page testée ; elles peuvent varier.',
    'Les recherches décrivent uniquement les requêtes, moteurs et résultats enregistrés ; aucune absence globale n’est déduite.',
    `Pages HTML consultées : ${candidate.html?.pages.length || 0}. Pages PageSpeed testées : ${candidate.mobile?.pages.length || 0}.`,
    `Présentation publique : ${candidate.html?.content?.length || 0} extrait(s) conservé(s), au plus 8 blocs par page et 24 au total, 1 200 caractères par extrait ; navigation, formulaires, pied de page et éléments masqués exclus. Cette collecte n’est pas exhaustive.`,
    'Budget, besoin reconnu, priorité et décisionnaire restent inconnus sans déclaration ou échange documenté.',
  ];
  if (candidate.research?.collectionStatus) coverage.push(candidate.research.collectionStatus);
  const reportId = researchId('report', [candidate.id, candidate.company, candidate.website, sources, facts, contacts, profiles, campaign.targetCity, campaign.targetBusiness, campaign.targetCompanyType, campaign.targetOffer, campaign.targetExclusions, campaign.keywords]);
  const report: ProspectReport = {
    version: 1, id: reportId, generatedAt: new Date().toISOString(), companyName: candidate.company.name,
    summary: `${candidate.company.business || 'Activité à confirmer'} à ${candidate.company.city || 'commune à confirmer'}. ${candidate.website ? 'Site identifié.' : profiles.length ? 'Profil social ou public identifié, site non trouvé.' : 'Présence numérique à vérifier.'} ${facts.length} constat(s) conservé(s). Adéquation à la cible à valider.`,
    sources, facts, contacts, profiles, sections: [], warnings: unique(warnings), coverage, opportunities: [],
    ...(candidate.research?.panel ? { panel: candidate.research.panel } : {}),
  };
  // Every supported observation remains in the dossier. Only the opening approach is selective.
  report.opportunities = supportedOpportunities(report, campaign);
  for (const [key, title] of Object.entries(sectionTitles) as Array<[FactSection | 'method', string]>) {
    const sectionFacts = facts.filter(fact => fact.section === key);
    const notes: string[] = [];
    let status: ProspectReport['sections'][number]['status'] = sectionFacts.length ? 'partial' : 'unverified';
    if (key === 'identity') {
      if (candidate.company.siren && sectionFacts.length) status = 'documented';
      if (!candidate.company.siren) notes.push('Identité provisoire ; aucun SIREN confirmé.');
    } else if (key === 'fit') {
      notes.push(`Cible : ${campaign.targetBusiness} à ${campaign.targetCity}. Offre : ${campaign.targetOffer || 'à préciser'}.`);
      if (campaign.targetExclusions) notes.push(`Exclusions à vérifier : ${campaign.targetExclusions}.`);
      notes.push('Correspondance, critères et contradictions à valider manuellement.');
    } else if (key === 'presence') {
      if (!candidate.website) notes.push(profiles.length ? 'Profil identifié ; site non trouvé, absence non établie.' : 'Présence numérique encore inconnue.');
      if (candidate.websites.length > 1) notes.push('Plusieurs sites proposés : le rattachement nécessite confirmation.');
    } else if (key === 'presentation') notes.push('Prestations, réalisations, clientèle et zone desservie non documentées restent inconnues.');
    else if (key === 'contact') notes.push(contacts.some(contact => ['email', 'phone'].includes(contact.kind)) ? 'Coordonnées publiques disponibles ; valider le canal professionnel.' : 'Email ou téléphone professionnel à trouver.');
    else if (key === 'site') {
      if (!candidate.website) { status = 'not_applicable'; notes.push('Aucun site identifié ; aucun audit de site réalisé.'); }
      else notes.push(...coverage.slice(0, 3));
      if (candidate.htmlError) notes.push(`Analyse HTML indisponible : ${candidate.htmlError}`);
      if (candidate.mobileError) notes.push(`Audit mobile indisponible : ${candidate.mobileError}`);
    } else if (key === 'visibility') {
      if (report.panel) notes.push(`Réponses IA via API : ${report.panel.responses.filter(response => response.valid).length} réponse(s) exploitable(s) sur ${report.panel.responses.length}.`);
      notes.push('Mention, recommandation et citation sont distinctes ; les identités ambiguës restent non déterminées.');
    } else if (key === 'opportunities') {
      if (report.opportunities.length) { status = 'partial'; notes.push(...report.opportunities.map(plan => `${plan.motive} → ${plan.help} Question : ${plan.question}`)); }
      else notes.push('Aucune aide pertinente documentée pour l’offre actuelle. Compléter, conserver pour plus tard ou écarter.');
    } else if (key === 'method') { status = 'documented'; notes.push(...coverage, ...report.warnings); }
    report.sections.push({ key, title, status, factIds: sectionFacts.map(fact => fact.id), notes });
  }
  if (candidate.research?.narrative && validateReportNarrative(candidate.research.narrative, report)) report.narrative = candidate.research.narrative;
  return prospectReportSchema.parse(report) as ProspectReport;
}

/** Compose legacy/manual information with collection without replacing any collected evidence. */
export function enrichCompanyReport(base: ProspectReport | null, company: Company, campaign: Campaign, aiTests: AiTest[] = [], corrections: ResearchCorrection[] = [], activities: Activity[] = []): ProspectReport {
  const internalUrl = `https://brine-iota.vercel.app/prospects/${encodeURIComponent(company.id)}`;
  const report = base ? structuredClone(base) : buildProspectReport({
    id: `manual-${company.id}`, runId: '', companyId: company.id, status: 'review', websites: [], website: company.website,
    company: { siren: '', siret: '', name: company.name, business: company.business, city: company.city, activityCode: '', address: '', sourceUrl: internalUrl },
    html: null, mobile: null, htmlError: '', mobileError: '', attempts: {}, revision: 1,
  }, campaign);
  const manualSource = (key: string, text: string, url = '', date = '') => {
    const source: ResearchSource = { id: researchId('manual-source', [company.id, key, text, url, date]), provider: 'manual', url: url || internalUrl,
      title: url ? 'Preuve renseignée manuellement' : 'Saisie manuelle dans le dossier Brine', excerpt: text, collectedAt: date };
    if (!report.sources.some(item => item.id === source.id)) report.sources.push(source);
    return source.id;
  };
  const addManual = (key: string, section: FactSection, text: string, url = '', date = '', sentiment: ResearchFact['sentiment'] = 'neutral', scope = 'Information saisie manuellement ; la source interne documente la saisie et ne vaut pas une vérification externe.') => {
    if (!text.trim()) return;
    const sourceId = manualSource(key, text, url, date);
    const fact: ResearchFact = { id: researchId('manual-fact', [company.id, key, text, url, date]), section, origin:key.startsWith('exchange-')||key.startsWith('contact-event-')?'exchange':key.startsWith('observation')||key.startsWith('ai-test-')?'manual_observation':'qualification', kind: 'reported', sentiment, text, sourceIds: [sourceId], observedOn: date, scope, ...(url&&date?{review:{state:'confirmed' as const,nature:'observation' as const,provenance:'manual' as const,reviewedAt:date}}:{}) };
    if (!report.facts.some(item => item.id === fact.id || (item.section === section && normalize(item.text) === normalize(text)))) report.facts.push(fact);
  };
  addManual('identity', 'identity', `${company.name} · ${company.business || 'activité à confirmer'} · ${company.city || 'commune à confirmer'}`, '', '', 'neutral');
  addManual('observation', 'site', company.observation, company.proofUrl, company.observedOn, company.problemFound === 'yes' ? 'issue' : 'neutral');
  addManual('trigger', 'fit', company.trigger);
  const qualification = company.qualification;
  if (qualification) {
    const answers = qualification.answers;
    addManual('fit', 'fit', answers.fit.note);
    addManual('problem', 'site', answers.problem.description, answers.problem.proofUrl, answers.problem.observedOn, ['one', 'multiple_or_blocking'].includes(answers.problem.answer) ? 'issue' : 'neutral');
    for (const [index, problem] of answers.problem.distinctProblems.entries()) addManual(`problem-${index}`, 'site', problem, answers.problem.proofUrl, answers.problem.observedOn, 'issue');
    addManual('blocking', 'site', answers.problem.blockingExplanation, answers.problem.proofUrl, answers.problem.observedOn, 'issue');
    addManual('trigger-description', 'fit', answers.trigger.description, researchUrlSchema.safeParse(answers.trigger.source).success ? answers.trigger.source : '', answers.trigger.verifiedOn);
    addManual('trigger-source', 'fit', answers.trigger.source, researchUrlSchema.safeParse(answers.trigger.source).success ? answers.trigger.source : '', answers.trigger.verifiedOn);
    addManual('trigger-relevance', 'fit', answers.trigger.relevance, '', answers.trigger.verifiedOn);
    for (const [index, reference] of answers.references.examples.entries()) addManual(`reference-${index}`, 'presentation', reference, answers.references.sourceUrl, '', 'positive');
    addManual('reference-improvement', 'presentation', answers.references.improvement, answers.references.sourceUrl);
    addManual('access', 'contact', answers.access.channelAssociation);
    for (const [key, observation] of Object.entries(qualification.observations.items)) {
      if (observation.answer === 'unknown' && !observation.notes) continue;
      const text = `${key} — réponse saisie : ${observation.answer}.${observation.notes ? ` ${observation.notes}` : ''}`;
      const section: FactSection = key === 'recentActivity' || key === 'googleReviews' ? 'visibility' : key === 'services' ? 'presentation' : key === 'contact' || key === 'mainAction' ? 'contact' : 'site';
      addManual(`observation-${key}`, section, text, observation.sourceUrl, observation.observedOn,
        observation.answer === 'yes' && key === 'siteSatisfactory' ? 'positive' : 'neutral');
    }
    if (qualification.observations.googleReviewCount !== null) addManual('google-reviews', 'visibility', `${qualification.observations.googleReviewCount} avis Google renseignés ; note : ${qualification.observations.googleRating ?? 'inconnue'}.`);
    addManual('company-size', 'identity', qualification.observations.companySize);
    const exchange = qualification.afterExchange;
    if (exchange.needNote) addManual('exchange-need', 'fit', `${exchange.need === 'confirmed' ? 'Besoin déclaré lors d’un échange consigné' : 'Note de besoin après échange'} : ${exchange.needNote}`);
    for (const [key, text] of Object.entries({ timing: exchange.timingNote, budget: exchange.budgetNote, budgetScope: exchange.budgetScope, decision: exchange.decisionNote, ability: exchange.abilityNote, solution: exchange.solutionNote })) addManual(`exchange-${key}`, 'fit', text);
    if (exchange.need === 'not_recognized') {
      for (const fact of report.facts) if (fact.kind === 'hypothesis') fact.corrected = true;
      report.warnings.push('Le besoin a été déclaré non reconnu après échange. Les hypothèses précédentes sont à revalider.');
    }
  }
  for (const test of aiTests) {
    const text = [`Relevé ${test.tool || 'outil non renseigné'} (${test.interface || 'interface non renseignée'}), période : ${test.period || 'inconnue'}.`,
      `Mode : ${test.mode}. Modèle : ${test.model || 'inconnu'}. Questions : ${test.questions || 'non renseignées'}.`,
      `Réponses exploitables : ${test.validResponses ?? 'inconnues'}. Recommandations : ${test.recommendations ?? 'inconnues'}. Citations : ${test.citations ?? 'inconnues'}.`, test.notes].filter(Boolean).join('\n');
    addManual(`ai-test-${test.id}`, 'visibility', text, test.proofUrl, test.createdAt,
      'neutral', 'Relevé manuel de l’interface indiquée, distinct des réponses IA via API. Les compteurs décrivent uniquement les réponses consignées, jamais une absence générale.');
  }
  // Contact history is preserved in the dossier without invalidating unchanged public proof.
  const contactHistoryIds = new Set<string>();
  for (const event of company.contactEvents || []) {
    const text = `${event.outcome === 'conversation' ? 'Échange consigné' : 'Résultat du contact'} (${event.outcome}) du ${event.date} : ${event.note || 'aucune note'}`;
    contactHistoryIds.add(researchId('manual-fact', [company.id, `contact-event-${event.id}`, text, '', event.date]));
    addManual(`contact-event-${event.id}`, 'fit', text, '', event.date);
  }
  for (const kind of ['email', 'phone', 'formUrl', 'profileUrl'] as const) {
    const value = company.contact[kind];
    if (!value) continue;
    const confirmation = ['email', 'phone'].includes(kind) ? activities.find(activity => {
      if (activity.type !== 'Contact professionnel confirmé') return false;
      const fields = Object.fromEntries(activity.text.split('\n').map(line => { const index = line.indexOf(' : '); return index >= 0 ? [line.slice(0, index), line.slice(index + 3)] : ['', '']; }));
      return fields[kind === 'email' ? 'Email' : 'Téléphone'] === value && !!fields.Source && researchUrlSchema.safeParse(fields.Source).success;
    }) : undefined;
    const confirmationFields = confirmation ? Object.fromEntries(confirmation.text.split('\n').map(line => { const index = line.indexOf(' : '); return index >= 0 ? [line.slice(0, index), line.slice(index + 3)] : ['', '']; })) : undefined;
    const provenance = confirmationFields?.Source || internalUrl, confirmedOn = confirmationFields?.Consultation || '';
    const existing = report.contacts.find(item => contactKey(item) === contactKey({ kind, value, sourceUrl: internalUrl }));
    if (existing && !confirmation) continue;
    const sourceId = manualSource(`contact-${kind}`, value, confirmation ? provenance : '', confirmedOn);
    const contact: ResearchContact = { kind, value, sourceUrl: provenance, sourceId };
    if (researchContactSchema.safeParse(contact).success) { if (existing) Object.assign(existing, contact); else report.contacts.push(contact); }
    addManual(`contact-value-${kind}`, 'contact', `${kind} ${confirmation ? 'confirmé professionnel par l’utilisateur' : 'renseigné'} : ${value}`, confirmation ? provenance : '', confirmedOn);
    if (kind === 'profileUrl' && !report.profiles.includes(value)) report.profiles.push(value);
  }
  if (company.contact.name || company.contact.role) addManual('contact-person', 'contact', `Interlocuteur renseigné : ${company.contact.name || 'identité inconnue'} · ${company.contact.role || 'rôle inconnu'}.`);
  for (const correction of corrections) {
    if (correction.companyId !== company.id) continue;
    const matchesCorrection = (fact: ResearchFact) => {
      if (JSON.stringify([fact.text, fact.observedOn, [...fact.sourceIds].sort()]) === correction.fingerprint) return true;
      // A later audit may reuse a legacy ID. Historical aliases keep the source URL and date.
      try {
        const previous: unknown = JSON.parse(correction.fingerprint);
        if (!Array.isArray(previous) || previous.length !== 3 || previous[0] !== fact.text || previous[1] !== fact.observedOn || !Array.isArray(previous[2])) return false;
        const oldSources = previous[2].map(id => typeof id === 'string' ? report.sources.find(source => source.id === id)?.url : undefined);
        const currentSources = fact.sourceIds.map(id => report.sources.find(source => source.id === id)?.url);
        return oldSources.every(Boolean) && currentSources.every(Boolean) && JSON.stringify([...oldSources].sort()) === JSON.stringify([...currentSources].sort());
      } catch { return false; }
    };
    const fact = report.facts.find(matchesCorrection);
    if (!fact) continue;
    if (correction.mode === 'hypothesis') {
      const sourceId = manualSource(`hypothesis-correction-${correction.id}`, correction.note, '', correction.correctedAt);
      report.facts.push({ id: researchId('hypothesis-refutation', correction.id), section: 'opportunities', kind: 'reported', sentiment: 'neutral', text: `Hypothèse réfutée pour ce constat : ${correction.note}`,
        sourceIds: [sourceId], observedOn: correction.correctedAt, scope: `Le fait initial reste conservé et peut être vrai : ${fact.text}. Seule la conséquence supposée est réfutée.`, refutesFactId: fact.id });
      report.warnings.push(`Conséquence supposée réfutée : ${correction.note}. Le fait observé reste conservé.`);
    } else {
      fact.corrected = true;
      addManual(`correction-${correction.id}`, fact.section, `Correction du constat « ${fact.text} » : ${correction.note}`, '', correction.correctedAt,
        'neutral', 'Correction documentée par l’utilisateur ; le constat initial reste conservé dans l’historique et ne peut plus servir de motif.');
      report.warnings.push(`Constat corrigé : ${correction.note}`);
    }
  }
  report.companyName = company.name;
  const identityFacts = report.facts.filter(fact => !contactHistoryIds.has(fact.id));
  const historyOnlySources = new Set(report.facts.filter(fact => contactHistoryIds.has(fact.id)).flatMap(fact => fact.sourceIds));
  for (const fact of identityFacts) for (const id of fact.sourceIds) historyOnlySources.delete(id);
  report.id = researchId('report', [base?.id, company.id, company.name, company.website, company.business, company.city, identityFacts, report.sources.filter(source => !historyOnlySources.has(source.id)), report.contacts,
    campaign.targetCity, campaign.targetBusiness, campaign.targetCompanyType, campaign.targetOffer, campaign.targetExclusions, campaign.keywords]);
  report.generatedAt = new Date().toISOString();
  report.opportunities = supportedOpportunities(report, campaign);
  report.warnings = unique(report.warnings);
  if (corrections.some(correction => correction.companyId === company.id) && report.narrative) delete report.narrative;
  for (const section of report.sections) {
    section.factIds = report.facts.filter(fact => fact.section === section.key).map(fact => fact.id);
    if (section.factIds.length && section.status === 'unverified') section.status = 'partial';
    if (section.key === 'opportunities') {
      section.status = report.opportunities.length ? 'partial' : 'unverified';
      section.notes = report.opportunities.length ? report.opportunities.map(plan => `${plan.motive} → ${plan.help} Question : ${plan.question}`) : ['Aucune aide pertinente documentée pour l’offre actuelle.'];
    }
  }
  report.summary = `${company.business || 'Activité à confirmer'} à ${company.city || 'commune à confirmer'}. ${company.website ? 'Site identifié.' : report.profiles.length ? 'Profil identifié, site non trouvé.' : 'Présence numérique à vérifier.'} ${report.facts.length} constat(s) conservé(s). Adéquation à la cible à valider.`;
  return prospectReportSchema.parse(report) as ProspectReport;
}

/** Newest report first: old audits remain visible instead of disappearing on refresh. */
export function mergeCandidateReports(reports: ProspectReport[], campaign: Campaign): ProspectReport | null {
  if (!reports.length) return null;
  if (reports.length === 1) return structuredClone(reports[0]);
  const result = structuredClone(reports[0]);
  const sources = new Map(result.sources.map(source => [source.id, source]));
  const facts = new Map(result.facts.map(fact => [fact.id, fact]));
  const signature = (fact: ResearchFact) => JSON.stringify([fact.section, fact.kind, normalize(fact.text), normalize(fact.scope), fact.observedOn,
    fact.sourceIds.map(id => sources.get(id)).filter(Boolean).map(source => `${source!.url}|${source!.collectedAt}`).sort(), fact.corrected || false, fact.visual || null]);
  const signatures = new Set(result.facts.map(signature));
  const contacts = new Set(result.contacts.map(contactKey));
  for (const report of reports.slice(1)) {
    const sourceRemap = new Map<string, string>();
    for (const source of report.sources) {
      const previous = sources.get(source.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(source)) {
        const historyId = researchId('history-source', source);
        sourceRemap.set(source.id, historyId); sources.set(historyId, { ...source, id: historyId });
      } else sources.set(source.id, source);
    }
    for (const original of report.facts) {
      const fact = { ...original, sourceIds: original.sourceIds.map(id => sourceRemap.get(id) || id) };
      const key = signature(fact);
      if (signatures.has(key)) continue;
      if (facts.has(fact.id)) fact.id = researchId('history-fact', key);
      signatures.add(key); facts.set(fact.id, fact);
    }
    for (const contact of report.contacts) {
      const key = contactKey(contact);
      if (contacts.has(key)) continue;
      contacts.add(key); result.contacts.push({ ...contact, ...(contact.sourceId ? { sourceId: sourceRemap.get(contact.sourceId) || contact.sourceId } : {}) });
    }
    result.profiles = unique([...result.profiles, ...report.profiles]);
    result.coverage = unique([...result.coverage, ...report.coverage]);
    result.warnings = unique([...result.warnings, ...report.warnings]);
    // Keep every historical panel answer in proof sources even when the panel widget shows the newest panel.
    if (report.panel && report.panel.id !== result.panel?.id) {
      for (const [index, response] of report.panel.responses.entries()) {
        const url = report.sources.find(source => source.provider === 'openrouter' && source.title.includes('réponses API'))?.url || 'https://brine-iota.vercel.app/campagnes';
        const content = `${response.model} · ${response.engine}\n${response.answer || response.error || 'Réponse indisponible'}`;
        for (let offset = 0; offset < content.length; offset += 12000) {
          const source: ResearchSource = { id: researchId('history-panel-source', [report.panel.id, index, offset]), provider: 'openrouter', url,
            title: `Relevé API antérieur : ${response.question}`.slice(0, 480) + (content.length > 12000 ? ` (partie ${Math.floor(offset / 12000) + 1})` : ''),
            excerpt: content.slice(offset, offset + 12000), collectedAt: response.recordedAt };
          sources.set(source.id, source);
        }
      }
    }
  }
  result.sources = [...sources.values()]; result.facts = [...facts.values()];
  result.id = researchId('report-history', [reports.map(report => report.id), result.sources, result.facts, result.contacts,
    campaign.targetCity, campaign.targetBusiness, campaign.targetCompanyType, campaign.targetOffer, campaign.targetExclusions, campaign.keywords]);
  result.generatedAt = new Date().toISOString();
  result.opportunities = [];
  result.coverage.push(`${reports.length} dossiers de collecte réunis ; les mesures anciennes restent datées et peuvent nécessiter une nouvelle vérification.`);
  for (const section of result.sections) {
    section.factIds = result.facts.filter(fact => fact.section === section.key).map(fact => fact.id);
    section.notes = unique(reports.flatMap(report => report.sections.find(item => item.key === section.key)?.notes || []));
    if (section.factIds.length && ['unverified', 'not_applicable'].includes(section.status)) section.status = 'partial';
  }
  result.summary = `${result.companyName} : ${result.facts.length} constat(s) conservé(s) dans ${reports.length} collectes datées. Vérifiez la pertinence actuelle des mesures avant de contacter.`;
  delete result.narrative;
  return prospectReportSchema.parse(result) as ProspectReport;
}
