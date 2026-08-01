import { z } from 'zod'

import { CandidateProfileSchema, CandidateSchema } from './candidate.js'
import { SafetyDecisionSchema } from './safety-decision.js'
import {
  CandidateIdSchema,
  IsoDateTimeSchema,
  RequestIdSchema,
  RunIdSchema,
  SchemaVersionSchema,
  TaskIdSchema,
  TimeWindowSchema,
  ToolCallIdSchema
} from './shared.js'
import { TaskSchema } from './task.js'

const ToolCallContextSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    taskId: TaskIdSchema,
    toolCallId: ToolCallIdSchema
  })
  .strict()

function validateTaskContext(
  value: { runId: string; requestId: string; taskId: string; task: z.infer<typeof TaskSchema> },
  context: z.RefinementCtx
) {
  for (const field of ['runId', 'requestId', 'taskId'] as const) {
    if (value[field] !== value.task[field]) {
      context.addIssue({
        code: 'custom',
        message: `${field} must match the task context`,
        path: [field]
      })
    }
  }
}

function validateCandidateContext(
  value: {
    runId: string
    requestId: string
    taskId: string
    candidate: z.infer<typeof CandidateSchema>
  },
  context: z.RefinementCtx
) {
  for (const field of ['runId', 'requestId', 'taskId'] as const) {
    if (value[field] !== value.candidate[field]) {
      context.addIssue({
        code: 'custom',
        message: `${field} must match the candidate context`,
        path: ['candidate', field]
      })
    }
  }
}

export const ToolErrorSchema = z
  .object({
    code: z.enum([
      'input_invalid',
      'output_invalid',
      'dependency_failure',
      'timeout',
      'internal_error'
    ]),
    message: z.string().trim().min(1).max(1_000),
    retryable: z.boolean()
  })
  .strict()

const ToolFailureSchema = ToolCallContextSchema.extend({
  ok: z.literal(false),
  error: ToolErrorSchema
})

export const CheckSafetyCallSchema = ToolCallContextSchema.extend({
  task: TaskSchema
}).superRefine(validateTaskContext)
export const CheckSafetyResultSchema = z
  .discriminatedUnion('ok', [
    ToolCallContextSchema.extend({ ok: z.literal(true), data: SafetyDecisionSchema }),
    ToolFailureSchema
  ])
  .superRefine((result, context) => {
    if (!result.ok) return

    for (const field of ['runId', 'requestId', 'taskId'] as const) {
      if (result[field] !== result.data[field]) {
        context.addIssue({
          code: 'custom',
          message: `${field} must match the safety decision context`,
          path: ['data', field]
        })
      }
    }
  })

export const FindCandidatesCallSchema = ToolCallContextSchema.extend({
  task: TaskSchema,
  candidateProfiles: z.array(CandidateProfileSchema)
}).superRefine(validateTaskContext)
export const FindCandidatesResultSchema = z
  .discriminatedUnion('ok', [
    ToolCallContextSchema.extend({
      ok: z.literal(true),
      data: z
        .object({
          candidates: z.array(CandidateSchema),
          excludedCount: z.number().int().nonnegative(),
          rankingPolicyVersion: z.string().trim().min(1).max(100)
        })
        .strict()
    }),
    ToolFailureSchema
  ])
  .superRefine((result, context) => {
    if (!result.ok) return

    for (const candidate of result.data.candidates) {
      validateCandidateContext({ ...result, candidate }, context)
    }
  })

export const SendOutreachCallSchema = ToolCallContextSchema.extend({
  task: TaskSchema,
  candidate: CandidateSchema,
  attempt: z.number().int().min(1).max(3),
  timeoutMinutes: z.literal(10),
  seed: z.string().trim().min(1).max(128)
}).superRefine((value, context) => {
  validateTaskContext(value, context)
  validateCandidateContext(value, context)
})
export const SendOutreachResultSchema = z.discriminatedUnion('ok', [
  ToolCallContextSchema.extend({
    ok: z.literal(true),
    candidateId: CandidateIdSchema,
    data: z
      .object({
        candidateId: CandidateIdSchema,
        outcome: z.enum(['accepted', 'rejected', 'timed_out', 'cancelled']),
        virtualElapsedMinutes: z.number().int().min(0).max(10),
        respondedAt: IsoDateTimeSchema.optional()
      })
      .strict()
  }).superRefine((result, context) => {
    if (result.candidateId !== result.data.candidateId) {
      context.addIssue({
        code: 'custom',
        message: 'candidateId must match the outreach result context',
        path: ['data', 'candidateId']
      })
    }
  }),
  ToolFailureSchema
])

export const ConfirmMatchCallSchema = ToolCallContextSchema.extend({
  task: TaskSchema,
  candidate: CandidateSchema,
  acceptedAt: IsoDateTimeSchema,
  idempotencyKey: z.string().trim().min(1).max(128)
}).superRefine((value, context) => {
  validateTaskContext(value, context)
  validateCandidateContext(value, context)
})
export const ConfirmMatchResultSchema = z.discriminatedUnion('ok', [
  ToolCallContextSchema.extend({
    ok: z.literal(true),
    candidateId: CandidateIdSchema,
    data: z
      .object({
        matchId: z.string().trim().min(1).max(128),
        candidateId: CandidateIdSchema,
        status: z.literal('confirmed'),
        scheduledWindow: TimeWindowSchema,
        isSimulation: z.boolean()
      })
      .strict()
  }).superRefine((result, context) => {
    if (result.candidateId !== result.data.candidateId) {
      context.addIssue({
        code: 'custom',
        message: 'candidateId must match the match result context',
        path: ['data', 'candidateId']
      })
    }
  }),
  ToolFailureSchema
])

export type ToolError = z.infer<typeof ToolErrorSchema>
export type CheckSafetyCall = z.infer<typeof CheckSafetyCallSchema>
export type CheckSafetyResult = z.infer<typeof CheckSafetyResultSchema>
export type FindCandidatesCall = z.infer<typeof FindCandidatesCallSchema>
export type FindCandidatesResult = z.infer<typeof FindCandidatesResultSchema>
export type SendOutreachCall = z.infer<typeof SendOutreachCallSchema>
export type SendOutreachResult = z.infer<typeof SendOutreachResultSchema>
export type ConfirmMatchCall = z.infer<typeof ConfirmMatchCallSchema>
export type ConfirmMatchResult = z.infer<typeof ConfirmMatchResultSchema>
