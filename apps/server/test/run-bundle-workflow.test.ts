import { describe, expect, it } from 'vitest'

import {
  CheckSafetyResultSchema,
  CheckSufficiencyResultSchema,
  FindCandidatesForBundleResultSchema,
  SCHEMA_VERSION,
  SendBundleOutreachResultSchema,
  type CandidateProfile,
  type Task
} from '@30-minute-exchange/contracts'
import {
  buildTaskBundles,
  checkSafety,
  checkSufficiency,
  findCandidatesForBundle
} from '@30-minute-exchange/decisions'
import { sendBundleOutreach } from '@30-minute-exchange/simulator'

import { fixedInitialRequest } from '../src/fixtures/fixed-initial-request.js'
import {
  decomposeFixedRequest,
  type TaskPlanner
} from '../src/orchestration/decompose-fixed-request.js'
import {
  runBundleWorkflow,
  type BundleWorkflowTools
} from '../src/orchestration/run-bundle-workflow.js'
import {
  createWorkflowHookEmitter,
  type WorkflowHook
} from '../src/orchestration/workflow-hooks.js'

const runId = 'run-bundle-workflow-test'
const occurredAt = '2026-08-01T09:00:00.000Z'

const task: Task = {
  schemaVersion: SCHEMA_VERSION,
  runId,
  requestId: fixedInitialRequest.requestId,
  taskId: 'task-library-return',
  title: 'Return library books',
  description: 'Accompany the requester to return reserved books.',
  timeWindow: fixedInitialRequest.timeWindow,
  region: fixedInitialRequest.activityRegion,
  requiredExperience: ['library visit support'],
  estimatedDurationMinutes: 20,
  durationSource: 'llm_estimated',
  timeSource: 'inherited_request_window',
  timeCertainty: 'flexible',
  status: 'created',
  missingInformation: []
}

const candidateProfiles: readonly CandidateProfile[] = ['alpha', 'beta', 'gamma'].map(
  (candidateId, index) => ({
    schemaVersion: SCHEMA_VERSION,
    candidateId: `candidate-${candidateId}`,
    displayName: `Neighbor ${candidateId}`,
    activityRegion: fixedInitialRequest.activityRegion,
    activityRadiusKm: 1,
    availabilityWindows: [fixedInitialRequest.timeWindow],
    experienceTags: ['library visit support'],
    reliabilityRate: 0.99 - index / 100,
    isSimulation: true
  })
)

const planner: TaskPlanner = {
  decompose: async () => ({
    tasks: [task],
    summary: 'This is a proposed execution plan, not a confirmed match.'
  })
}

function createDecompositionPlanner(taskOutput: Task): TaskPlanner {
  return {
    decompose: async () => ({
      tasks: [taskOutput],
      summary: 'This is a proposed execution plan, not a confirmed match.'
    })
  }
}

const defaultTools: BundleWorkflowTools = {
  buildTaskBundles,
  checkSafety,
  checkSufficiency,
  findCandidatesForBundle,
  sendBundleOutreach
}

describe('runBundleWorkflow', () => {
  it('retries exactly one next bundle candidate after a rejection and confirms acceptance', async () => {
    const trace: WorkflowHook[] = []
    const hooks = createWorkflowHookEmitter({
      occurredAt,
      onHook: (event) => trace.push(event)
    })
    const decomposed = await decomposeFixedRequest({
      planner,
      initialRequest: fixedInitialRequest,
      runId,
      occurredAt,
      hooks
    })

    const result = runBundleWorkflow({
      initialRequest: fixedInitialRequest,
      tasks: decomposed.tasks,
      initialEvents: decomposed.events,
      candidateProfiles,
      seed: 'retry-path-v1',
      occurredAt,
      hooks
    })

    expect(result.finalResult.status).toBe('fully_matched')
    expect(result.assignmentResults.map(({ status }) => status)).toEqual(['rejected', 'accepted'])
    expect(result.events.map(({ type }) => type)).toContain('bundles.planned')
    expect(result.events.map(({ type }) => type)).toContain('bundle.candidates.ranked')
    expect(result.events.filter(({ type }) => type === 'outreach.sent')).toHaveLength(2)
    expect(result.events.at(-1)?.type).toBe('request.completed')
    expect(result.events.map(({ sequence }) => sequence)).toEqual(
      result.events.map((_, index) => index + 1)
    )
    expect(trace.map(({ stage }) => stage)).toEqual(
      expect.arrayContaining([
        'input.validation',
        'task.decomposition',
        'safety.check',
        'sufficiency.check',
        'bundle.planning',
        'candidate.search',
        'outreach',
        'match.confirmation',
        'final.output'
      ])
    )
    expect(trace.map(({ sequence }) => sequence)).toEqual(trace.map((_, index) => index + 1))
  })

  it('sends every bundle first-choice outreach before processing any reply', async () => {
    const groceryTask: Task = {
      ...task,
      taskId: 'task-grocery-delivery',
      title: 'Deliver groceries',
      description: 'Deliver the groceries during the assigned window.',
      timeWindow: {
        startAt: '2026-08-03T10:20:00+09:00',
        endAt: '2026-08-03T10:50:00+09:00'
      },
      timeSource: 'explicit',
      timeCertainty: 'fixed',
      durationSource: 'explicit',
      requiredExperience: ['grocery delivery'],
      estimatedDurationMinutes: 20
    }
    const decomposed = await decomposeFixedRequest({
      planner: {
        decompose: async () => ({
          tasks: [task, groceryTask],
          summary: 'This is a proposed execution plan, not a confirmed match.'
        })
      },
      initialRequest: fixedInitialRequest,
      runId,
      occurredAt
    })
    const [libraryProfile, groceryProfile] = candidateProfiles
    if (libraryProfile === undefined || groceryProfile === undefined) {
      throw new Error('Expected two synthetic candidate profiles')
    }
    const profiles: readonly CandidateProfile[] = [
      {
        ...libraryProfile,
        availabilityWindows: [
          { startAt: '2026-08-03T10:00:00+09:00', endAt: '2026-08-03T11:00:00+09:00' }
        ]
      },
      {
        ...groceryProfile,
        availabilityWindows: [
          { startAt: '2026-08-03T10:00:00+09:00', endAt: '2026-08-03T11:00:00+09:00' }
        ],
        experienceTags: ['grocery delivery']
      }
    ]

    const result = runBundleWorkflow({
      initialRequest: fixedInitialRequest,
      tasks: decomposed.tasks,
      initialEvents: decomposed.events,
      candidateProfiles: profiles,
      seed: 'happy-path-v1',
      occurredAt
    })
    const eventTypes = result.events.map(({ type }) => type)
    const lastFirstRoundOutreach = eventTypes.lastIndexOf('outreach.sent')
    const firstReply = eventTypes.indexOf('neighbor.replied')

    expect(result.bundles).toHaveLength(2)
    expect(result.assignmentResults.map(({ attempt }) => attempt)).toEqual([1, 1])
    expect(eventTypes.filter((type) => type === 'outreach.sent')).toHaveLength(2)
    expect(lastFirstRoundOutreach).toBeLessThan(firstReply)
    expect(result.finalResult.status).toBe('fully_matched')
  })

  it('retries once after a ten-second timeout and confirms the next candidate', async () => {
    const decomposed = await decomposeFixedRequest({
      planner,
      initialRequest: fixedInitialRequest,
      runId,
      occurredAt
    })

    const result = runBundleWorkflow({
      initialRequest: fixedInitialRequest,
      tasks: decomposed.tasks,
      initialEvents: decomposed.events,
      candidateProfiles,
      seed: 'timeout-retry-path-v1',
      occurredAt
    })

    expect(result.assignmentResults.map(({ status }) => status)).toEqual(['timed_out', 'accepted'])
    expect(result.events.find(({ type }) => type === 'outreach.timed_out')).toMatchObject({
      data: { waitedSeconds: 10 }
    })
    expect(result.finalResult.status).toBe('fully_matched')
  })

  it('marks a bundle unmatched after the initial candidate and one retry both reject', async () => {
    const decomposed = await decomposeFixedRequest({
      planner,
      initialRequest: fixedInitialRequest,
      runId,
      occurredAt
    })
    const tools: BundleWorkflowTools = {
      ...defaultTools,
      sendBundleOutreach: (input) =>
        SendBundleOutreachResultSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          runId: input.runId,
          requestId: input.requestId,
          toolCallId: input.toolCallId,
          ok: true,
          data: {
            assignmentId: input.assignment.assignmentId,
            candidateId: input.assignment.candidateId,
            outcome: 'rejected',
            virtualElapsedSeconds: 1,
            respondedAt: input.assignment.scheduledWindow.startAt
          }
        })
    }

    const result = runBundleWorkflow({
      initialRequest: fixedInitialRequest,
      tasks: decomposed.tasks,
      initialEvents: decomposed.events,
      candidateProfiles,
      seed: 'fixture-two-rejections',
      occurredAt,
      tools
    })

    expect(result.assignmentResults.map(({ status }) => status)).toEqual(['rejected', 'rejected'])
    expect(result.finalResult.status).toBe('unmatched')
    expect(result.finalResult.taskResults).toMatchObject([
      { status: 'unmatched', reasonCodes: ['candidate_attempt_limit_reached'] }
    ])
  })

  it('excludes a high-risk task without attempting candidate outreach', async () => {
    const decomposed = await decomposeFixedRequest({
      planner: createDecompositionPlanner({ ...task, taskId: 'task-high-risk' }),
      initialRequest: fixedInitialRequest,
      runId,
      occurredAt
    })
    const tools: BundleWorkflowTools = {
      ...defaultTools,
      checkSafety: (input) =>
        CheckSafetyResultSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          runId: input.runId,
          requestId: input.requestId,
          taskId: input.taskId,
          toolCallId: input.toolCallId,
          ok: true,
          data: {
            schemaVersion: SCHEMA_VERSION,
            runId: input.runId,
            requestId: input.requestId,
            taskId: input.taskId,
            level: 'high',
            action: 'block',
            reasonCodes: ['synthetic_high_risk'],
            conditions: [],
            guidance: 'Synthetic high-risk task is excluded.'
          }
        })
    }

    const result = runBundleWorkflow({
      initialRequest: fixedInitialRequest,
      tasks: decomposed.tasks,
      initialEvents: decomposed.events,
      candidateProfiles,
      seed: 'happy-path-v1',
      occurredAt,
      tools
    })

    expect(result.finalResult.status).toBe('safety_excluded')
    expect(result.events.map(({ type }) => type)).toContain('task.blocked')
    expect(result.events.map(({ type }) => type)).not.toContain('outreach.sent')
  })

  it('holds a task with insufficient information without candidate outreach', async () => {
    const incompleteTask = {
      ...task,
      taskId: 'task-insufficient-information',
      missingInformation: [{ code: 'door_access', message: 'Door access is unknown.' }]
    }
    const decomposed = await decomposeFixedRequest({
      planner: createDecompositionPlanner(incompleteTask),
      initialRequest: fixedInitialRequest,
      runId,
      occurredAt
    })
    const tools: BundleWorkflowTools = {
      ...defaultTools,
      checkSufficiency: (input) =>
        CheckSufficiencyResultSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          runId: input.runId,
          requestId: input.requestId,
          taskId: input.taskId,
          toolCallId: input.toolCallId,
          ok: true,
          data: {
            schemaVersion: SCHEMA_VERSION,
            runId: input.runId,
            requestId: input.requestId,
            taskId: input.taskId,
            status: 'insufficient',
            action: 'hold',
            reasonCodes: ['missing_required_information'],
            missingInformation: incompleteTask.missingInformation,
            guidance: 'Synthetic information check held this task.'
          }
        })
    }

    const result = runBundleWorkflow({
      initialRequest: fixedInitialRequest,
      tasks: decomposed.tasks,
      initialEvents: decomposed.events,
      candidateProfiles,
      seed: 'happy-path-v1',
      occurredAt,
      tools
    })

    expect(result.finalResult.status).toBe('unmatched')
    expect(result.finalResult.taskResults).toMatchObject([{ status: 'held' }])
    expect(result.events.map(({ type }) => type)).toContain('task.held')
  })

  it('holds a conditional task until required safety conditions can be verified', async () => {
    const decomposed = await decomposeFixedRequest({
      planner: createDecompositionPlanner({ ...task, taskId: 'task-conditional' }),
      initialRequest: fixedInitialRequest,
      runId,
      occurredAt
    })
    const tools: BundleWorkflowTools = {
      ...defaultTools,
      checkSafety: (input) =>
        CheckSafetyResultSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          runId: input.runId,
          requestId: input.requestId,
          taskId: input.taskId,
          toolCallId: input.toolCallId,
          ok: true,
          data: {
            schemaVersion: SCHEMA_VERSION,
            runId: input.runId,
            requestId: input.requestId,
            taskId: input.taskId,
            level: 'conditional',
            action: 'verify_conditions',
            reasonCodes: ['synthetic_condition'],
            conditions: ['Synthetic verification is required.']
          }
        })
    }

    const result = runBundleWorkflow({
      initialRequest: fixedInitialRequest,
      tasks: decomposed.tasks,
      initialEvents: decomposed.events,
      candidateProfiles,
      seed: 'happy-path-v1',
      occurredAt,
      tools
    })

    expect(result.finalResult.taskResults).toMatchObject([{ status: 'held' }])
    expect(result.events.map(({ type }) => type)).not.toContain('sufficiency.checked')
  })

  it('records an outreach tool failure and marks only its bundle unmatched', async () => {
    const decomposed = await decomposeFixedRequest({
      planner,
      initialRequest: fixedInitialRequest,
      runId,
      occurredAt
    })
    const tools: BundleWorkflowTools = {
      ...defaultTools,
      sendBundleOutreach: (input) =>
        SendBundleOutreachResultSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          runId: input.runId,
          requestId: input.requestId,
          toolCallId: input.toolCallId,
          ok: false,
          error: {
            code: 'dependency_failure',
            message: 'Synthetic outreach failure.',
            retryable: false
          }
        })
    }

    const result = runBundleWorkflow({
      initialRequest: fixedInitialRequest,
      tasks: decomposed.tasks,
      initialEvents: decomposed.events,
      candidateProfiles,
      seed: 'happy-path-v1',
      occurredAt,
      tools
    })

    expect(result.finalResult.status).toBe('unmatched')
    expect(result.events.map(({ type }) => type)).toContain('tool.failed')
  })

  it('records a candidate search tool failure as a bounded unmatched bundle', async () => {
    const decomposed = await decomposeFixedRequest({
      planner,
      initialRequest: fixedInitialRequest,
      runId,
      occurredAt
    })
    const tools: BundleWorkflowTools = {
      ...defaultTools,
      findCandidatesForBundle: (input) =>
        FindCandidatesForBundleResultSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          runId: input.runId,
          requestId: input.requestId,
          toolCallId: input.toolCallId,
          ok: false,
          error: {
            code: 'dependency_failure',
            message: 'Synthetic candidate search failure.',
            retryable: false
          }
        })
    }

    const result = runBundleWorkflow({
      initialRequest: fixedInitialRequest,
      tasks: decomposed.tasks,
      initialEvents: decomposed.events,
      candidateProfiles,
      seed: 'happy-path-v1',
      occurredAt,
      tools
    })

    expect(result.events.map(({ type }) => type)).toContain('tool.failed')
  })

  it('finishes an exhausted bundle as unmatched when no candidate is eligible', async () => {
    const decomposed = await decomposeFixedRequest({
      planner,
      initialRequest: fixedInitialRequest,
      runId,
      occurredAt
    })

    const result = runBundleWorkflow({
      initialRequest: fixedInitialRequest,
      tasks: decomposed.tasks,
      initialEvents: decomposed.events,
      candidateProfiles: [],
      seed: 'happy-path-v1',
      occurredAt
    })

    expect(result.finalResult.status).toBe('unmatched')
    expect(result.finalResult.taskResults).toMatchObject([{ status: 'unmatched' }])
    expect(result.events.map(({ type }) => type)).toContain('plan.updated')
  })

  it('rejects a workflow that is not preceded by decomposition events', () => {
    expect(() =>
      runBundleWorkflow({
        initialRequest: fixedInitialRequest,
        tasks: [task],
        initialEvents: [],
        candidateProfiles,
        seed: 'happy-path-v1',
        occurredAt
      })
    ).toThrow(/Initial decomposition events are required/)
  })
})
