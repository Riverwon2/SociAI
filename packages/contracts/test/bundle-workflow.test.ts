import { describe, expect, it } from 'vitest'

import {
  AgentEventSchema,
  BuildTaskBundlesCallSchema,
  BuildTaskBundlesResultSchema,
  FindCandidatesForBundleCallSchema,
  FindCandidatesForBundleResultSchema,
  PlannedAssignmentSchema,
  SendBundleOutreachCallSchema
} from '../src/index.js'

const context = {
  schemaVersion: 2,
  runId: 'run_bundle_workflow_001',
  requestId: 'request_bundle_workflow_001'
} as const

const window = {
  startAt: '2026-08-01T18:00:00.000Z',
  endAt: '2026-08-01T18:30:00.000Z'
} as const

const task = {
  ...context,
  taskId: 'task_bundle_workflow_001',
  title: 'Synthetic delivery',
  description: 'Deliver a synthetic meal.',
  timeWindow: window,
  region: { label: 'Synthetic district', approximateLocation: 'Synthetic point' },
  requiredExperience: [],
  estimatedDurationMinutes: 10,
  durationSource: 'explicit',
  timeSource: 'explicit',
  timeCertainty: 'fixed',
  status: 'ready',
  missingInformation: []
} as const

const bundle = {
  ...context,
  bundleId: 'bundle_workflow_001',
  taskIds: [task.taskId],
  scheduledWindow: window,
  totalActivityDurationMinutes: 10,
  waitingMinutes: 0,
  requiredExperience: [],
  reasonCodes: ['single_task_bundle']
} as const

const assignment = {
  ...context,
  assignmentId: 'assignment_workflow_001',
  bundleId: bundle.bundleId,
  candidateId: 'candidate_workflow_001',
  taskIds: bundle.taskIds,
  scheduledWindow: bundle.scheduledWindow,
  attempt: 1,
  status: 'planned',
  isSimulation: true
} as const

describe('bundle workflow contracts', () => {
  it('models a pre-acceptance assignment as a planned attempt', () => {
    expect(PlannedAssignmentSchema.parse(assignment)).toEqual(assignment)
    expect(() => PlannedAssignmentSchema.parse({ ...assignment, attempt: 4 })).toThrow()
    expect(() => PlannedAssignmentSchema.parse({ ...assignment, status: 'accepted' })).toThrow()
  })

  it('separates deterministic task bundling from candidate selection', () => {
    const call = {
      ...context,
      toolCallId: 'call_build_bundles_001',
      tasks: [task]
    } as const
    const result = {
      ...context,
      toolCallId: call.toolCallId,
      ok: true,
      data: {
        processedTaskIds: [task.taskId],
        bundles: [bundle],
        heldTaskIds: [],
        splitReasonCodes: []
      }
    } as const

    expect(BuildTaskBundlesCallSchema.parse(call)).toEqual(call)
    expect(BuildTaskBundlesResultSchema.parse(result)).toEqual(result)
  })

  it('accepts contract-valid deterministic tool failures without producing assignments', () => {
    const failure = {
      ...context,
      toolCallId: 'call_bundle_failure_001',
      ok: false,
      error: {
        code: 'dependency_failure',
        message: 'Synthetic dependency failure.',
        retryable: false
      }
    } as const

    expect(BuildTaskBundlesResultSchema.parse(failure)).toEqual(failure)
    expect(FindCandidatesForBundleResultSchema.parse(failure)).toEqual(failure)
  })

  it('limits a simulated bundle outreach to ten seconds', () => {
    const call = {
      ...context,
      toolCallId: 'call_bundle_outreach_001',
      assignment,
      bundle,
      timeoutSeconds: 10,
      seed: 'first-candidate-accepts'
    } as const

    expect(SendBundleOutreachCallSchema.parse(call)).toEqual(call)
    expect(() => SendBundleOutreachCallSchema.parse({ ...call, timeoutSeconds: 11 })).toThrow()
  })

  it('returns candidates ranked for a whole bundle rather than one task', () => {
    const candidateProfile = {
      schemaVersion: context.schemaVersion,
      candidateId: assignment.candidateId,
      displayName: 'Synthetic helper',
      activityRegion: task.region,
      activityRadiusKm: 1,
      availabilityWindows: [window],
      experienceTags: [],
      reliabilityRate: 0.9,
      isSimulation: true
    } as const
    const call = {
      ...context,
      toolCallId: 'call_bundle_candidates_001',
      bundle,
      candidateProfiles: [candidateProfile],
      plannedAssignments: []
    } as const
    const result = {
      ...context,
      toolCallId: call.toolCallId,
      ok: true,
      data: {
        candidates: [
          {
            ...context,
            bundleId: bundle.bundleId,
            candidateId: candidateProfile.candidateId,
            displayName: candidateProfile.displayName,
            activityRegion: candidateProfile.activityRegion,
            experienceTags: candidateProfile.experienceTags,
            reliabilityRate: candidateProfile.reliabilityRate,
            rank: 1,
            isSimulation: true
          }
        ],
        excludedCount: 0,
        rankingPolicyVersion: 'bundle-reliability-v1'
      }
    } as const

    expect(FindCandidatesForBundleCallSchema.parse(call)).toEqual(call)
    expect(FindCandidatesForBundleResultSchema.parse(result)).toEqual(result)
  })

  it('correlates a bundle timeout to its planned assignment in seconds', () => {
    const event = {
      ...context,
      eventId: 'event_bundle_timeout_001',
      taskId: task.taskId,
      sequence: 7,
      occurredAt: '2026-08-01T18:00:10.000Z',
      message: 'Synthetic candidate did not respond before the deadline.',
      isSimulation: true,
      type: 'outreach.timed_out',
      data: {
        assignmentId: assignment.assignmentId,
        candidateId: assignment.candidateId,
        attempt: assignment.attempt,
        waitedSeconds: 10
      }
    } as const

    expect(AgentEventSchema.parse(event)).toEqual(event)
  })

  it('records bundle candidates without pretending they are task-level candidates', () => {
    const event = {
      ...context,
      eventId: 'event_bundle_candidates_001',
      sequence: 8,
      occurredAt: '2026-08-01T18:00:10.000Z',
      message: 'Synthetic bundle candidates ranked.',
      isSimulation: true,
      type: 'bundle.candidates.ranked',
      data: {
        bundleId: bundle.bundleId,
        candidates: [
          {
            ...context,
            bundleId: bundle.bundleId,
            candidateId: assignment.candidateId,
            displayName: 'Synthetic helper',
            activityRegion: task.region,
            experienceTags: [],
            reliabilityRate: 0.9,
            rank: 1,
            isSimulation: true
          }
        ],
        scoringPolicyVersion: 'bundle-reliability-v1'
      }
    } as const

    expect(AgentEventSchema.parse(event)).toEqual(event)
    expect(() =>
      AgentEventSchema.parse({ ...event, data: { ...event.data, bundleId: 'bundle_other_001' } })
    ).toThrow()
  })
})
