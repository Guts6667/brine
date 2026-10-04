import type { Contact } from './types';

export type FitAnswer = 'exact' | 'partial' | 'none' | 'unknown';
export type ProblemAnswer = 'multiple_or_blocking' | 'one' | 'none' | 'unknown';
export type TriggerAnswer = 'explicit' | 'recent_change' | 'none' | 'unknown';
export type ReferencesAnswer = 'multiple' | 'one' | 'none' | 'unknown';
export type AccessAnswer = 'decision_maker' | 'generic' | 'none' | 'unknown';
export type CriterionKey = 'fit' | 'problem' | 'trigger' | 'references' | 'access';
export type QualificationRuleSetId = 'pickles-v1';

export interface TargetSnapshot {
  targetCity: string;
  targetBusiness: string;
  targetCompanyType: string;
  targetOffer: string;
  targetExclusions: string;
}
export interface QualificationTarget {
  targetCity: string;
  targetBusiness: string;
  targetCompanyType?: string;
  targetOffer?: string;
  targetExclusions?: string;
}

// These keys describe manually recorded facts. They never assign score points.
export const manualObservationKeys = ['siteAge', 'mobile', 'mainAction', 'services', 'contact', 'googleReviews', 'recentActivity', 'siteSatisfactory', 'inactivity'] as const;
export type ManualObservationKey = typeof manualObservationKeys[number];
export type ObservationAnswer = 'yes' | 'no' | 'unknown' | 'not_applicable';
export interface ManualObservation {
  answer: ObservationAnswer;
  notes: string;
  sourceUrl: string;
  observedOn: string;
}
export interface DetailedObservations {
  items: Record<ManualObservationKey, ManualObservation>;
  siteAgeBasis: 'unknown' | 'dated_evidence' | 'visual_impression';
  siteDate: string;
  googleReviewCount: number | null;
  googleRating: number | null;
  companySize: string;
  recentEventOn: string;
}

export interface QualificationAnswers {
  fit: { answer: FitAnswer; note: string; observationKeys: ManualObservationKey[] };
  problem: {
    answer: ProblemAnswer;
    description: string;
    observedOn: string;
    proofUrl: string;
    majorReason: 'unknown' | 'multiple' | 'blocking';
    distinctProblems: string[];
    blockingExplanation: string;
    observationKeys: ManualObservationKey[];
  };
  trigger: {
    answer: TriggerAnswer;
    description: string;
    source: string;
    verifiedOn: string;
    eventOn: string;
    relevance: string;
    observationKeys: ManualObservationKey[];
  };
  references: {
    answer: ReferencesAnswer;
    examples: string[];
    improvement: string;
    sourceUrl: string;
    observationKeys: ManualObservationKey[];
  };
  access: { answer: AccessAnswer; channelAssociation: string; observationKeys: ManualObservationKey[] };
}
export interface QualificationInput { answers: QualificationAnswers }

export interface AfterExchangeData {
  need: 'unknown' | 'confirmed' | 'not_recognized';
  needNote: string;
  timing: 'unknown' | 'now' | 'later' | 'not_priority';
  timingNote: string;
  timingDate: string;
  budget: 'not_discussed' | 'unknown' | 'feasible' | 'incompatible';
  budgetNote: string;
  budgetScope: string;
  decision: 'unknown' | 'identified';
  decisionNote: string;
  ability: 'unknown' | 'confirmed' | 'obstacle';
  abilityNote: string;
  obstacleBlocking: boolean;
  solution: 'unknown' | 'audit' | 'targeted_improvement' | 'redesign';
  solutionNote: string;
  solutionFit: 'unknown' | 'confirmed' | 'not_adapted';
  nextStep: { description: string; date: string; accepted: boolean };
  /** Set only by the explicit, verified stage transition on the server. */
  qualifiedAt: string;
}

export interface QualificationData {
  /** Stored format V1 is evaluated using the immutable pickles-v1 ruleset. */
  version: 1;
  answers: QualificationAnswers;
  targetSnapshot: TargetSnapshot | null;
  observations: DetailedObservations;
  afterExchange: AfterExchangeData;
}
export interface QualificationSubject {
  qualificationEnrichment?: import('./qualification-enrichment').QualificationEnrichment;
  qualification?: QualificationData;
  contact: Contact;
  oppositionActive: boolean;
  archived?: boolean;
  stage?: string;
}
export interface CriterionEvaluation {
  key: CriterionKey;
  label: string;
  maxPoints: number;
  answerLabel: string;
  complete: boolean;
  points: number | null;
  missing: string[];
  reasons: string[];
  linkedObservations: { key: ManualObservationKey; label: string; observation: ManualObservation }[];
}
export type OperationalDecision = 'Ne plus contacter' | 'Hors cible' | 'Cible à confirmer' | 'Besoin non établi' | 'Contact à trouver' | 'À vérifier' | 'Prêt à contacter';
export type QualificationPriority = 'Priorité haute' | 'Priorité intermédiaire' | 'Priorité basse';
export interface QualificationEvaluation {
  version: 1;
  rulesetId: QualificationRuleSetId;
  score: number | null;
  confirmedPoints: number;
  completedCount: number;
  complete: boolean;
  evaluated: boolean;
  priority: QualificationPriority | null;
  decision: OperationalDecision;
  criteria: CriterionEvaluation[];
  missingCriteria: CriterionKey[];
  missing: string[];
  reasons: string[];
  blockers: string[];
  nextInformation: string;
  targetNeedsRevalidation: boolean;
  triggerNeedsReverification: boolean;
  warnings: string[];
}
export interface AfterExchangeEvaluation {
  possible: boolean;
  qualificationPossible: boolean;
  label: 'Qualification possible' | 'À revoir plus tard' | 'À clarifier' | 'Qualification bloquée';
  missing: string[];
  blockers: string[];
  toVerify: string[];
  reevaluationRequired: boolean;
}
