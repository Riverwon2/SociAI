import { describe, expect, it } from 'vitest'

import type { CandidateProfile, Task } from '@30-minute-exchange/contracts'

import { planBundleAssignments } from '../bundling/plan-bundle-assignments.js'

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

  it('places a flexible task after a fixed task when that is the feasible bundle order', () => {
    const flexibleTask: Task = {
      ...task('task_flexible_after', '2026-08-01T17:00:00+09:00', '2026-08-01T19:00:00+09:00', 20),
      timeSource: 'inherited_request_window',
      timeCertainty: 'flexible'
    }
    const fixedTask = task(
      'task_fixed_first',
      '2026-08-01T18:00:00+09:00',
      '2026-08-01T18:10:00+09:00',
      10
    )
    const result = planBundleAssignments({
      tasks: [flexibleTask, fixedTask],
      candidateProfiles: [
        candidate(
          'candidate_exact_window',
          [{ startAt: '2026-08-01T18:00:00+09:00', endAt: '2026-08-01T18:30:00+09:00' }],
          []
        )
      ]
    })

    expect(result.bundles).toHaveLength(1)
    expect(result.assignments).toHaveLength(1)
    expect(result.assignments[0]?.taskIds).toEqual(['task_flexible_after', 'task_fixed_first'])
    expect(result.assignments[0]?.scheduledWindow).toEqual({
      startAt: '2026-08-01T09:00:00.000Z',
      endAt: '2026-08-01T09:30:00.000Z'
    })
    expect(result.unassignedTaskIds).toEqual([])
  })

  it('places a flexible task before a fixed task when its deadline requires it', () => {
    const flexibleTask: Task = {
      ...task('task_flexible_before', '2026-08-01T17:40:00+09:00', '2026-08-01T18:00:00+09:00', 20),
      timeCertainty: 'flexible'
    }
    const fixedTask = task(
      'task_fixed_last',
      '2026-08-01T18:00:00+09:00',
      '2026-08-01T18:10:00+09:00',
      10
    )
    const result = planBundleAssignments({
      tasks: [fixedTask, flexibleTask],
      candidateProfiles: [
        candidate(
          'candidate_before_fixed',
          [{ startAt: '2026-08-01T17:40:00+09:00', endAt: '2026-08-01T18:10:00+09:00' }],
          []
        )
      ]
    })

    expect(result.bundles).toHaveLength(1)
    expect(result.assignments[0]?.scheduledWindow).toEqual({
      startAt: '2026-08-01T08:40:00.000Z',
      endAt: '2026-08-01T09:10:00.000Z'
    })
  })

  it('uses flexible activity between fixed tasks to keep effective waiting within twenty minutes', () => {
    const flexibleTask: Task = {
      ...task(
        'task_flexible_between',
        '2026-08-01T18:05:00+09:00',
        '2026-08-01T18:40:00+09:00',
        15
      ),
      timeCertainty: 'flexible'
    }
    const result = planBundleAssignments({
      tasks: [
        task('task_fixed_open', '2026-08-01T18:00:00+09:00', '2026-08-01T18:10:00+09:00', 5),
        flexibleTask,
        task('task_fixed_close', '2026-08-01T18:40:00+09:00', '2026-08-01T18:50:00+09:00', 5)
      ],
      candidateProfiles: [
        candidate(
          'candidate_gap_filler',
          [{ startAt: '2026-08-01T17:50:00+09:00', endAt: '2026-08-01T18:50:00+09:00' }],
          []
        )
      ]
    })

    expect(result.bundles).toHaveLength(1)
    expect(result.bundles[0]?.waitingMinutes).toBe(20)
    expect(result.splitReasonCodes).not.toContain('waiting_time_exceeds_twenty_minutes')
  })

  it('produces the same mixed fixed-flexible plan regardless of task input order', () => {
    const flexibleTask: Task = {
      ...task('task_order_flexible', '2026-08-01T17:00:00+09:00', '2026-08-01T19:00:00+09:00', 20),
      timeCertainty: 'flexible'
    }
    const fixedTask = task(
      'task_order_fixed',
      '2026-08-01T18:00:00+09:00',
      '2026-08-01T18:10:00+09:00',
      10
    )
    const profiles = [
      candidate(
        'candidate_order_stable',
        [{ startAt: '2026-08-01T18:00:00+09:00', endAt: '2026-08-01T18:30:00+09:00' }],
        []
      )
    ]

    const forward = planBundleAssignments({
      tasks: [flexibleTask, fixedTask],
      candidateProfiles: profiles
    })
    const reversed = planBundleAssignments({
      tasks: [fixedTask, flexibleTask],
      candidateProfiles: profiles
    })

    expect(reversed).toEqual(forward)
  })

  it('does not create a bundle that exceeds the helper availability end', () => {
    const flexibleTask: Task = {
      ...task(
        'task_boundary_flexible',
        '2026-08-01T17:00:00+09:00',
        '2026-08-01T19:00:00+09:00',
        20
      ),
      timeCertainty: 'flexible'
    }
    const fixedTask = task(
      'task_boundary_fixed',
      '2026-08-01T18:00:00+09:00',
      '2026-08-01T18:10:00+09:00',
      10
    )
    const availabilityEndAt = '2026-08-01T18:29:00+09:00'
    const result = planBundleAssignments({
      tasks: [flexibleTask, fixedTask],
      candidateProfiles: [
        candidate(
          'candidate_short_boundary',
          [{ startAt: '2026-08-01T18:00:00+09:00', endAt: availabilityEndAt }],
          []
        )
      ]
    })

    expect(result.assignments.every(({ taskIds }) => taskIds.length === 1)).toBe(true)
    expect(
      result.assignments.every(
        ({ scheduledWindow }) => Date.parse(scheduledWindow.endAt) <= Date.parse(availabilityEndAt)
      )
    ).toBe(true)
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

  it('keeps fixed tasks together when their waiting time is exactly twenty minutes', () => {
    const result = planBundleAssignments({
      tasks: [
        task('task_first', '2026-08-01T18:00:00+09:00', '2026-08-01T18:10:00+09:00', 10),
        task('task_second', '2026-08-01T18:30:00+09:00', '2026-08-01T18:40:00+09:00', 10)
      ],
      candidateProfiles: [
        candidate(
          'candidate_at_limit',
          [{ startAt: '2026-08-01T17:50:00+09:00', endAt: '2026-08-01T18:50:00+09:00' }],
          []
        )
      ]
    })

    expect(result.bundles).toHaveLength(1)
    expect(result.bundles[0]?.waitingMinutes).toBe(20)
  })

  it('splits fixed tasks when their waiting time exceeds twenty minutes by one second', () => {
    const result = planBundleAssignments({
      tasks: [
        task(
          'task_second_precision_first',
          '2026-08-01T18:00:00+09:00',
          '2026-08-01T18:01:00+09:00',
          1
        ),
        task(
          'task_second_precision_next',
          '2026-08-01T18:21:01+09:00',
          '2026-08-01T18:22:01+09:00',
          1
        )
      ],
      candidateProfiles: [
        candidate(
          'candidate_second_precision',
          [{ startAt: '2026-08-01T17:50:00+09:00', endAt: '2026-08-01T18:30:00+09:00' }],
          []
        )
      ]
    })

    expect(result.bundles).toHaveLength(2)
    expect(result.splitReasonCodes).toContain('waiting_time_exceeds_twenty_minutes')
  })

  it('does not count gaps between flexible tasks as fixed-task waiting', () => {
    const first: Task = {
      ...task('task_flexible_first', '2026-08-01T18:00:00+09:00', '2026-08-01T18:10:00+09:00', 10),
      timeCertainty: 'flexible'
    }
    const second: Task = {
      ...task('task_flexible_second', '2026-08-01T19:00:00+09:00', '2026-08-01T19:10:00+09:00', 10),
      timeCertainty: 'flexible'
    }
    const result = planBundleAssignments({
      tasks: [first, second],
      candidateProfiles: [
        candidate(
          'candidate_flexible',
          [{ startAt: '2026-08-01T17:50:00+09:00', endAt: '2026-08-01T19:20:00+09:00' }],
          []
        )
      ]
    })

    expect(result.bundles).toHaveLength(1)
    expect(result.bundles[0]?.waitingMinutes).toBe(0)
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

  it('bounds dense flexible-task search when ten tasks cannot share one window', () => {
    const denseTasks = Array.from({ length: 10 }, (_, index): Task => ({
      ...task(`task_dense_${index}`, '2026-08-01T18:00:00+09:00', '2026-08-01T18:27:00+09:00', 3),
      timeCertainty: 'flexible'
    }))

    const result = planBundleAssignments({ tasks: denseTasks, candidateProfiles: [] })

    expect(result.bundles).toHaveLength(10)
    expect(result.unassignedTaskIds).toHaveLength(10)
    expect(result.splitReasonCodes).toContain('task_windows_do_not_align')
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

  it('rejects an LLM-estimated duration over twenty minutes at the decision boundary', () => {
    const invalidLlmEstimate: Task = {
      ...task('task_llm_too_long', '2026-08-01T18:00:00+09:00', '2026-08-01T18:30:00+09:00', 21),
      durationSource: 'llm_estimated',
      timeCertainty: 'flexible'
    }
    const result = planBundleAssignments({
      tasks: [invalidLlmEstimate],
      candidateProfiles: [
        candidate(
          'candidate_available',
          [{ startAt: '2026-08-01T17:50:00+09:00', endAt: '2026-08-01T18:40:00+09:00' }],
          []
        )
      ]
    })

    expect(result.assignments).toEqual([])
    expect(result.unassignedTaskIds).toEqual(['task_llm_too_long'])
    expect(result.splitReasonCodes).toContain('llm_estimated_duration_exceeds_twenty_minutes')
  })

  it('ignores map coordinates when matching an eligible candidate', () => {
    const distantCandidate: CandidateProfile = {
      ...candidate(
        'candidate_without_route_check',
        [{ startAt: '2026-08-01T17:50:00+09:00', endAt: '2026-08-01T18:30:00+09:00' }],
        []
      ),
      activityRegion: {
        label: 'Synthetic Remote District',
        approximateLocation: 'Coordinates are intentionally irrelevant',
        center: { latitude: -37.5, longitude: -127 }
      }
    }
    const result = planBundleAssignments({
      tasks: [task('task_no_map', '2026-08-01T18:00:00+09:00', '2026-08-01T18:10:00+09:00', 10)],
      candidateProfiles: [distantCandidate]
    })

    expect(result.assignments[0]?.candidateId).toBe('candidate_without_route_check')
  })

  it('selects the same earliest schedule regardless of availability input order', () => {
    const flexibleTask: Task = {
      ...task('task_deterministic', '2026-08-01T17:00:00+09:00', '2026-08-01T20:00:00+09:00', 10),
      timeCertainty: 'flexible'
    }
    const windows = [
      { startAt: '2026-08-01T18:00:00+09:00', endAt: '2026-08-01T18:30:00+09:00' },
      { startAt: '2026-08-01T17:30:00+09:00', endAt: '2026-08-01T18:00:00+09:00' }
    ]
    const forward = planBundleAssignments({
      tasks: [flexibleTask],
      candidateProfiles: [candidate('candidate_stable', windows, [])]
    })
    const reversed = planBundleAssignments({
      tasks: [flexibleTask],
      candidateProfiles: [candidate('candidate_stable', [...windows].reverse(), [])]
    })

    expect(forward).toEqual(reversed)
    expect(forward.assignments[0]?.scheduledWindow.startAt).toBe('2026-08-01T08:30:00.000Z')
  })

  it('ignores tasks until safety and sufficiency mark them ready', () => {
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
    expect(result.unassignedTaskIds).toEqual([])
    expect(result.splitReasonCodes).toEqual([])
  })
})
