import { z } from 'zod'

import { AssignmentSchema, TaskBundleSchema } from './assignment.js'
import { CandidateSchema } from './candidate.js'
import { AgentEventTypeSchema } from './events.js'
import { FinalResultSchema } from './final-result.js'
import { InitialRequestSchema } from './initial-request.js'
import { CandidateIdSchema, SchemaVersionSchema, TaskIdSchema } from './shared.js'
import { TaskSchema } from './task.js'

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

export const DemoScenarioIdSchema = z.enum([
  'first_candidate_accepts',
  'reject_timeout_accept',
  'mixed_risk_partial_match',
  'multi_helper_split'
])

export const ScenarioResponseSchema = z
  .object({
    taskId: TaskIdSchema,
    candidateId: CandidateIdSchema,
    attempt: z.number().int().min(1).max(3),
    outcome: z.enum(['accepted', 'rejected', 'timed_out', 'cancelled'])
  })
  .strict()

export const RawToolCorrelationExpectationSchema = z
  .object({
    toolCallId: z.string().trim().min(1).max(128),
    callSequence: z.number().int().positive(),
    resultSequence: z.number().int().positive()
  })
  .strict()
  .refine(({ callSequence, resultSequence }) => resultSequence > callSequence, {
    message: 'resultSequence must be after callSequence',
    path: ['resultSequence']
  })

export const DemoScenarioFixtureSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    scenarioId: DemoScenarioIdSchema,
    seed: z.string().trim().min(1).max(128),
    initialRequest: InitialRequestSchema,
    tasks: z.array(TaskSchema).min(1),
    candidates: z.array(CandidateSchema),
    expectedBundles: z.array(TaskBundleSchema).max(10).optional(),
    expectedAssignments: z.array(AssignmentSchema).max(10).optional(),
    responseSequence: z.array(ScenarioResponseSchema),
    expectedRawToolCorrelations: z.array(RawToolCorrelationExpectationSchema).min(1),
    expectedEventTypes: z.array(AgentEventTypeSchema).min(1),
    expectedFinalResult: FinalResultSchema
  })
  .strict()
  .superRefine((fixture, context) => {
    const taskIds = new Set(fixture.tasks.map(({ taskId }) => taskId))
    const candidateIds = new Set(fixture.candidates.map(({ candidateId }) => candidateId))
    const expectedRunId = fixture.expectedFinalResult.runId

    if (fixture.expectedFinalResult.requestId !== fixture.initialRequest.requestId) {
      context.addIssue({
        code: 'custom',
        message: 'Final result requestId must match the initial request',
        path: ['expectedFinalResult', 'requestId']
      })
    }

    for (const [index, task] of fixture.tasks.entries()) {
      if (task.requestId !== fixture.initialRequest.requestId || task.runId !== expectedRunId) {
        context.addIssue({
          code: 'custom',
          message: 'Task context must match the fixture request and run',
          path: ['tasks', index]
        })
      }
      if (task.estimatedDurationMinutes > fixture.initialRequest.maxActivityDurationMinutes) {
        context.addIssue({
          code: 'custom',
          message: 'Task duration cannot exceed the initial request maximum',
          path: ['tasks', index, 'estimatedDurationMinutes']
        })
      }
    }

    for (const [index, candidate] of fixture.candidates.entries()) {
      const referencedTask = fixture.tasks.find(({ taskId }) => taskId === candidate.taskId)
      if (
        candidate.requestId !== fixture.initialRequest.requestId ||
        candidate.runId !== expectedRunId ||
        referencedTask === undefined ||
        referencedTask.runId !== candidate.runId
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Candidate context must reference this fixture request, run, and task',
          path: ['candidates', index]
        })
      }
    }

    for (const [index, bundle] of (fixture.expectedBundles ?? []).entries()) {
      if (bundle.runId !== expectedRunId || bundle.requestId !== fixture.initialRequest.requestId) {
        context.addIssue({
          code: 'custom',
          message: 'Bundle context must match the fixture request and run',
          path: ['expectedBundles', index]
        })
      }
      for (const taskId of bundle.taskIds) {
        if (!taskIds.has(taskId)) {
          context.addIssue({
            code: 'custom',
            message: 'Bundle references an unknown task',
            path: ['expectedBundles', index, 'taskIds']
          })
        }
      }
    }

    const expectedBundles = fixture.expectedBundles ?? []
    const expectedAssignments = fixture.expectedAssignments ?? []
    const bundleIds = new Set(expectedBundles.map(({ bundleId }) => bundleId))
    for (const [index, assignment] of expectedAssignments.entries()) {
      const bundle = expectedBundles.find(({ bundleId }) => bundleId === assignment.bundleId)
      if (
        assignment.runId !== expectedRunId ||
        assignment.requestId !== fixture.initialRequest.requestId ||
        !bundleIds.has(assignment.bundleId) ||
        !candidateIds.has(assignment.candidateId) ||
        bundle === undefined ||
        !haveSameTaskIds(bundle.taskIds, assignment.taskIds)
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Assignment must reference this fixture request, bundle, candidate, and bundle tasks',
          path: ['expectedAssignments', index]
        })
      }
    }

    const assignedTaskIds = expectedAssignments.flatMap(({ taskIds }) => taskIds)
    if (new Set(assignedTaskIds).size !== assignedTaskIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'A fixture task cannot appear in multiple expected assignments',
        path: ['expectedAssignments']
      })
    }

    for (const [index, assignment] of expectedAssignments.entries()) {
      for (const other of expectedAssignments.slice(index + 1)) {
        if (assignment.candidateId === other.candidateId && windowsOverlap(assignment, other)) {
          context.addIssue({
            code: 'custom',
            message: 'A fixture candidate cannot have overlapping expected assignments',
            path: ['expectedAssignments', index, 'scheduledWindow']
          })
        }
      }
    }

    for (const [index, taskResult] of fixture.expectedFinalResult.taskResults.entries()) {
      if (!taskIds.has(taskResult.taskId)) {
        context.addIssue({
          code: 'custom',
          message: 'Final result references an unknown task',
          path: ['expectedFinalResult', 'taskResults', index, 'taskId']
        })
      }
      if (
        taskResult.matchedCandidateId !== undefined &&
        !candidateIds.has(taskResult.matchedCandidateId)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Final result references an unknown candidate',
          path: ['expectedFinalResult', 'taskResults', index, 'matchedCandidateId']
        })
      }

      const matchedCandidate = fixture.candidates.find(
        ({ candidateId }) => candidateId === taskResult.matchedCandidateId
      )
      if (matchedCandidate !== undefined && matchedCandidate.taskId !== taskResult.taskId) {
        context.addIssue({
          code: 'custom',
          message: 'Matched candidate must belong to the task result task',
          path: ['expectedFinalResult', 'taskResults', index, 'matchedCandidateId']
        })
      }
    }

    for (const [index, response] of fixture.responseSequence.entries()) {
      if (!taskIds.has(response.taskId)) {
        context.addIssue({
          code: 'custom',
          message: 'Response references an unknown task',
          path: ['responseSequence', index, 'taskId']
        })
      }
      if (!candidateIds.has(response.candidateId)) {
        context.addIssue({
          code: 'custom',
          message: 'Response references an unknown candidate',
          path: ['responseSequence', index, 'candidateId']
        })
      }

      const candidate = fixture.candidates.find(
        ({ candidateId }) => candidateId === response.candidateId
      )
      if (candidate !== undefined && candidate.taskId !== response.taskId) {
        context.addIssue({
          code: 'custom',
          message: 'Response candidate must belong to the referenced task',
          path: ['responseSequence', index, 'candidateId']
        })
      }
    }

    if (fixture.expectedEventTypes.at(-1) !== 'request.completed') {
      context.addIssue({
        code: 'custom',
        message: 'A scenario must end with request.completed',
        path: ['expectedEventTypes']
      })
    }

    if (!fixture.expectedEventTypes.includes('sufficiency.checked')) {
      context.addIssue({
        code: 'custom',
        message: 'A demo scenario with a safe task must include sufficiency.checked',
        path: ['expectedEventTypes']
      })
    }

    const correlationIds = fixture.expectedRawToolCorrelations.map(({ toolCallId }) => toolCallId)
    if (new Set(correlationIds).size !== correlationIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Raw tool correlation IDs must be unique',
        path: ['expectedRawToolCorrelations']
      })
    }
  })

export type DemoScenarioId = z.infer<typeof DemoScenarioIdSchema>
export type ScenarioResponse = z.infer<typeof ScenarioResponseSchema>
export type RawToolCorrelationExpectation = z.infer<typeof RawToolCorrelationExpectationSchema>
export type DemoScenarioFixture = z.infer<typeof DemoScenarioFixtureSchema>
