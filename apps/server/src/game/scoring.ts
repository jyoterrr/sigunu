import type { ScoringConfig, UnansweredPolicy } from '@sigunu/shared';

/**
 * Score a single subject (team or solo player) for one question (Section 9).
 *
 * Rules:
 *  - correct  => +correctPoints (always > 0, validated on write)
 *  - wrong    => -wrongPenalty  (>= 0; stored as a magnitude, applied as a deduction)
 *  - no answer => depends on the quiz's unansweredPolicy:
 *                 'zero'    => 0 (neither award nor penalty)
 *                 'penalty' => treated like a wrong answer (-wrongPenalty)
 *
 * There is no correct answer set (host never marked one) => 0, and reveal shows "no key".
 */
export function scoreAnswer(params: {
  lockedOptionId: string | null; // null => unanswered
  correctOptionId: string | null; // null => no key marked for this question
  scoring: ScoringConfig;
  unansweredPolicy: UnansweredPolicy;
}): number {
  const { lockedOptionId, correctOptionId, scoring, unansweredPolicy } = params;

  if (correctOptionId == null) return 0; // nothing to grade against

  if (lockedOptionId == null) {
    return unansweredPolicy === 'penalty' ? -scoring.wrongPenalty : 0;
  }

  return lockedOptionId === correctOptionId ? scoring.correctPoints : -scoring.wrongPenalty;
}

/** Resolve the effective scoring for a question: per-question override else session default. */
export function effectiveScoring(
  questionOverride: Partial<ScoringConfig>,
  sessionDefault: ScoringConfig
): ScoringConfig {
  return {
    correctPoints: questionOverride.correctPoints ?? sessionDefault.correctPoints,
    wrongPenalty: questionOverride.wrongPenalty ?? sessionDefault.wrongPenalty,
  };
}
