import { describe, expect, it } from 'vitest'

import type { CandidateProfile, Task } from '@30-minute-exchange/contracts'

import { planBundleAssignments } from '../src/bundling/plan-bundle-assignments.js'

const requestContext = {
  schemaVersion: 2,
  runId: 'run_bundle_001',
  requestId: 'request_bundle_001'
} as const

function task(
  taskId: string,
  startAt: string,
  endAt: string,
  estimatedDurationMinutes: number,
  requiredExperience: string[] = []
): Task {
  return {
    ...requestContext,
    taskId,
    title: taskId,
    description: `${taskId} description`,
    timeWindow: { startAt, endAt },
    timeSource: 'explicit',
    timeCertainty: 'fixed',
    durationSource: 'explicit',
    region: { label: 'Synthetic District', approximateLocation: 'Synthetic zone' },
    requiredExperience,
    estimatedDurationMinutes,
    status: 'ready',
    missingInformation: []
  }
}

function candidate(
  candidateId: string,
  availabilityWindows: CandidateProfile['availabilityWindows'],
  experienceTags: string[]
): CandidateProfile {
  return {
    schemaVersion: 2,
    candidateId,
    displayName: candidateId,
    activityRegion: { label: 'Synthetic District', approximateLocation: 'Synthetic zone' },
    activityRadiusKm: 1,
    availabilityWindows,
    experienceTags,
    reliabilityRate: 0.9,
    isSimulation: true
  }
}

describe('planBundleAssignments', () => {
  it('moves an inherited flexible task into an eligible helper availability window', () => {
    const flexibleTask: Task = {
      ...task('task_flexible', '2026-08-01T17:00:00+09:00', '2026-08-01T21:00:00+09:00', 10),
      timeSource: 'inherited_request_window',
      timeCertainty: 'flexible',
      durationSource: 'llm_estimated'
    }
    const result = planBundleAssignments({
      tasks: [flexibleTask],
      candidateProfiles: [
        candidate(
          'candidate_evening',
          [{ startAt: '2026-08-01T18:00:00+09:00', endAt: '2026-08-01T19:00:00+09:00' }],
          []
        )
      ]
    })

    expect(result.assignments[0]?.candidateId).toBe('candidate_evening')
    expect(result.assignments[0]?.scheduledWindow.startAt).toBe('2026-08-01T09:00:00.000Z')
  })

  it('bundles short, compatible tasks for one helper', () => {
    const result = planBundleAssignments({
      tasks: [
        task('task_delivery', '2026-08-01T18:00:00+09:00', '2026-08-01T18:10:00+09:00', 8),
        task('task_walk', '2026-08-01T18:10:00+09:00', '2026-08-01T18:30:00+09:00', 15, [
          'dog_experience'
        ])
      ],
      candidateProfiles: [
        candidate(
          'candidate_alex',
          [{ startAt: '2026-08-01T17:50:00+09:00', endAt: '2026-08-01T18:40:00+09:00' }],
          ['dog_experience']
        )
      ]
    })

    expect(result.bundles).toHaveLength(1)
    expect(result.bundles[0]?.taskIds).toEqual(['task_delivery', 'task_walk'])
    expect(result.assignments).toHaveLength(1)
    expect(result.assignments[0]?.candidateId).toBe('candidate_alex')
  })

  it('splits tasks across helpers when the fixed gap exceeds twenty minutes', () => {
    const result = planBundleAssignments({
      tasks: [
        task('task_meal', '2026-08-01T18:00:00+09:00', '2026-08-01T18:10:00+09:00', 5),
        task('task_dog_walk', '2026-08-01T19:30:00+09:00', '2026-08-01T20:00:00+09:00', 15, [
          'dog_experience'
        ])
      ],
      candidateProfiles: [
        candidate(
          'candidate_meal',
          [{ startAt: '2026-08-01T17:45:00+09:00', endAt: '2026-08-01T18:30:00+09:00' }],
          []
        ),
        candidate(
          'candidate_dog',
          [{ startAt: '2026-08-01T19:20:00+09:00', endAt: '2026-08-01T20:10:00+09:00' }],
          ['dog_experience']
        )
      ]
    })

    expect(result.bundles).toHaveLength(2)
    expect(result.assignments.map(({ candidateId }) => candidateId)).toEqual([
      'candidate_meal',
      'candidate_dog'
    ])
    expect(result.splitReasonCodes).toContain('waiting_time_exceeds_twenty_minutes')
  })

  it('splits tasks when combined active time exceeds thirty minutes', () => {
    const result = planBundleAssignments({
      tasks: [
        task('task_one', '2026-08-01T18:00:00+09:00', '2026-08-01T18:20:00+09:00', 20),
        task('task_two', '2026-08-01T18:20:00+09:00', '2026-08-01T18:40:00+09:00', 15)
      ],
      candidateProfiles: [
        candidate(
          'candidate_one',
          [{ startAt: '2026-08-01T17:45:00+09:00', endAt: '2026-08-01T18:30:00+09:00' }],
          []
        ),
        candidate(
          'candidate_two',
          [{ startAt: '2026-08-01T18:15:00+09:00', endAt: '2026-08-01T18:50:00+09:00' }],
          []
        )
      ]
    })

    expect(result.bundles).toHaveLength(2)
    expect(result.splitReasonCodes).toContain('helper_duration_exceeds_thirty_minutes')
  })

  it('splits a feasible bundle when no single candidate meets every requirement', () => {
    const result = planBundleAssignments({
      tasks: [
        task('task_delivery', '2026-08-01T18:00:00+09:00', '2026-08-01T18:10:00+09:00', 8),
        task('task_walk', '2026-08-01T18:10:00+09:00', '2026-08-01T18:30:00+09:00', 15, [
          'dog_experience'
        ])
      ],
      candidateProfiles: [
        candidate(
          'candidate_delivery',
          [{ startAt: '2026-08-01T17:50:00+09:00', endAt: '2026-08-01T18:15:00+09:00' }],
          []
        ),
        candidate(
          'candidate_walk',
          [{ startAt: '2026-08-01T18:05:00+09:00', endAt: '2026-08-01T18:40:00+09:00' }],
          ['dog_experience']
        )
      ]
    })

    expect(result.assignments.map(({ candidateId }) => candidateId)).toEqual([
      'candidate_delivery',
      'candidate_walk'
    ])
    expect(result.splitReasonCodes).toContain('no_single_candidate_for_bundle')
  })

  it('returns a task that cannot fit its time window as unassigned', () => {
    const result = planBundleAssignments({
      tasks: [task('task_too_long', '2026-08-01T18:00:00+09:00', '2026-08-01T18:10:00+09:00', 20)],
      candidateProfiles: []
    })

    expect(result.bundles).toEqual([])
    expect(result.unassignedTaskIds).toEqual(['task_too_long'])
    expect(result.splitReasonCodes).toContain('task_window_cannot_fit_estimated_duration')
  })

  it('holds a legacy task that has no scheduling metadata', () => {
    const legacyTask: Task = {
      ...task('task_legacy', '2026-08-01T18:00:00+09:00', '2026-08-01T18:20:00+09:00', 10),
      durationSource: undefined,
      timeSource: undefined,
      timeCertainty: undefined
    }
    const result = planBundleAssignments({ tasks: [legacyTask], candidateProfiles: [] })

    expect(result.unassignedTaskIds).toEqual(['task_legacy'])
    expect(result.splitReasonCodes).toContain('task_schedule_metadata_missing')
  })

  it('keeps a task out of matching until safety and sufficiency mark it ready', () => {
    const blockedTask: Task = {
      ...task('task_blocked', '2026-08-01T18:00:00+09:00', '2026-08-01T18:20:00+09:00', 10),
      status: 'blocked'
    }
    const result = planBundleAssignments({
      tasks: [blockedTask],
      candidateProfiles: [
        candidate(
          'candidate_available',
          [{ startAt: '2026-08-01T17:50:00+09:00', endAt: '2026-08-01T18:30:00+09:00' }],
          []
        )
      ]
    })

    expect(result.assignments).toEqual([])
    expect(result.unassignedTaskIds).toEqual(['task_blocked'])
    expect(result.splitReasonCodes).toContain('task_not_ready_for_assignment')
  })
})
