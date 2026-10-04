import type { Campaign } from './campaign-types';
import { createApproachPlan, getEligibleApproachEvidence } from './contact-preparation';
import type { ProspectReport, ProviderProfile, ResearchContact, ResearchFact, ResearchSource, VisualEvidence } from './research-types';

export type InsightCategory = 'stated_need' | 'contact_access' | 'visual' | 'mobile' | 'loading' | 'indexing' | 'change' | 'presentation' | 'social' | 'search_presence';
export interface ProspectInsight {
  id: string;
  category: InsightCategory;
  title: string;
  observation: string;
  /** Complete observations and references remain available even when the opening excerpt is short. */
  supportingObservations: string[];
  evidenceIds: string[];
  sourceIds: string[];
  sources: ResearchSource[];
  observedOn: string;
  scope: string;
  confidence: 'observed' | 'reported';
  priority: 'high' | 'medium' | 'context';
  possibleEffect: string | null;
  proportionateHelp: string | null;
  question: string | null;
  eligibleForApproach: boolean;
  visualEvidence: VisualEvidence[];
}
export interface ProspectIdentityInput { name?: string; business?: string; city?: string; website?: string }
export interface ProspectInsights {
  identity: { name: string; activity: string; location: string; website: string; profiles: string[]; contacts: ResearchContact[] };
  offer: { status: 'missing' | 'ready' | 'unrelated'; text: string; message: string };
  highlights: ProspectInsight[];
  otherInsights: ProspectInsight[];
  positives: ProspectInsight[];
  unknowns: string[];
  nextAction: { kind: 'complete_offer' | 'review_finding' | 'inspect_site' | 'discover_need'; label: string; explanation: string };
  totalFacts: number;
  prioritizedCount: number;
}

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const unique = <T,>(values: T[]): T[] => [...new Set(values)];
const webOfferPattern = /site|web|developp|application|refonte|mobile|interface|numerique|digital|seo|devis|contact|vitrine|presentation|prestations|chargement|performance|accessib|conversion|visibilite/;
const urlPattern = /https?:\/\/[^\s<>"«»]+/gi;
const socialPattern = /(?:^|\.)(?:instagram\.com|facebook\.com|linkedin\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com)$/i;
function publicUrl(value: string): string {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function websiteFrom(report: ProspectReport, identity: ProspectIdentityInput): string {
  const given = publicUrl(identity.website || '');
  if (given) return given;
  for (const fact of report.facts) {
    if (fact.corrected || fact.kind === 'hypothesis' || fact.section !== 'presence' || !/site identifi[eé]/i.test(fact.text)) continue;
    for (const match of fact.text.matchAll(urlPattern)) {
      const url = publicUrl(match[0].replace(/[.,;)]$/, ''));
      if (url && !socialPattern.test(new URL(url).hostname)) return url;
    }
  }
  return '';
}
function excerpt(text: string, maximum = 300): string {
  const compact = text.trim().replace(/\s+/g, ' ');
  if (compact.length <= maximum) return compact;
  const prefix = compact.slice(0, maximum), boundary = prefix.lastIndexOf(' ');
  return compact.slice(0, boundary > maximum / 2 ? boundary : maximum).trimEnd() + '…';
}
function solelyCoordinate(fact: ResearchFact): boolean {
  const text = normalize(fact.text);
  return /^(?:email|telephone|formulaire repere|profil professionnel|site identifie|profil public identifie)\s*:/.test(text)
    || /^(?:https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,})\S*$/.test(text)
    || /^[+\d\s().-]+$/.test(text)
    || /^\d+ moyen\(s\) de contact publie\(s\) detecte\(s\)/.test(text)
    || /^(?:lien d.action detecte|lien de prestations detecte)\s*:/.test(text);
}
function hasDocumentedChange(text: string): boolean {
  const event = /\b(?:ouverture|reouverture|nouvelle activite|nouveau service|nouvelle prestation|recrut(?:e|ent|ement)|demenagement|changement (?:d['’]adresse|de locaux|d['’]activite|de services?))\b/.test(text);
  const date = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{4}\b|\b(?:\d{1,2}(?:er)?\s+)?(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+\d{4}\b/.test(text);
  return event && date && !/\b(?:aucune?|pas de|sans) (?:nouvelle activite|ouverture|reouverture|recrutement|demenagement|changement)\b/.test(text);
}
function hasExpressedNeed(text: string): boolean {
  const normalized = normalize(text);
  return /besoin (?:exprime|declare)|demande explicite/.test(normalized)
    && !/besoin non reconnu|(?:aucun|pas de|sans) besoin|(?:aucune|pas de|sans) demande explicite/.test(normalized);
}
type Classification = { category: InsightCategory; title: string; priority: ProspectInsight['priority']; effect: string | null; help: string | null; question: string | null; group?: string };
function hasVisualProof(fact: ResearchFact): boolean {
  if (fact.kind !== 'observed') return false;
  if (fact.visual && publicUrl(fact.visual.pageUrl) && fact.visual.element.trim()) return true;
  const scope = normalize(fact.scope);
  if (/(?:aucun|sans|pas (?:d['’]|de ))\s*(?:audit|controle|verification) visuel/.test(scope)) return false;
  return /(?:rendu|capture|navigateur).*(?:visuel|ecran)|(?:audit|controle|verification) visuel/.test(scope);
}
function classify(fact: ResearchFact): Classification | null {
  if (solelyCoordinate(fact)) return null;
  const text = normalize(fact.text), issue = fact.sentiment === 'issue', observed = fact.kind === 'observed';
  if (['fit', 'presentation'].includes(fact.section) && hasExpressedNeed(fact.text)) return {
    category: 'stated_need', title: 'Un besoin exprimé à préciser', priority: 'high', effect: 'Le besoin rapporté donne un point de départ ; son périmètre et sa priorité restent à confirmer avec l’entreprise.', help: null, question: null,
  };
  if (issue && fact.visual && fact.visual.category !== 'other') {
    const portfolio = /realisation|projet|chantier|avant.?apres|compar(?:er|ateur|aison)|photo/.test(normalize(fact.visual.element + ' ' + fact.text));
    const interaction = fact.visual.category === 'interaction';
    return { category: 'visual', title: interaction ? 'Une interaction du site ne fonctionne pas comme prévu' : portfolio ? 'Un élément gêne la lecture des réalisations' : fact.visual.category === 'broken_image' ? 'Une image ne s’affiche pas correctement' : 'Un élément gêne la lecture ou l’utilisation du site', priority: hasVisualProof(fact) ? 'high' : 'medium',
      effect: interaction ? 'Si ce comportement se reproduit, il peut empêcher d’utiliser cet élément comme prévu. Son impact sur le parcours réel reste à confirmer.' : portfolio ? 'Si ce rendu se reproduit, il peut rendre les réalisations moins faciles à examiner et donner une impression de finition incomplète. Le ressenti des visiteurs reste inconnu.' : 'Si ce rendu se reproduit, il peut gêner la lecture ou l’usage de l’élément concerné. Son impact réel reste à confirmer.',
      help: interaction ? 'Reproduire le comportement de cet élément, puis corriger cette interaction si le défaut se confirme.' : 'Reproduire le défaut sur la page et la taille d’écran concernées, puis corriger l’affichage de cet élément.', question: portfolio ? 'Comment souhaitez-vous que les visiteurs découvrent et comparent vos réalisations ?' : 'Quel parcours est le plus important pour les visiteurs de cette page ?', group: `visual:${fact.visual.category}:${fact.visual.pageUrl}:${normalize(fact.visual.element)}:${fact.visual.device}` };
  }
  if (issue && ['site', 'contact'].includes(fact.section) && /(?:\b(?:404|410|5\d\d)\b|reponse http non reussie|lien (?:casse|inaccessible)|(?:bouton|lien|acces).*(?:ne fonctionne|sans effet))/.test(text)) {
    const quote = /«([^»]+)»/.exec(fact.text)?.[1];
    const usage = /devis|contact|reservation|rdv|rendez.vous/.test(text) ? 'contact' : /realisations|projets|chantier/.test(text) ? 'portfolio' : /accueil/.test(text) ? 'homepage' : 'page';
    return { category: 'contact_access', title: usage === 'contact' ? 'Un accès à la prise de contact échoue' : usage === 'portfolio' ? 'Un accès aux réalisations échoue' : usage === 'homepage' ? 'L’accueil du site ne répond pas normalement' : quote ? `L’accès « ${excerpt(quote, 65)} » échoue` : 'Un accès du site échoue', priority: observed ? 'high' : 'medium',
      effect: usage === 'contact' ? 'Si cette erreur se reproduit pour les visiteurs, elle peut empêcher une demande par cet accès. Les autres canaux et l’impact réel restent à vérifier.' : usage === 'portfolio' ? 'Si cette erreur se reproduit, elle peut empêcher de consulter ces réalisations ; aucune perte de clients n’est déduite.' : 'Si cette erreur se reproduit, elle peut empêcher de consulter cette page. La cause et l’impact réel restent à vérifier.',
      help: 'Vérifier l’accès concerné et corriger ce lien ou cette page si le défaut se confirme.', question: usage === 'contact' ? 'Quel canal souhaitez-vous privilégier pour recevoir les nouvelles demandes ?' : 'Quelles informations voulez-vous rendre accessibles en priorité aux personnes qui découvrent votre activité ?', group: `access:${usage}:${quote ? normalize(quote) : 'page'}` };
  }
  // A concrete obstruction or broken element is required. A taste judgement ("site daté") is not a diagnosis.
  if (issue && ['site', 'presentation', 'contact'].includes(fact.section) && /(?:masqu|recouvr|chevauch|superpos|tronqu|illisib|debord|coupe(?:s|e|es)?|image.*(?:cassee|absente)|(?:texte|bouton).*(?:invisible|hors.*ecran))/.test(text)) {
    const portfolio = /realisation|projet|chantier|avant.?apres|compar(?:er|ateur|aison)|photo/.test(text);
    return { category: 'visual', title: portfolio ? 'Un élément gêne la lecture des réalisations' : 'Un élément gêne la lecture ou l’utilisation du site', priority: hasVisualProof(fact) ? 'high' : 'medium',
      effect: portfolio ? 'Si ce rendu se reproduit, il peut rendre les réalisations moins faciles à examiner et donner une impression de finition incomplète. Le ressenti des visiteurs reste inconnu.' : 'Si ce rendu se reproduit, il peut gêner la lecture ou l’usage de l’élément concerné. Son impact réel reste à confirmer.',
      help: 'Reproduire le défaut sur la page et la taille d’écran concernées, puis corriger l’affichage de cet élément.', question: portfolio ? 'Comment souhaitez-vous que les visiteurs découvrent et comparent vos réalisations ?' : 'Quel parcours est le plus important pour les visiteurs de cette page ?', group: `visual:${portfolio ? 'portfolio' : 'other'}:${normalize(fact.text).replace(/\b\d+(?:[.,]\d+)?(?:\s*(?:px|%))?\b/g, '#')}` };
  }
  if (issue && /lcp|chargement|lenteur|performance/.test(text) && /\b\d+(?:[.,]\d+)?\s*(?:ms|secondes?|s)\b|lenteur (?:mesuree|observee)|chargement.*(?:bloque|echoue)/.test(text)) return {
    category: 'loading', title: 'Le chargement mesuré mérite une vérification', priority: 'medium', effect: 'Un chargement lent peut retarder la consultation des informations si la mesure se reproduit dans des conditions représentatives. Un test de laboratoire ne décrit pas tous les visiteurs.', help: 'Reproduire la mesure sur les pages utiles et cibler les causes du chargement avant d’envisager une intervention.', question: 'Quelles informations les visiteurs doivent-ils pouvoir consulter rapidement ?',
  };
  if (issue && /contraste|contrast|taille.*(?:cible|bouton)|target.size|touch.target/.test(text)) return {
    category: 'mobile', title: /contraste|contrast/.test(text) ? 'La lisibilité de certains textes est à vérifier' : 'L’utilisation de certains boutons est à vérifier', priority: 'medium',
    effect: /contraste|contrast/.test(text) ? 'Un contraste insuffisant peut gêner la lecture de ces textes. Le contrôle porte sur les éléments relevés et leur rendu reste à examiner.' : 'Des boutons trop petits ou trop proches peuvent compliquer leur utilisation sur téléphone. Les éléments relevés restent à examiner.',
    help: /contraste|contrast/.test(text) ? 'Examiner les textes concernés et ajuster leur contraste si le défaut se confirme.' : 'Examiner les boutons concernés sur téléphone et ajuster leur taille ou leur espacement si le défaut se confirme.', question: 'Quels éléments doivent être les plus faciles à lire et à utiliser sur cette page ?',
  };
  if (issue && /viewport|zoom|mobile|accessib/.test(text)) return {
    category: 'mobile', title: /zoom/.test(text) ? 'Le zoom sur téléphone est à vérifier' : 'L’utilisation sur téléphone est à vérifier', priority: 'medium', effect: 'Cette configuration peut gêner la lecture sur téléphone ; elle ne démontre pas à elle seule un mauvais rendu mobile.', help: 'Tester la page sur téléphone et corriger ce point précis si la gêne est confirmée.', question: 'Que souhaitez-vous que les visiteurs puissent faire facilement depuis leur téléphone ?',
  };
  if (issue && /indexation|exploration|robots/.test(text)) return {
    category: 'indexing', title: 'Une consigne d’indexation est à confirmer', priority: 'medium', effect: 'Cette consigne peut limiter l’indexation de cette page, mais elle peut aussi être volontaire. L’objectif de visibilité reste à confirmer.', help: 'Vérifier si cette page doit être indexable avant de modifier cette consigne.', question: 'Quelles pages souhaitez-vous faire découvrir dans les recherches ?',
  };
  if (['fit', 'presentation'].includes(fact.section) && hasDocumentedChange(text)) return {
    category: 'change', title: 'Une évolution datée de l’activité', priority: 'medium', effect: 'Cette évolution peut nécessiter de mettre à jour la présentation de l’activité ; aucun besoin de refonte n’est déduit.', help: null, question: null,
  };
  if (fact.section === 'presence' && /instagram|facebook|profil social|linkedin/.test(text)) return {
    category: 'social', title: 'Une présence sociale à comprendre', priority: 'context', effect: 'Ce profil donne un point d’entrée sur l’activité. Il ne démontre ni l’absence d’un site ni un manque de clients.', help: null, question: null,
  };
  if (fact.section === 'presentation' || fact.section === 'fit' && /prestations|realisations|services|interventions/.test(text)) {
    if (issue && /(?:date|vieillot|ancien|moderne|professionnel)/.test(text) && !/masqu|chevauch|illisib|404/.test(text)) return null;
    return { category: 'presentation', title: /realisation|projet|chantier/.test(text) ? 'Des réalisations à découvrir' : 'Les prestations présentées par l’entreprise', priority: 'context', effect: null, help: null, question: null };
  }
  if (fact.section === 'visibility') return {
    category: 'search_presence', title: 'Un relevé de recherches limité', priority: 'context', effect: 'Ce relevé concerne uniquement les requêtes et réponses enregistrées. Il ne permet pas de conclure à une absence générale ni à une perte de clients.', help: null, question: null,
  };
  return null;
}

/** Opening business view only: pure, current-offer aware, and never mutates or reduces the complete dossier. */
export function buildProspectInsights(report: ProspectReport, campaign: Campaign, profile: ProviderProfile, identity: ProspectIdentityInput = {}): ProspectInsights {
  const sourcesById = new Map(report.sources.map(source => [source.id, source]));
  const validFacts = report.facts.filter(fact => !fact.corrected && fact.kind !== 'hypothesis' && fact.sourceIds.length && fact.sourceIds.every(id => sourcesById.has(id)));
  const offerText = [campaign.targetOffer?.trim(), profile.services.trim(), profile.skills.trim()].filter(Boolean).join(' · ');
  const eligibleIds = new Set(getEligibleApproachEvidence(report, campaign, profile).map(fact => fact.id));
  const supportsWeb = webOfferPattern.test(normalize(offerText));
  const groups = new Map<string, { insight: ProspectInsight; order: number }>();
  for (const [order, fact] of validFacts.entries()) {
    const description = classify(fact);
    if (!description) continue;
    const key = description.group || `${description.category}:${normalize(fact.text).replace(/[«»“”".,;:!?]/g, '')}`;
    const existing = groups.get(key);
    if (existing) {
      const item = existing.insight;
      item.evidenceIds = unique([...item.evidenceIds, fact.id]);
      item.sourceIds = unique([...item.sourceIds, ...fact.sourceIds]);
      item.sources = item.sourceIds.map(id => sourcesById.get(id)!);
      item.supportingObservations = unique([...item.supportingObservations, fact.text]);
      if (fact.visual && !item.visualEvidence.some(item => JSON.stringify(item) === JSON.stringify(fact.visual))) item.visualEvidence.push({ ...fact.visual });
      if (fact.observedOn > item.observedOn) item.observedOn = fact.observedOn;
      item.scope = unique([item.scope, fact.scope].filter(Boolean)).join(' ');
      item.eligibleForApproach ||= eligibleIds.has(fact.id);
      if (fact.kind === 'observed') item.confidence = 'observed';
      if (description.priority === 'high' && item.priority === 'medium') item.priority = 'high';
      continue;
    }
    let plan: ReturnType<typeof createApproachPlan> | null = null;
    if (eligibleIds.has(fact.id)) { try { plan = createApproachPlan(report, campaign, profile, [fact.id]); } catch { /* The view can show a fact without making it a contact motive. */ } }
    const refutation = report.facts.find(item => item.refutesFactId === fact.id && !item.corrected);
    const insight: ProspectInsight = {
      id: `insight:${fact.id}`, category: description.category, title: description.title, observation: excerpt(fact.text), supportingObservations: [fact.text], evidenceIds: [fact.id], sourceIds: [...fact.sourceIds], sources: fact.sourceIds.map(id => sourcesById.get(id)!), observedOn: fact.observedOn, scope: fact.scope, confidence: fact.kind as 'observed' | 'reported', priority: refutation ? 'context' : description.priority,
      possibleEffect: refutation ? `Cette conséquence a été réfutée : ${refutation.text}. Aucun impact n’est déduit du constat conservé.` : description.effect || plan?.hypothesis || null,
      proportionateHelp: plan?.help || (supportsWeb && description.help ? description.help : null), question: plan?.question || (supportsWeb ? description.question : null), eligibleForApproach: eligibleIds.has(fact.id),
      visualEvidence: fact.visual ? [{ ...fact.visual }] : [],
    };
    groups.set(key, { insight, order });
  }
  const priorityOrder = { high: 0, medium: 1, context: 2 }, confidenceOrder = { observed: 0, reported: 1 };
  const ordered = [...groups.values()].sort((a, b) => priorityOrder[a.insight.priority] - priorityOrder[b.insight.priority] || Number(b.insight.category === 'stated_need') - Number(a.insight.category === 'stated_need') || confidenceOrder[a.insight.confidence] - confidenceOrder[b.insight.confidence] || a.order - b.order).map(item => item.insight);
  const positiveIds = new Set(validFacts.filter(fact => fact.sentiment === 'positive').map(fact => fact.id));
  const positives = ordered.filter(item => item.priority === 'context' && item.evidenceIds.every(id => positiveIds.has(id)));
  const main = ordered.filter(item => !positives.includes(item));
  const website = websiteFrom(report, identity);
  const contacts = report.contacts.filter(contact => contact.value && publicUrl(contact.sourceUrl)).filter((contact, index, all) => all.findIndex(other => other.kind === contact.kind && normalize(other.value) === normalize(contact.value)) === index).map(contact => ({ ...contact }));
  const profiles = unique([...report.profiles.map(publicUrl).filter(Boolean), ...contacts.filter(contact => contact.kind === 'profileUrl').map(contact => contact.value)]);
  const unknowns: string[] = [];
  if (!validFacts.some(fact => hasExpressedNeed(fact.text))) unknowns.push('Leur besoin et leur priorité restent à découvrir avec eux.');
  if (!contacts.some(contact => ['email', 'phone'].includes(contact.kind))) unknowns.push('Aucun email ou téléphone professionnel documenté dans ce dossier.');
  if (!website) unknowns.push(profiles.length ? 'Un profil public est identifié ; aucun site n’a été confirmé dans ce dossier.' : 'Leur présence en ligne reste à préciser.');
  if (website && !validFacts.some(hasVisualProof)) unknowns.push('Le rendu visuel du site reste à vérifier ; le HTML seul ne montre pas les erreurs d’affichage.');
  if (validFacts.some(fact => !fact.observedOn)) unknowns.push('La date de certains constats est inconnue.');
  if (offerText && !eligibleIds.size) unknowns.push('Aucun motif adapté à votre offre n’est encore confirmé ; leurs besoins restent à découvrir.');
  const offerStatus = !offerText ? 'missing' : !supportsWeb && main.some(item => item.priority !== 'context') && !eligibleIds.size ? 'unrelated' : 'ready';
  const offerMessage = offerStatus === 'missing' ? 'Votre offre n’est pas renseignée. Précisez ce que vous pouvez aider à améliorer pour préparer une approche adaptée.' : offerStatus === 'unrelated' ? 'Les constats sont conservés, mais leur lien avec votre offre actuelle n’est pas documenté. Confirmez votre offre avant de proposer une intervention.' : eligibleIds.size ? 'Les aides proposées utilisent votre offre actuelle ; leur utilité doit être confirmée avec l’entreprise.' : 'Votre offre est renseignée. Le lien avec un besoin de cette entreprise reste à découvrir ; aucune conclusion commerciale n’est tirée du dossier.';
  const actionable = main.find(item => item.eligibleForApproach && item.priority !== 'context');
  const nextAction: ProspectInsights['nextAction'] = offerStatus === 'missing' ? { kind: 'complete_offer', label: 'Préciser mon offre', explanation: 'Le dossier est disponible. Il manque ce que vous proposez pour choisir une aide pertinente.' }
    : actionable ? { kind: 'review_finding', label: 'Vérifier ce point et choisir mon approche', explanation: 'Commencez par le constat prioritaire et sa preuve ; confirmez ensuite le motif de votre premier contact.' }
      : website && !main.some(item => item.category === 'visual') ? { kind: 'inspect_site', label: 'Examiner le site', explanation: 'Aucune anomalie exploitable n’est confirmée dans ce dossier. Regardez les pages utiles et consignez un fait concret si vous en trouvez un.' }
        : { kind: 'discover_need', label: 'Découvrir leur fonctionnement', explanation: 'Les informations disponibles permettent de poser une question exploratoire. Elles ne démontrent pas un besoin d’achat.' };
  return { identity: { name: identity.name?.trim() || report.companyName, activity: identity.business?.trim() || 'Activité à confirmer', location: identity.city?.trim() || 'Implantation à confirmer', website, profiles, contacts }, offer: { status: offerStatus, text: offerText, message: offerMessage }, highlights: main.slice(0, 5), otherInsights: main.slice(5), positives, unknowns, nextAction, totalFacts: report.facts.length, prioritizedCount: main.length + positives.length };
}
