import type { Candidate, FallbackPolicy } from '@30-minute-exchange/contracts'

export const MAX_CANDIDATE_ATTEMPTS = 3
export const OUTREACH_TIMEOUT_MINUTES = 10

export type FallbackAction = 'next_candidate' | 'adjust_time' | 'reduce_scope' | 'unmatched'

export function selectNextCandidate(
  candidates: readonly Candidate[],
  attemptedCandidateIds: ReadonlySet<string>
): Candidate | null {
  return (
    [...candidates]
      .sort((left, right) => left.rank - right.rank)
      .find(
        (candidate) =>
          candidate.rank <= MAX_CANDIDATE_ATTEMPTS &&
          !attemptedCandidateIds.has(candidate.candidateId)
      ) ?? null
  )
}

export function chooseFallbackAction(
  hasNextCandidate: boolean,
  policy: FallbackPolicy
): FallbackAction {
  if (hasNextCandidate) return 'next_candidate'
  if (policy.allowTimeAdjustment) return 'adjust_time'
  if (policy.allowScopeReduction) return 'reduce_scope'
  return 'unmatched'
}
