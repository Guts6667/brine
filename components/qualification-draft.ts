import { emptyQualification, QUALIFICATION_RULES } from '@/lib/qualification';
import { manualObservationKeys } from '@/lib/qualification-types';
import type { CriterionKey, QualificationAnswers } from '@/lib/qualification-types';

// An unfinished URL or justification is still a useful browser draft. Only the
// submitted payload is subject to the complete qualification validation.
export function restoreQualificationAnswers(value: unknown): QualificationAnswers | null {
  const template = emptyQualification().answers;
  function sameShape(candidate: unknown, reference: unknown): boolean {
    if (typeof reference === 'string') return typeof candidate === 'string' && candidate.length <= 5000;
    if (Array.isArray(reference)) return Array.isArray(candidate) && candidate.length <= 50 && candidate.every(item => typeof item === 'string' && item.length <= 5000);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const expected = reference as Record<string, unknown>, actual = candidate as Record<string, unknown>;
    return Object.keys(actual).length === Object.keys(expected).length && Object.keys(expected).every(key => Object.hasOwn(actual, key) && sameShape(actual[key], expected[key]));
  }
  if (!sameShape(value, template)) return null;
  const answers = value as QualificationAnswers;
  for (const key of Object.keys(template) as CriterionKey[]) {
    if (!QUALIFICATION_RULES.criteria[key].options.some(option => option.value === answers[key].answer)) return null;
    if (!answers[key].observationKeys.every(item => manualObservationKeys.includes(item))) return null;
  }
  return answers;
}
