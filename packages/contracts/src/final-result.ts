import { z } from 'zod'

import { AssignmentSchema } from './assignment.js'
import {
  CandidateIdSchema,
  IsoDateTimeSchema,
  RequestIdSchema,
  RunIdSchema,
  SchemaVersionSchema,
  TaskIdSchema
} from './shared.js'

export const FinalResultStatusSchema = z.enum([
  'fully_matched',
  'partially_matched',
  'safety_excluded',
  'unmatched'
])

export const TaskResultStatusSchema = z.enum([
  'matched',
  'safety_excluded',
  'unmatched',
  'held',
  'failed'
])

export const TaskResultSchema = z
  .object({
    taskId: TaskIdSchema,
    status: TaskResultStatusSchema,
    matchedCandidateId: CandidateIdSchema.optional(),
    assignmentId: z.string().trim().min(1).max(128).optional(),
    reasonCodes: z.array(z.string().trim().min(1).max(100)).max(20),
    userMessage: z.string().trim().min(1).max(1_000)
  })
  .strict()
  .superRefine(({ status, matchedCandidateId }, context) => {
    if (status === 'matched' && matchedCandidateId === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'matchedCandidateId is required for a matched task',
        path: ['matchedCandidateId']
      })
    }

    if (status !== 'matched' && matchedCandidateId !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'matchedCandidateId is only valid for a matched task',
        path: ['matchedCandidateId']
      })
    }
  })

export const SimulatedComponentSchema = z.enum([
  'outreach',
  'neighbor_response',
  'messaging',
  'map',
  'payment',
  'identity',
  'chat',
  'credit',
  'journey',
  'review'
])

const ExecutionModeSchema = z.enum(['live', 'deterministic', 'simulation', 'replay'])

export const ExecutionBoundarySchema = z
  .object({
    openaiInterpretation: ExecutionModeSchema,
    safetyPolicy: ExecutionModeSchema,
    candidateRanking: ExecutionModeSchema,
    outreach: ExecutionModeSchema,
    neighborResponse: ExecutionModeSchema,
    matchConfirmation: ExecutionModeSchema
  })
  .strict()

export const FinalResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    status: FinalResultStatusSchema,
    taskResults: z.array(TaskResultSchema),
    assignmentResults: z.array(AssignmentSchema).max(10).optional(),
    userMessage: z.string().trim().min(1).max(2_000),
    completedAt: IsoDateTimeSchema,
    simulatedComponents: z.array(SimulatedComponentSchema),
    executionBoundary: ExecutionBoundarySchema
  })
  .strict()
  .superRefine(({ status, taskResults }, context) => {
    const matchedCount = taskResults.filter((taskResult) => taskResult.status === 'matched').length
    const safetyExcludedCount = taskResults.filter(
      (taskResult) => taskResult.status === 'safety_excluded'
    ).length

    const isValid =
      (status === 'fully_matched' &&
        taskResults.length > 0 &&
        matchedCount === taskResults.length) ||
      (status === 'partially_matched' && matchedCount > 0 && matchedCount < taskResults.length) ||
      (status === 'safety_excluded' &&
        taskResults.length > 0 &&
        safetyExcludedCount === taskResults.length) ||
      (status === 'unmatched' && matchedCount === 0 && safetyExcludedCount !== taskResults.length)

    if (!isValid) {
      context.addIssue({
        code: 'custom',
        message: 'Overall result status is inconsistent with task results',
        path: ['status']
      })
    }
  })

export type FinalResultStatus = z.infer<typeof FinalResultStatusSchema>
export type TaskResultStatus = z.infer<typeof TaskResultStatusSchema>
export type TaskResult = z.infer<typeof TaskResultSchema>
export type ExecutionBoundary = z.infer<typeof ExecutionBoundarySchema>
export type FinalResult = z.infer<typeof FinalResultSchema>
