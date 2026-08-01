import { describe, expect, it } from 'vitest'

import { createSyntheticCandidateProfiles } from '../src/synthetic-candidates.js'
import { task } from './fixtures.js'

const request = {
  schemaVersion: 2 as const,
  requestId: task.requestId,
  helpDescription: task.description,
  timeWindow: task.timeWindow,
  maxActivityDurationMinutes: 30,
  timeFlexibility: { kind: 'fixed' as const },
  activityRegion: task.region,
  costPolicy: { choice: 'none' as const, paymentMethod: 'not_applicable' as const },
  fallbackPolicy: {
    allowTimeAdjustment: false,
    allowPartialCompletion: true,
    allowScopeReduction: false
  }
}

describe('synthetic candidate profiles', () => {
  it('같은 요청과 task에 결정론적인 가상 후보 3명을 만든다', () => {
    const first = createSyntheticCandidateProfiles(request, [task])
    const second = createSyntheticCandidateProfiles(request, [task])

    expect(second).toEqual(first)
    expect(first).toHaveLength(3)
    expect(first.every(({ isSimulation }) => isSimulation)).toBe(true)
    expect(first[0]?.experienceTags).toEqual(task.requiredExperience)
  })
})
