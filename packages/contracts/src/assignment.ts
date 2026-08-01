import { z } from 'zod'

import {
  CandidateIdSchema,
  RequestIdSchema,
  RunIdSchema,
  SchemaVersionSchema,
  TaskIdSchema,
  TimeWindowSchema
} from './shared.js'

export const MAX_BUNDLE_ACTIVITY_DURATION_MINUTES = 30
export const MAX_BUNDLE_WAITING_MINUTES = 20

const TaskIdsSchema = z.array(TaskIdSchema).min(1).max(10)

export const TaskBundleSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    bundleId: z.string().trim().min(1).max(128),
    taskIds: TaskIdsSchema,
    scheduledWindow: TimeWindowSchema,
    totalActivityDurationMinutes: z.number().int().min(1).max(MAX_BUNDLE_ACTIVITY_DURATION_MINUTES),
    waitingMinutes: z.number().int().min(0).max(MAX_BUNDLE_WAITING_MINUTES),
    requiredExperience: z.array(z.string().trim().min(1).max(100)).max(30),
    reasonCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(20)
  })
  .strict()
  .superRefine(
    ({ scheduledWindow, taskIds, totalActivityDurationMinutes, waitingMinutes }, context) => {
      if (new Set(taskIds).size !== taskIds.length) {
        context.addIssue({
          code: 'custom',
          message: 'A task bundle cannot contain the same task more than once',
          path: ['taskIds']
        })
      }

      const scheduledMinutes =
        (Date.parse(scheduledWindow.endAt) - Date.parse(scheduledWindow.startAt)) / 60_000
      if (scheduledMinutes < totalActivityDurationMinutes + waitingMinutes) {
        context.addIssue({
          code: 'custom',
          message: 'The scheduled window must cover active and waiting minutes',
          path: ['scheduledWindow']
        })
      }
    }
  )

export const AssignmentSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    assignmentId: z.string().trim().min(1).max(128),
    bundleId: z.string().trim().min(1).max(128),
    candidateId: CandidateIdSchema,
    taskIds: TaskIdsSchema,
    scheduledWindow: TimeWindowSchema,
    isSimulation: z.boolean()
  })
  .strict()
  .superRefine(({ taskIds }, context) => {
    if (new Set(taskIds).size !== taskIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'An assignment cannot contain the same task more than once',
        path: ['taskIds']
      })
    }
  })

export type TaskBundle = z.infer<typeof TaskBundleSchema>
export type Assignment = z.infer<typeof AssignmentSchema>
