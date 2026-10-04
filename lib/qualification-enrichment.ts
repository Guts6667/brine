import { z } from 'zod';
import { emptyQualification, QUALIFICATION_RULES, qualificationInputSchema } from './qualification';
import type { CriterionKey, QualificationAnswers, QualificationData } from './qualification-types';
import type { Campaign } from './campaign-types';
import type { ProspectReport, ResearchFact } from './research-types';

export const criterionKeys = ['fit', 'problem', 'trigger', 'references', 'access'] as const;
export interface QualificationSuggestion {
  id: string; criterion: CriterionKey; answer: string; points: number | null;
  evidenceIds: string[]; rationale: string; proposedAt: string; targetRevision: number;
  state: 'proposed' | 'accepted' | 'rejected'; response: QualificationAnswers[CriterionKey];
}
export interface QualificationEnrichment {
  decisions: Record<string, 'accepted' | 'rejected'>;
  evidence: Partial<Record<CriterionKey, string[]>>;
  revalidate?: CriterionKey[];
}
export const qualificationEnrichmentSchema = z.object({
  decisions: z.record(z.string().max(180), z.enum(['accepted', 'rejected'])),
  evidence: z.object(Object.fromEntries(criterionKeys.map(key => [key, z.array(z.string().max(180)).max(50).optional()]))).strict(),
  revalidate: z.array(z.enum(criterionKeys)).max(5).optional(),
}).strict();
export function emptyEnrichment(): QualificationEnrichment { return { decisions: {}, evidence: {} }; }
export function isConfirmedFact(fact: ResearchFact): boolean {
  return !fact.corrected && fact.review?.state === 'confirmed';
}
/** An unavailable AI control belongs in the full dossier, not the decision list. */
export function qualificationListFindings(report: ProspectReport): ResearchFact[] {
  return report.panel && !report.panel.responses.some(response => response.valid)
    ? report.facts.filter(fact => !fact.id.startsWith('panel-fact-'))
    : report.facts;
}
function key(value: unknown) { let hash = 2166136261; for (const c of JSON.stringify(value)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619); return (hash >>> 0).toString(16); }
/** Suggestions never mutate the existing score: only explicit acceptance writes an answer. */
export function proposeQualification(report: ProspectReport, campaign: Campaign, enrichment = emptyEnrichment()): QualificationSuggestion[] {
  const facts = report.facts.filter(f => f.origin!=='qualification'&&f.origin!=='exchange'&&!f.corrected && f.review?.state !== 'rejected' && (f.kind !== 'hypothesis' || (f.review?.provenance === 'vision' && Boolean(f.visual?.assetId || f.visual?.screenshot))));
  const result: QualificationSuggestion[] = [];
  const add = (criterion: CriterionKey, response: QualificationAnswers[CriterionKey], evidence: ResearchFact[], rationale: string) => {
    if (!evidence.length) return;
    const answer = response.answer, option = QUALIFICATION_RULES.criteria[criterion].options.find(o => o.value === answer);
    const id = `suggestion-${key([criterion, response, evidence.map(f => [f.id, f.text, f.observedOn]), campaign.revision])}`;
    result.push({ id, criterion, answer, response, points: option?.points ?? null, evidenceIds: evidence.map(f => f.id), rationale, targetRevision: campaign.revision, proposedAt: report.generatedAt, state: enrichment.decisions[id] || 'proposed' });
  };
  const base = emptyQualification().answers;
  const issues = facts.filter(f => f.sentiment === 'issue' && ['site', 'contact'].includes(f.section));
  // Different wording of the same observed element is not another problem.
  const distinct = [...new Map(issues.map(f => [f.visual ? `${f.visual.pageUrl}:${f.visual.category}:${f.visual.element.trim().toLocaleLowerCase('fr')}` : f.text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr'), f])).values()];
  if (distinct.length) {
    const chosen = distinct.slice(0, 5), first = chosen[0], source = report.sources.find(s => first.sourceIds.includes(s.id));
    add('problem', { ...base.problem, answer: chosen.length > 1 ? 'multiple_or_blocking' : 'one', description: first.text, observedOn: first.observedOn.slice(0, 10), proofUrl: source?.url || '', majorReason: chosen.length > 1 ? 'multiple' : 'unknown', distinctProblems: chosen.length > 1 ? chosen.map(f => f.text) : [] }, chosen, 'Problème proposé à partir de constats sourcés. Confirmez chaque constat et sa pertinence avant d’attribuer les points.');
  }
  // A paragraph mentioning projects is not an identifiable project or a reference.
  const examples = facts.filter(f=>f.section==='presentation').flatMap(f=>{
    const titles=f.text.split('\n').map(line=>line.trim()).filter(line=>/^(?:rénovation (?:de |du |d['’])|chantier (?:de |du |d['’])|projet\s*[:–—]|réalisation\s*[:–—]|cas (?:client|d['’]étude)\s*[:–—]).{4,100}$/i.test(line)&&!/risque|comment|pourquoi|devis|vos projets|nos projets/i.test(line));
    return titles.map(title=>({title,fact:f}));
  });
  const references=[...new Map(examples.map(example=>[example.title.toLocaleLowerCase('fr'),example])).values()].slice(0,3);
  if(references.length)add('references',{...base.references,answer:references.length>1?'multiple':'one',examples:references.map(example=>example.title),sourceUrl:report.sources.find(s=>references[0].fact.sourceIds.includes(s.id))?.url||'',improvement:''},[...new Map(references.map(example=>[example.fact.id,example.fact])).values()],'Exemples nommés repérés dans les pages consultées. Vérifiez qu’ils décrivent des réalisations réelles distinctes et précisez l’amélioration de présentation.');
  const contactFacts = facts.filter(f => f.section === 'contact');
  if (report.contacts.length && contactFacts.length) add('access', { ...base.access, answer: 'generic', channelAssociation: 'Coordonnée publique associée à l’entreprise ; interlocuteur et délivrabilité non vérifiés.' }, contactFacts.slice(0, 2), 'Canal générique proposé ; aucun décideur n’est déduit de cette coordonnée.');
  // Fit and trigger require an actual human judgment or documented event. No invented proposal.
  return result;
}
export function applyQualificationSuggestion(qualification: QualificationData, suggestion: QualificationSuggestion): QualificationData {
  const answers = qualificationInputSchema.parse({ answers: { ...qualification.answers, [suggestion.criterion]: suggestion.response } }).answers;
  return { ...qualification, answers };
}
