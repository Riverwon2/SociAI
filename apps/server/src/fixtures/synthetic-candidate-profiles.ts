import {
  CandidateProfileSchema,
  SCHEMA_VERSION,
  type CandidateProfile,
  type Task
} from '@30-minute-exchange/contracts'

/** Synthetic demo-only candidates. They are never presented as real people. */
export function createSyntheticCandidateProfiles(tasks: readonly Task[]): CandidateProfile[] {
  const firstTask = tasks[0]
  if (firstTask === undefined)
    throw new Error('At least one task is required for candidate simulation')

  const availabilityWindow = {
    startAt: tasks.reduce(
      (earliest, task) => (task.timeWindow.startAt < earliest ? task.timeWindow.startAt : earliest),
      firstTask.timeWindow.startAt
    ),
    endAt: tasks.reduce(
      (latest, task) => (task.timeWindow.endAt > latest ? task.timeWindow.endAt : latest),
      firstTask.timeWindow.endAt
    )
  }
  const experienceTags = [...new Set(tasks.flatMap((task) => task.requiredExperience))]

  return ['alpha', 'beta', 'gamma'].map((suffix, index) =>
    CandidateProfileSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      candidateId: `simulation-candidate-${suffix}`,
      displayName: `Simulation Neighbor ${suffix.toUpperCase()}`,
      activityRegion: firstTask.region,
      activityRadiusKm: 1,
      availabilityWindows: [availabilityWindow],
      experienceTags,
      reliabilityRate: 0.99 - index / 100,
      isSimulation: true
    })
  )
}
