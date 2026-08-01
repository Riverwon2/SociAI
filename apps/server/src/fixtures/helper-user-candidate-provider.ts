import { z } from 'zod'

import {
  CandidateProfileSchema,
  FindCandidatesForBundleResultSchema,
  SCHEMA_VERSION,
  calculateCandidateScore,
  type CandidateProfile,
  type FindCandidatesForBundleCall,
  type FindCandidatesForBundleResult,
  type Task
} from '@30-minute-exchange/contracts'
import { findCandidatesForBundle } from '@30-minute-exchange/decisions'

const ClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

const AvailabilityTimeRangeSchema = z
  .object({
    startTime: ClockTimeSchema,
    endTime: ClockTimeSchema
  })
  .strict()
  .superRefine(({ startTime, endTime }, context) => {
    if (endTime <= startTime) {
      context.addIssue({
        code: 'custom',
        message: 'endTime must be after startTime; overnight availability is not supported.',
        path: ['endTime']
      })
    }
  })

const HelperUserSchema = z
  .object({
    candidateId: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(100),
    availabilityTimeRanges: z.array(AvailabilityTimeRangeSchema).min(1).max(20),
    distanceMeters: z.number().int().min(0).max(5_000),
    experienceTags: z.array(z.string().trim().min(1).max(100)).max(30),
    completedHelpCount: z.number().int().min(0).max(10_000),
    trustScore: z.number().int().min(0).max(20)
  })
  .strict()

export const HelperUsersFixtureSchema = z
  .object({
    candidates: z.array(HelperUserSchema).min(1).max(100)
  })
  .strict()
  .superRefine(({ candidates }, context) => {
    const candidateIds = candidates.map(({ candidateId }) => candidateId)
    if (new Set(candidateIds).size !== candidateIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'candidateId values must be unique.',
        path: ['candidates']
      })
    }
  })

type HelperUsersFixture = z.infer<typeof HelperUsersFixtureSchema>
type HelperUser = HelperUsersFixture['candidates'][number]

const MAX_DISTANCE_METERS = 5_000
const MAX_COMPLETED_HELP_COUNT = 20
export const HELPER_USER_RANKING_POLICY_VERSION = 'helper-user-weighted-v1'

export type HelperUserCandidateProvider = Readonly<{
  createCandidateProfiles: (tasks: readonly Task[]) => CandidateProfile[]
  findCandidatesForBundle: (input: FindCandidatesForBundleCall) => FindCandidatesForBundleResult
}>

/**
 * Converts synthetic daily helper availability into contract-valid profiles and
 * applies the demo's fixed weighted ranking without extending shared schemas.
 */
export function createHelperUserCandidateProvider(input: unknown): HelperUserCandidateProvider {
  const fixture = HelperUsersFixtureSchema.parse(input)
  const usersById = new Map(
    fixture.candidates.map((candidate) => [candidate.candidateId, candidate])
  )

  return {
    createCandidateProfiles: (tasks) => createCandidateProfiles(fixture, tasks),
    findCandidatesForBundle: (input) => rankFixtureCandidates(input, usersById)
  }
}

function createCandidateProfiles(
  fixture: HelperUsersFixture,
  tasks: readonly Task[]
): CandidateProfile[] {
  const task = tasks[0]
  if (task === undefined)
    throw new Error('At least one task is required for helper candidate matching.')

  const date = task.timeWindow.startAt.slice(0, 10)
  const offset = getOffset(task.timeWindow.startAt)
  if (tasks.some((candidate) => candidate.timeWindow.startAt.slice(0, 10) !== date)) {
    throw new Error('Helper fixture availability only supports tasks on one local calendar day.')
  }

  return fixture.candidates.map((candidate) =>
    CandidateProfileSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      candidateId: candidate.candidateId,
      displayName: candidate.displayName,
      activityRegion: task.region,
      activityRadiusKm: 5,
      availabilityWindows: candidate.availabilityTimeRanges.map(({ startTime, endTime }) => ({
        startAt: `${date}T${startTime}:00${offset}`,
        endAt: `${date}T${endTime}:00${offset}`
      })),
      experienceTags: [...candidate.experienceTags],
      reliabilityRate: candidate.trustScore / 20,
      isSimulation: true
    })
  )
}

function rankFixtureCandidates(
  input: FindCandidatesForBundleCall,
  usersById: ReadonlyMap<string, HelperUser>
): FindCandidatesForBundleResult {
  const result = findCandidatesForBundle(input)
  if (!result.ok) return result

  const candidates = result.data.candidates
    .map((candidate) => {
      const user = usersById.get(candidate.candidateId)
      if (user === undefined)
        throw new Error(`Missing fixture details for ${candidate.candidateId}.`)
      return { candidate, weightedTotal: calculateWeightedTotal(user) }
    })
    .sort(
      (left, right) =>
        right.weightedTotal - left.weightedTotal ||
        left.candidate.candidateId.localeCompare(right.candidate.candidateId)
    )
    .map(({ candidate }, index) => ({ ...candidate, rank: index + 1 }))

  return FindCandidatesForBundleResultSchema.parse({
    ...result,
    data: {
      ...result.data,
      candidates,
      rankingPolicyVersion: HELPER_USER_RANKING_POLICY_VERSION
    }
  })
}

function calculateWeightedTotal(candidate: HelperUser): number {
  return calculateCandidateScore({
    availability: 1,
    distance: Math.max(0, 1 - candidate.distanceMeters / MAX_DISTANCE_METERS),
    experience: Math.min(1, candidate.completedHelpCount / MAX_COMPLETED_HELP_COUNT),
    reliability: candidate.trustScore / 20
  })
}

function getOffset(value: string): string {
  const offset = value.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1]
  if (offset === undefined) throw new Error('Task time window must include a UTC offset.')
  return offset
}
