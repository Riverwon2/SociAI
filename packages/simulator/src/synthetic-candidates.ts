import {
  CandidateProfileSchema,
  type CandidateProfile,
  type InitialRequest,
  type Task
} from '@30-minute-exchange/contracts'

/** Creates deterministic, explicitly simulated profiles for a single request run. */
export function createSyntheticCandidateProfiles(
  request: InitialRequest,
  tasks: readonly Task[]
): CandidateProfile[] {
  const experienceTags = [...new Set(tasks.flatMap(({ requiredExperience }) => requiredExperience))]

  return [
    createProfile('candidate_neighbor_001', '가상 이웃 하나', 0.96),
    createProfile('candidate_neighbor_002', '가상 이웃 둘', 0.9),
    createProfile('candidate_neighbor_003', '가상 이웃 셋', 0.84)
  ]

  function createProfile(
    candidateId: string,
    displayName: string,
    reliabilityRate: number
  ): CandidateProfile {
    return CandidateProfileSchema.parse({
      schemaVersion: request.schemaVersion,
      candidateId,
      displayName,
      activityRegion: request.activityRegion,
      activityRadiusKm: 3,
      availabilityWindows: [request.timeWindow],
      scheduledCommitments: [],
      experienceTags,
      reliabilityRate,
      isSimulation: true
    })
  }
}
