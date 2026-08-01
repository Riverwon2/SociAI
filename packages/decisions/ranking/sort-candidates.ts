import type { Candidate } from '@30-minute-exchange/contracts'

export function sortAndRankCandidates(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates]
    .sort(
      (left, right) =>
        right.scoreBreakdown.weightedTotal - left.scoreBreakdown.weightedTotal ||
        left.candidateId.localeCompare(right.candidateId)
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }))
}
