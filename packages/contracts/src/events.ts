import { z } from 'zod'

import { AssignmentSchema, TaskBundleSchema } from './assignment.js'
import { CandidateSchema } from './candidate.js'
import { FinalResultSchema } from './final-result.js'
import { InitialRequestSchema } from './initial-request.js'
import { SafetyDecisionSchema, SafetyLevelSchema } from './safety-decision.js'
import {
  CandidateIdSchema,
  EventIdSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  MissingInformationSchema,
  RequestIdSchema,
  RunIdSchema,
  SchemaVersionSchema,
  TaskIdSchema,
  TimeWindowSchema,
  ToolCallIdSchema
} from './shared.js'
import { SufficiencyDecisionSchema } from './sufficiency-decision.js'
import { TaskSchema } from './task.js'
import { ClarificationInviteDataSchema } from './tool-contracts.js'

export const AgentEventTypeSchema = z.enum([
  'request.created',
  'plan.created',
  'task.created',
  'safety.checked',
  'sufficiency.checked',
  'task.held',
  'clarification.invited',
  'clarification.responded',
  'bundles.planned',
  'assignments.planned',
  'candidates.ranked',
  'outreach.sent',
  'neighbor.replied',
  'outreach.timed_out',
  'plan.updated',
  'match.confirmed',
  'task.blocked',
  'tool.failed',
  'request.completed'
])

const EventEnvelopeSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    eventId: EventIdSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    taskId: TaskIdSchema.optional(),
    sequence: z.number().int().positive(),
    occurredAt: IsoDateTimeSchema,
    message: z.string().trim().min(1).max(1_000),
    isSimulation: z.boolean()
  })
  .strict()

function createEventSchema<
  TType extends z.infer<typeof AgentEventTypeSchema>,
  TData extends z.ZodType
>(type: TType, data: TData, taskScoped = false) {
  return EventEnvelopeSchema.extend({
    taskId: taskScoped ? TaskIdSchema : TaskIdSchema.optional(),
    type: z.literal(type),
    data
  })
}

function validateEventRecordContext(
  event: { runId: string; requestId: string; taskId: string | undefined },
  record: { runId: string; requestId: string; taskId: string },
  context: z.RefinementCtx,
  path: readonly (string | number)[]
) {
  for (const field of ['runId', 'requestId', 'taskId'] as const) {
    if (event[field] !== record[field]) {
      context.addIssue({
        code: 'custom',
        message: `${field} must match the event context`,
        path: [...path, field]
      })
    }
  }
}

export const PlanUpdatedTriggerSchema = z.enum([
  'candidate_rejected',
  'outreach_timeout',
  'candidates_exhausted',
  'safety_block',
  'partial_match_available',
  'tool_failure'
])

export const PlanUpdatedPolicySchema = z.enum([
  'next_ranked_candidate',
  'time_adjustment',
  'scope_reduction',
  'preserve_safe_success',
  'bounded_tool_failure'
])

export const PlanUpdatedDataSchema = z
  .object({
    revision: z.number().int().positive(),
    trigger: PlanUpdatedTriggerSchema,
    observation: z.string().trim().min(1).max(1_000),
    previousAction: z.string().trim().min(1).max(500),
    nextAction: z.string().trim().min(1).max(500),
    policyApplied: PlanUpdatedPolicySchema,
    userInputRequired: z.literal(false)
  })
  .strict()

const RequestCreatedEventSchema = createEventSchema(
  'request.created',
  z.object({ request: InitialRequestSchema }).strict()
).superRefine((event, context) => {
  if (event.requestId !== event.data.request.requestId) {
    context.addIssue({
      code: 'custom',
      message: 'requestId must match the event context',
      path: ['data', 'request', 'requestId']
    })
  }
})
const PlanCreatedEventSchema = createEventSchema(
  'plan.created',
  z
    .object({
      revision: z.literal(1),
      taskIds: z.array(TaskIdSchema).min(1),
      summary: z.string().trim().min(1).max(1_000),
      userInputRequired: z.literal(false)
    })
    .strict()
)
const TaskCreatedEventSchema = createEventSchema(
  'task.created',
  z.object({ task: TaskSchema }).strict(),
  true
).superRefine((event, context) => {
  validateEventRecordContext(event, event.data.task, context, ['data', 'task'])
})
const SafetyCheckedEventSchema = createEventSchema(
  'safety.checked',
  z.object({ decision: SafetyDecisionSchema }).strict(),
  true
).superRefine((event, context) => {
  validateEventRecordContext(event, event.data.decision, context, ['data', 'decision'])
})
const SufficiencyCheckedEventSchema = createEventSchema(
  'sufficiency.checked',
  z.object({ decision: SufficiencyDecisionSchema }).strict(),
  true
).superRefine((event, context) => {
  validateEventRecordContext(event, event.data.decision, context, ['data', 'decision'])
})
const TaskHeldEventSchema = createEventSchema(
  'task.held',
  z
    .object({
      reasonCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
      missingInformation: z.array(MissingInformationSchema).min(1).max(20),
      guidance: z.string().trim().min(1).max(1_000)
    })
    .strict(),
  true
)
const ClarificationInvitedEventSchema = createEventSchema(
  'clarification.invited',
  z
    .object({
      toolCallId: ToolCallIdSchema,
      candidateId: CandidateIdSchema
    })
    .strict(),
  true
)
const ClarificationRespondedEventSchema = createEventSchema(
  'clarification.responded',
  ClarificationInviteDataSchema,
  true
)
const BundlesPlannedEventSchema = createEventSchema(
  'bundles.planned',
  z
    .object({
      bundles: z.array(TaskBundleSchema).min(1).max(10),
      splitReasonCodes: z.array(z.string().trim().min(1).max(100)).max(20)
    })
    .strict()
).superRefine((event, context) => {
  for (const [index, bundle] of event.data.bundles.entries()) {
    for (const field of ['runId', 'requestId'] as const) {
      if (event[field] !== bundle[field]) {
        context.addIssue({
          code: 'custom',
          message: `${field} must match the bundle context`,
          path: ['data', 'bundles', index, field]
        })
      }
    }
  }
})
const AssignmentsPlannedEventSchema = createEventSchema(
  'assignments.planned',
  z.object({ assignments: z.array(AssignmentSchema).min(1).max(10) }).strict()
).superRefine((event, context) => {
  for (const [index, assignment] of event.data.assignments.entries()) {
    for (const field of ['runId', 'requestId'] as const) {
      if (event[field] !== assignment[field]) {
        context.addIssue({
          code: 'custom',
          message: `${field} must match the assignment context`,
          path: ['data', 'assignments', index, field]
        })
      }
    }
  }
})
const CandidatesRankedEventSchema = createEventSchema(
  'candidates.ranked',
  z
    .object({
      candidates: z.array(CandidateSchema),
      scoringPolicyVersion: z.string().trim().min(1).max(100)
    })
    .strict(),
  true
).superRefine((event, context) => {
  for (const [index, candidate] of event.data.candidates.entries()) {
    validateEventRecordContext(event, candidate, context, ['data', 'candidates', index])
  }
})
const OutreachSentEventSchema = createEventSchema(
  'outreach.sent',
  z
    .object({
      candidateId: CandidateIdSchema,
      attempt: z.number().int().min(1).max(3),
      responseDeadlineAt: IsoDateTimeSchema,
      transport: z.literal('simulation')
    })
    .strict(),
  true
)
const NeighborRepliedEventSchema = createEventSchema(
  'neighbor.replied',
  z
    .object({
      candidateId: CandidateIdSchema,
      attempt: z.number().int().min(1).max(3),
      response: z.enum(['accepted', 'rejected', 'cancelled']),
      respondedAt: IsoDateTimeSchema
    })
    .strict(),
  true
)
const OutreachTimedOutEventSchema = createEventSchema(
  'outreach.timed_out',
  z
    .object({
      candidateId: CandidateIdSchema,
      attempt: z.number().int().min(1).max(3),
      waitedMinutes: z.literal(10)
    })
    .strict(),
  true
)
const PlanUpdatedEventSchema = createEventSchema('plan.updated', PlanUpdatedDataSchema, true)
const MatchConfirmedEventSchema = createEventSchema(
  'match.confirmed',
  z
    .object({
      matchId: z.string().trim().min(1).max(128),
      candidateId: CandidateIdSchema,
      scheduledWindow: TimeWindowSchema,
      durationMinutes: z.number().int().min(1).max(30),
      isSimulation: z.boolean()
    })
    .strict(),
  true
)
const TaskBlockedEventSchema = createEventSchema(
  'task.blocked',
  z
    .object({
      level: SafetyLevelSchema.extract(['high', 'emergency']),
      reasonCodes: z.array(z.string().trim().min(1)).min(1),
      guidance: z.string().trim().min(1).max(1_000)
    })
    .strict(),
  true
)
const ToolFailedEventSchema = createEventSchema(
  'tool.failed',
  z
    .object({
      toolName: z.string().trim().min(1).max(100),
      toolCallId: ToolCallIdSchema,
      errorCode: z.string().trim().min(1).max(100),
      retryable: z.boolean(),
      attempt: z.number().int().positive(),
      errorMessage: z.string().trim().min(1).max(1_000)
    })
    .strict()
)
const RequestCompletedEventSchema = createEventSchema(
  'request.completed',
  z.object({ result: FinalResultSchema }).strict()
).superRefine((event, context) => {
  for (const field of ['runId', 'requestId'] as const) {
    if (event[field] !== event.data.result[field]) {
      context.addIssue({
        code: 'custom',
        message: `${field} must match the event context`,
        path: ['data', 'result', field]
      })
    }
  }
})

export const AgentEventSchema = z.discriminatedUnion('type', [
  RequestCreatedEventSchema,
  PlanCreatedEventSchema,
  TaskCreatedEventSchema,
  SafetyCheckedEventSchema,
  SufficiencyCheckedEventSchema,
  TaskHeldEventSchema,
  ClarificationInvitedEventSchema,
  ClarificationRespondedEventSchema,
  BundlesPlannedEventSchema,
  AssignmentsPlannedEventSchema,
  CandidatesRankedEventSchema,
  OutreachSentEventSchema,
  NeighborRepliedEventSchema,
  OutreachTimedOutEventSchema,
  PlanUpdatedEventSchema,
  MatchConfirmedEventSchema,
  TaskBlockedEventSchema,
  ToolFailedEventSchema,
  RequestCompletedEventSchema
])

export function parseAgentEventSafely(value: unknown): AgentEvent | null {
  const result = AgentEventSchema.safeParse(value)
  return result.success ? result.data : null
}

export const RawToolEventSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    eventId: EventIdSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    taskId: TaskIdSchema.optional(),
    toolCallId: ToolCallIdSchema,
    sequence: z.number().int().positive(),
    occurredAt: IsoDateTimeSchema,
    direction: z.enum(['tool_call', 'tool_result']),
    provider: z.literal('openai'),
    raw: JsonValueSchema
  })
  .strict()

export type AgentEventType = z.infer<typeof AgentEventTypeSchema>
export type PlanUpdatedData = z.infer<typeof PlanUpdatedDataSchema>
export type AgentEvent = z.infer<typeof AgentEventSchema>
export type RawToolEvent = z.infer<typeof RawToolEventSchema>
