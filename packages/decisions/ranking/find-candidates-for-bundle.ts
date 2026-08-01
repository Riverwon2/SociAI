import {
  FindCandidatesForBundleCallSchema,
  FindCandidatesForBundleResultSchema,
  SCHEMA_VERSION,
  type CandidateProfile,
  type FindCandidatesForBundleCall,
  type FindCandidatesForBundleResult,
  type PlannedAssignment,
  type TaskBundle,
  type TimeWindow
} from '@30-minute-exchange/contracts'

import { RANKING_POLICY_VERSION } from './ranking-policy.js'

/**
 * Selects candidates only after a schedule-feasible bundle exists. The bundle
 * contract deliberately has no location, so this boundary ranks its eligible
 * candidates by reliability and a stable identifier after time/skill checks.
 */
export function findCandidatesForBundle(
  input: FindCandidatesForBundleCall
): FindCandidatesForBundleResult {
  const call = FindCandidatesForBundleCallSchema.parse(input)
  const eligibleProfiles = call.candidateProfiles.filter((profile) =>
    canPerformBundle(profile, call.bundle, call.plannedAssignments)
  )
  const candidates = [...eligibleProfiles]
    .sort(
      (left, right) =>
        right.reliabilityRate - left.reliabilityRate ||
        left.candidateId.localeCompare(right.candidateId)
    )
    .map((profile, index) => ({
      schemaVersion: SCHEMA_VERSION,
      runId: call.runId,
      requestId: call.requestId,
      bundleId: call.bundle.bundleId,
      candidateId: profile.candidateId,
      displayName: profile.displayName,
      activityRegion: profile.activityRegion,
      experienceTags: [...profile.experienceTags],
      reliabilityRate: profile.reliabilityRate,
      rank: index + 1,
      isSimulation: profile.isSimulation
    }))

  return FindCandidatesForBundleResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    runId: call.runId,
    requestId: call.requestId,
    toolCallId: call.toolCallId,
    ok: true,
    data: {
      candidates,
      excludedCount: call.candidateProfiles.length - eligibleProfiles.length,
      rankingPolicyVersion: RANKING_POLICY_VERSION
    }
  })
}

function canPerformBundle(
  profile: CandidateProfile,
  bundle: TaskBundle,
  plannedAssignments: readonly PlannedAssignment[]
): boolean {
  const hasRequiredExperience = bundle.requiredExperience.every((requirement) =>
    profile.experienceTags.includes(requirement)
  )
  const isAvailable = profile.availabilityWindows.some((window) =>
    containsWindow(window, bundle.scheduledWindow)
  )
  const commitments = [
    ...(profile.scheduledCommitments ?? []),
    ...plannedAssignments
      .filter((assignment) => assignment.candidateId === profile.candidateId)
      .map((assignment) => assignment.scheduledWindow)
  ]

  return (
    hasRequiredExperience &&
    isAvailable &&
    !commitments.some((commitment) => windowsOverlap(commitment, bundle.scheduledWindow))
  )
}

function containsWindow(outer: TimeWindow, inner: TimeWindow): boolean {
  return (
    Date.parse(outer.startAt) <= Date.parse(inner.startAt) &&
    Date.parse(outer.endAt) >= Date.parse(inner.endAt)
  )
}

function windowsOverlap(left: TimeWindow, right: TimeWindow): boolean {
  return (
    Date.parse(left.startAt) < Date.parse(right.endAt) &&
    Date.parse(right.startAt) < Date.parse(left.endAt)
  )
}
