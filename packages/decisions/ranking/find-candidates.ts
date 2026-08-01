import {
  FindCandidatesCallSchema,
  FindCandidatesResultSchema,
  SCHEMA_VERSION,
  type Candidate,
  type FindCandidatesCall,
  type FindCandidatesResult
} from '@30-minute-exchange/contracts'

import { filterCandidate } from './filter-candidate.js'
import { RANKING_POLICY_VERSION } from './ranking-policy.js'
import { scoreCandidate } from './score-candidate.js'
import { sortAndRankCandidates } from './sort-candidates.js'

export function findCandidates(input: FindCandidatesCall): FindCandidatesResult {
  const call = FindCandidatesCallSchema.parse(input)
  const eligible: Candidate[] = []

  for (const profile of call.candidateProfiles) {
    const evaluation = filterCandidate(call.task, profile)
    if (!evaluation.eligible || evaluation.distanceKm === null) continue

    eligible.push({
      schemaVersion: SCHEMA_VERSION,
      runId: call.runId,
      requestId: call.requestId,
      taskId: call.taskId,
      candidateId: profile.candidateId,
      displayName: profile.displayName,
      activityRegion: profile.activityRegion,
      activityRadiusKm: profile.activityRadiusKm,
      isAvailable: true,
      distanceKm: evaluation.distanceKm,
      experienceTags: [...profile.experienceTags],
      reliabilityRate: profile.reliabilityRate,
      scoreBreakdown: scoreCandidate(
        call.task,
        profile,
        evaluation.availabilityScore,
        evaluation.distanceKm
      ),
      rank: 1,
      isSimulation: profile.isSimulation
    })
  }

  return FindCandidatesResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    runId: call.runId,
    requestId: call.requestId,
    taskId: call.taskId,
    toolCallId: call.toolCallId,
    ok: true,
    data: {
      candidates: sortAndRankCandidates(eligible),
      excludedCount: call.candidateProfiles.length - eligible.length,
      rankingPolicyVersion: RANKING_POLICY_VERSION
    }
  })
}
