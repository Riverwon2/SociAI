import { z } from 'zod'

import {
  ActivityRegionSchema,
  CandidateIdSchema,
  RequestIdSchema,
  RunIdSchema,
  SchemaVersionSchema,
  TaskIdSchema,
  TimeWindowSchema
} from './shared.js'

export const CANDIDATE_SCORE_WEIGHTS = Object.freeze({
  availability: 0.4,
  distance: 0.25,
  experience: 0.2,
  reliability: 0.15
})

export const ScoreComponentsSchema = z
  .object({
    availability: z.number().min(0).max(1),
    distance: z.number().min(0).max(1),
    experience: z.number().min(0).max(1),
    reliability: z.number().min(0).max(1),
    weightedTotal: z.number().min(0).max(1)
  })
  .strict()

export type CandidateScoreBreakdown = z.infer<typeof ScoreComponentsSchema>

export const CandidateProfileSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    candidateId: CandidateIdSchema,
    displayName: z.string().trim().min(1).max(100),
    activityRegion: ActivityRegionSchema,
    activityRadiusKm: z.union([z.literal(1), z.literal(3), z.literal(5)]),
    availabilityWindows: z.array(TimeWindowSchema).min(1).max(20),
    experienceTags: z.array(z.string().trim().min(1).max(100)).max(30),
    reliabilityRate: z.number().min(0).max(1),
    isSimulation: z.boolean()
  })
  .strict()

export function calculateCandidateScore(
  score: Omit<CandidateScoreBreakdown, 'weightedTotal'>
): number {
  return (
    score.availability * CANDIDATE_SCORE_WEIGHTS.availability +
    score.distance * CANDIDATE_SCORE_WEIGHTS.distance +
    score.experience * CANDIDATE_SCORE_WEIGHTS.experience +
    score.reliability * CANDIDATE_SCORE_WEIGHTS.reliability
  )
}

export const CandidateSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    taskId: TaskIdSchema,
    candidateId: CandidateIdSchema,
    displayName: z.string().trim().min(1).max(100),
    activityRegion: ActivityRegionSchema,
    activityRadiusKm: z.union([z.literal(1), z.literal(3), z.literal(5)]),
    isAvailable: z.boolean(),
    distanceKm: z.number().nonnegative().max(100),
    experienceTags: z.array(z.string().trim().min(1).max(100)).max(30),
    reliabilityRate: z.number().min(0).max(1),
    scoreBreakdown: ScoreComponentsSchema,
    rank: z.number().int().positive(),
    isSimulation: z.boolean()
  })
  .strict()
  .superRefine(({ scoreBreakdown }, context) => {
    const expectedTotal = calculateCandidateScore(scoreBreakdown)

    if (Math.abs(expectedTotal - scoreBreakdown.weightedTotal) > 0.000_001) {
      context.addIssue({
        code: 'custom',
        message: 'weightedTotal must equal the documented weighted component sum',
        path: ['scoreBreakdown', 'weightedTotal']
      })
    }
  })

export type Candidate = z.infer<typeof CandidateSchema>
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>
