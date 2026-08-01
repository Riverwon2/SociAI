import { z } from 'zod'

import { AssignmentSchema, TaskBundleSchema } from './assignment.js'
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
import { AvailableFactSchema, SufficiencyDecisionSchema } from './sufficiency-decision.js'

const ToolCallContextSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    taskId: TaskIdSchema,
    toolCallId: ToolCallIdSchema
  })
  .strict()

const BundleToolCallContextSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
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

function validateTasksContext(
  value: { runId: string; requestId: string; tasks: z.infer<typeof TaskSchema>[] },
  context: z.RefinementCtx
) {
  for (const [index, task] of value.tasks.entries()) {
    for (const field of ['runId', 'requestId'] as const) {
      if (value[field] !== task[field]) {
        context.addIssue({
          code: 'custom',
          message: `${field} must match each task context`,
          path: ['tasks', index, field]
        })
      }
    }

    if (task.status !== 'ready') {
      context.addIssue({
        code: 'custom',
        message: 'Only safety- and sufficiency-cleared tasks may enter bundle assignment',
        path: ['tasks', index, 'status']
      })
    }
  }
}

function haveSameTaskIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((taskId, index) => taskId === right[index])
}

function windowsOverlap(
  left: { scheduledWindow: { startAt: string; endAt: string } },
  right: { scheduledWindow: { startAt: string; endAt: string } }
): boolean {
  return (
    Date.parse(left.scheduledWindow.startAt) < Date.parse(right.scheduledWindow.endAt) &&
    Date.parse(right.scheduledWindow.startAt) < Date.parse(left.scheduledWindow.endAt)
  )
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

export const CheckSufficiencyCallSchema = ToolCallContextSchema.extend({
  task: TaskSchema,
  availableFacts: z.array(AvailableFactSchema).max(100)
}).superRefine(validateTaskContext)
export const CheckSufficiencyResultSchema = z
  .discriminatedUnion('ok', [
    ToolCallContextSchema.extend({ ok: z.literal(true), data: SufficiencyDecisionSchema }),
    ToolFailureSchema
  ])
  .superRefine((result, context) => {
    if (!result.ok) return

    for (const field of ['runId', 'requestId', 'taskId'] as const) {
      if (result[field] !== result.data[field]) {
        context.addIssue({
          code: 'custom',
          message: `${field} must match the sufficiency decision context`,
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

export const BuildBundleAssignmentsCallSchema = BundleToolCallContextSchema.extend({
  tasks: z.array(TaskSchema).min(1).max(10),
  candidateProfiles: z.array(CandidateProfileSchema).max(100)
}).superRefine(validateTasksContext)

export const BuildBundleAssignmentsResultSchema = z
  .discriminatedUnion('ok', [
    BundleToolCallContextSchema.extend({
      ok: z.literal(true),
      data: z
        .object({
          processedTaskIds: z.array(TaskIdSchema).min(1).max(10),
          bundles: z.array(TaskBundleSchema).max(10),
          assignments: z.array(AssignmentSchema).max(10),
          unassignedTaskIds: z.array(TaskIdSchema).max(10),
          splitReasonCodes: z.array(z.string().trim().min(1).max(100)).max(20)
        })
        .strict()
    }),
    BundleToolCallContextSchema.extend({ ok: z.literal(false), error: ToolErrorSchema })
  ])
  .superRefine((result, context) => {
    if (!result.ok) return

    for (const [index, bundle] of result.data.bundles.entries()) {
      for (const field of ['runId', 'requestId'] as const) {
        if (result[field] !== bundle[field]) {
          context.addIssue({
            code: 'custom',
            message: `${field} must match the task bundle context`,
            path: ['data', 'bundles', index, field]
          })
        }
      }
    }

    for (const [index, assignment] of result.data.assignments.entries()) {
      for (const field of ['runId', 'requestId'] as const) {
        if (result[field] !== assignment[field]) {
          context.addIssue({
            code: 'custom',
            message: `${field} must match the assignment context`,
            path: ['data', 'assignments', index, field]
          })
        }
      }

      const bundle = result.data.bundles.find(({ bundleId }) => bundleId === assignment.bundleId)
      if (bundle === undefined || !haveSameTaskIds(bundle.taskIds, assignment.taskIds)) {
        context.addIssue({
          code: 'custom',
          message: 'Assignment taskIds must exactly match its referenced bundle',
          path: ['data', 'assignments', index, 'taskIds']
        })
      }
    }

    const processedTaskIds = new Set(result.data.processedTaskIds)
    const assignedTaskIds = result.data.assignments.flatMap(({ taskIds }) => taskIds)
    const unassignedTaskIds = result.data.unassignedTaskIds
    const resolvedTaskIds = [...assignedTaskIds, ...unassignedTaskIds]
    if (
      processedTaskIds.size !== result.data.processedTaskIds.length ||
      new Set(resolvedTaskIds).size !== resolvedTaskIds.length ||
      resolvedTaskIds.length !== processedTaskIds.size ||
      resolvedTaskIds.some((taskId) => !processedTaskIds.has(taskId))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Every processed task must be assigned or unassigned exactly once',
        path: ['data']
      })
    }

    for (const bundle of result.data.bundles) {
      if (bundle.taskIds.some((taskId) => !processedTaskIds.has(taskId))) {
        context.addIssue({
          code: 'custom',
          message: 'Bundle tasks must be included in processedTaskIds',
          path: ['data', 'bundles']
        })
      }
    }

    for (const [index, assignment] of result.data.assignments.entries()) {
      for (const other of result.data.assignments.slice(index + 1)) {
        if (assignment.candidateId === other.candidateId && windowsOverlap(assignment, other)) {
          context.addIssue({
            code: 'custom',
            message: 'A candidate cannot have overlapping assignments',
            path: ['data', 'assignments', index, 'scheduledWindow']
          })
        }
      }
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
export type CheckSufficiencyCall = z.infer<typeof CheckSufficiencyCallSchema>
export type CheckSufficiencyResult = z.infer<typeof CheckSufficiencyResultSchema>
export type FindCandidatesCall = z.infer<typeof FindCandidatesCallSchema>
export type FindCandidatesResult = z.infer<typeof FindCandidatesResultSchema>
export type BuildBundleAssignmentsCall = z.infer<typeof BuildBundleAssignmentsCallSchema>
export type BuildBundleAssignmentsResult = z.infer<typeof BuildBundleAssignmentsResultSchema>
export type SendOutreachCall = z.infer<typeof SendOutreachCallSchema>
export type SendOutreachResult = z.infer<typeof SendOutreachResultSchema>
export type ConfirmMatchCall = z.infer<typeof ConfirmMatchCallSchema>
export type ConfirmMatchResult = z.infer<typeof ConfirmMatchResultSchema>
