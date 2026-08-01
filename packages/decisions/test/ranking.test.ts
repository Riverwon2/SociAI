import { describe, expect, it } from 'vitest'

import { FindCandidatesResultSchema, type CandidateProfile } from '@30-minute-exchange/contracts'

import { calculateAvailabilityScore } from '../ranking/availability-score.js'
import { calculateDistanceScore } from '../ranking/distance-score.js'
import { calculateExperienceScore } from '../ranking/experience-score.js'
import { findCandidates } from '../ranking/find-candidates.js'
import { candidatesCall, candidateProfiles, task } from './fixtures.js'

describe('candidate scoring', () => {
  it('가용 시간의 겹침을 0부터 1 사이 점수로 계산한다', () => {
    expect(calculateAvailabilityScore(task, [task.timeWindow])).toBe(1)
    expect(
      calculateAvailabilityScore(task, [
        { startAt: '2026-08-01T08:00:00.000Z', endAt: '2026-08-01T08:30:00.000Z' }
      ])
    ).toBe(0.5)
    expect(
      calculateAvailabilityScore(task, [
        { startAt: '2026-08-01T10:00:00.000Z', endAt: '2026-08-01T11:00:00.000Z' }
      ])
    ).toBe(0)
  })

  it('거리와 경험 점수를 경계 안에서 계산한다', () => {
    expect(calculateDistanceScore(0)).toBe(1)
    expect(calculateDistanceScore(5)).toBe(0)
    expect(calculateExperienceScore([], [])).toBe(1)
    expect(calculateExperienceScore(['문서 전달', '생활 지원'], ['문서 전달'])).toBe(0.5)
  })
})

describe('findCandidates', () => {
  it('부적격 후보를 제외하고 점수순으로 반환한다', () => {
    const result = findCandidates(candidatesCall())

    expect(FindCandidatesResultSchema.parse(result)).toEqual(result)
    expect(result.ok && result.data.excludedCount).toBe(1)
    expect(result.ok && result.data.candidates.map(({ candidateId }) => candidateId)).toEqual([
      'candidate_alpha',
      'candidate_beta'
    ])
    expect(result.ok && result.data.candidates.map(({ rank }) => rank)).toEqual([1, 2])
  })

  it('빈 후보군을 정상 결과로 반환한다', () => {
    const result = findCandidates(candidatesCall([]))
    expect(result.ok && result.data.candidates).toEqual([])
  })

  it('좌표와 동일 지역 식별자가 없으면 후보를 제외한다', () => {
    const [base] = candidateProfiles
    if (base === undefined) throw new Error('Candidate fixture is required')
    const profile: CandidateProfile = {
      ...base,
      activityRegion: { label: '다른동', approximateLocation: '다른 생활권' }
    }
    const result = findCandidates(candidatesCall([profile]))
    expect(result.ok && result.data.excludedCount).toBe(1)
  })

  it('동점이면 candidateId 오름차순으로 정렬하고 입력을 변경하지 않는다', () => {
    const [base] = candidateProfiles
    if (base === undefined) throw new Error('Candidate fixture is required')
    const profiles: CandidateProfile[] = [
      { ...base, candidateId: 'candidate_zeta' },
      { ...base, candidateId: 'candidate_eta' }
    ]
    const snapshot = structuredClone(profiles)
    const result = findCandidates(candidatesCall(profiles))

    expect(result.ok && result.data.candidates.map(({ candidateId }) => candidateId)).toEqual([
      'candidate_eta',
      'candidate_zeta'
    ])
    expect(profiles).toEqual(snapshot)
  })

  it('기존 일정이 task 시간을 모두 차지하는 후보를 제외한다', () => {
    const [base] = candidateProfiles
    if (base === undefined) throw new Error('Candidate fixture is required')
    const busyProfile: CandidateProfile = {
      ...base,
      candidateId: 'candidate_busy',
      scheduledCommitments: [task.timeWindow]
    }

    const result = findCandidates(candidatesCall([busyProfile]))

    expect(result.ok && result.data.candidates).toEqual([])
    expect(result.ok && result.data.excludedCount).toBe(1)
  })
})
