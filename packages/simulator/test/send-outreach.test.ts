import { describe, expect, it } from 'vitest'

import { SendOutreachResultSchema } from '@30-minute-exchange/contracts'

import { sendOutreach, sendOutreachAt } from '../src/send-outreach.js'
import { determineResponse } from '../src/scenario-policy.js'
import { deterministicInteger } from '../src/seeded-random.js'
import { outreachCall } from './fixtures.js'

describe('deterministic outreach simulator', () => {
  it('대표 재시도 시나리오를 거절, timeout, 수락 순서로 재현한다', () => {
    const results = [1, 2, 3].map((attempt) => sendOutreach(outreachCall(attempt as 1 | 2 | 3)))

    expect(results.map((result) => result.ok && result.data.outcome)).toEqual([
      'rejected',
      'timed_out',
      'accepted'
    ])
    expect(results[1]?.ok && results[1].data.virtualElapsedMinutes).toBe(10)
    expect(results[1]?.ok && results[1].data.respondedAt).toBeUndefined()
  })

  it.each([
    ['happy-path-v1', 'accepted'],
    ['mixed-risk-v1', 'accepted']
  ])('%s의 첫 후보가 %s를 반환한다', (seed, expected) => {
    const result = sendOutreach(outreachCall(1, seed))
    expect(SendOutreachResultSchema.parse(result)).toEqual(result)
    expect(result.ok && result.data.outcome).toBe(expected)
  })

  it('같은 seed와 입력은 같은 결과와 시간을 만든다', () => {
    const first = sendOutreach(outreachCall(1, 'custom-seed'))
    const second = sendOutreach(outreachCall(1, 'custom-seed'))
    expect(second).toEqual(first)
  })

  it('재시도는 오케스트레이터의 누적 가상 시각을 기준으로 응답한다', () => {
    const result = sendOutreachAt(outreachCall(3, 'retry-path-v1'), '2026-08-01T10:16:00.000Z')

    expect(result.ok && result.data.outcome).toBe('accepted')
    expect(result.ok && result.data.respondedAt).toBe('2026-08-01T10:25:00.000Z')
  })

  it('알 수 없는 시나리오도 유효한 결정론적 응답을 만든다', () => {
    expect(['accepted', 'rejected', 'timed_out', 'cancelled']).toContain(
      determineResponse('another-seed', 'candidate_001', 1)
    )
  })

  it('잘못된 난수 범위를 거부한다', () => {
    expect(() => deterministicInteger('seed', 0)).toThrow(RangeError)
  })
})
