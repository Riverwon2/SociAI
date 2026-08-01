import { describe, expect, it } from 'vitest'

import {
  SCHEMA_VERSION,
  type FindCandidatesForBundleCall,
  type Task
} from '@30-minute-exchange/contracts'

import {
  HelperUsersFixtureSchema,
  createHelperUserCandidateProvider
} from '../src/fixtures/helper-user-candidate-provider.js'

const runId = 'run-helper-users-001'
const requestId = 'request-helper-users-001'
const scheduledWindow = {
  startAt: '2026-08-02T15:00:00+09:00',
  endAt: '2026-08-02T15:20:00+09:00'
}

const task: Task = {
  schemaVersion: SCHEMA_VERSION,
  runId,
  requestId,
  taskId: 'task-grocery-carry',
  title: 'Carry groceries',
  description: 'Carry groceries to the home.',
  timeWindow: scheduledWindow,
  region: { label: 'Yeoksam-dong', approximateLocation: 'Synthetic location' },
  requiredExperience: ['grocery_carrying'],
  estimatedDurationMinutes: 20,
  durationSource: 'explicit',
  timeSource: 'explicit',
  timeCertainty: 'fixed',
  status: 'ready',
  missingInformation: []
}

const fixture = {
  candidates: [
    {
      candidateId: 'demo-helper-near-low-experience',
      displayName: 'Synthetic Near Helper',
      availabilityTimeRanges: [{ startTime: '14:00', endTime: '17:00' }],
      distanceMeters: 100,
      experienceTags: ['grocery_carrying'],
      completedHelpCount: 0,
      trustScore: 10
    },
    {
      candidateId: 'demo-helper-balanced',
      displayName: 'Synthetic Balanced Helper',
      availabilityTimeRanges: [{ startTime: '14:00', endTime: '17:00' }],
      distanceMeters: 1_000,
      experienceTags: ['grocery_carrying'],
      completedHelpCount: 20,
      trustScore: 20
    },
    {
      candidateId: 'demo-helper-unavailable',
      displayName: 'Synthetic Unavailable Helper',
      availabilityTimeRanges: [{ startTime: '18:00', endTime: '20:00' }],
      distanceMeters: 10,
      experienceTags: ['grocery_carrying'],
      completedHelpCount: 20,
      trustScore: 20
    }
  ]
}

describe('helper-user candidate provider', () => {
  it('validates the fixture and converts daily clock ranges to task-date candidate profiles', () => {
    const provider = createHelperUserCandidateProvider(HelperUsersFixtureSchema.parse(fixture))

    const profiles = provider.createCandidateProfiles([task])

    expect(profiles[0]).toMatchObject({
      candidateId: 'demo-helper-near-low-experience',
      activityRadiusKm: 5,
      reliabilityRate: 0.5,
      availabilityWindows: [
        { startAt: '2026-08-02T14:00:00+09:00', endAt: '2026-08-02T17:00:00+09:00' }
      ]
    })
  })

  it('ranks eligible helpers using availability 40, distance 25, experience 20, and trust 15', () => {
    const provider = createHelperUserCandidateProvider(fixture)
    const candidateProfiles = provider.createCandidateProfiles([task])
    const call: FindCandidatesForBundleCall = {
      schemaVersion: SCHEMA_VERSION,
      runId,
      requestId,
      toolCallId: 'call-find-helper-users-001',
      bundle: {
        schemaVersion: SCHEMA_VERSION,
        runId,
        requestId,
        bundleId: 'bundle-grocery-carry',
        taskIds: [task.taskId],
        scheduledWindow,
        totalActivityDurationMinutes: 20,
        waitingMinutes: 0,
        requiredExperience: ['grocery_carrying'],
        reasonCodes: ['single_task_bundle']
      },
      candidateProfiles,
      plannedAssignments: []
    }

    const result = provider.findCandidatesForBundle(call)

    expect(result).toMatchObject({
      ok: true,
      data: {
        rankingPolicyVersion: 'helper-user-weighted-v1',
        candidates: [
          { candidateId: 'demo-helper-balanced', rank: 1, reliabilityRate: 1 },
          { candidateId: 'demo-helper-near-low-experience', rank: 2, reliabilityRate: 0.5 }
        ],
        excludedCount: 1
      }
    })
  })

  it('refuses to rank a profile that has no matching fixture entry', () => {
    const provider = createHelperUserCandidateProvider(fixture)
    const [knownProfile] = provider.createCandidateProfiles([task])
    if (knownProfile === undefined) throw new Error('Expected a synthetic profile')
    const call: FindCandidatesForBundleCall = {
      schemaVersion: SCHEMA_VERSION,
      runId,
      requestId,
      toolCallId: 'call-find-helper-users-002',
      bundle: {
        schemaVersion: SCHEMA_VERSION,
        runId,
        requestId,
        bundleId: 'bundle-grocery-carry',
        taskIds: [task.taskId],
        scheduledWindow,
        totalActivityDurationMinutes: 20,
        waitingMinutes: 0,
        requiredExperience: ['grocery_carrying'],
        reasonCodes: ['single_task_bundle']
      },
      candidateProfiles: [{ ...knownProfile, candidateId: 'candidate-outside-the-fixture' }],
      plannedAssignments: []
    }

    expect(() => provider.findCandidatesForBundle(call)).toThrow(
      /Missing fixture details for candidate-outside-the-fixture/
    )
  })

  it('rejects a fixture that repeats a candidateId', () => {
    expect(() =>
      HelperUsersFixtureSchema.parse({
        candidates: [
          fixture.candidates[0],
          { ...fixture.candidates[1], candidateId: fixture.candidates[0]?.candidateId }
        ]
      })
    ).toThrow(/candidateId values must be unique/)
  })

  it('refuses to build profiles without a task to take the calendar day from', () => {
    const provider = createHelperUserCandidateProvider(fixture)

    expect(() => provider.createCandidateProfiles([])).toThrow(/At least one task is required/)
  })

  it('refuses tasks that span more than one local calendar day', () => {
    const provider = createHelperUserCandidateProvider(fixture)
    const nextDayTask: Task = {
      ...task,
      taskId: 'task-next-day',
      timeWindow: {
        startAt: '2026-08-03T15:00:00+09:00',
        endAt: '2026-08-03T15:20:00+09:00'
      }
    }

    expect(() => provider.createCandidateProfiles([task, nextDayTask])).toThrow(
      /one local calendar day/
    )
  })

  it('rejects malformed time ranges before a candidate can enter the workflow', () => {
    expect(() =>
      HelperUsersFixtureSchema.parse({
        candidates: [
          {
            ...fixture.candidates[0],
            availabilityTimeRanges: [{ startTime: '17:00', endTime: '14:00' }]
          }
        ]
      })
    ).toThrow(/endTime/)
  })
})
