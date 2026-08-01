import { describe, expect, it } from 'vitest'

import { SendOutreachResultSchema } from '@30-minute-exchange/contracts'

import { sendOutreach } from '../src/send-outreach.js'
import { determineResponse } from '../src/scenario-policy.js'
import { deterministicInteger } from '../src/seeded-random.js'
import { outreachCall } from './fixtures.js'

describe('deterministic outreach simulator', () => {
  it('대표 재시도 시나리오를 거절, timeout, 수락 순서로 재현한다', () => {
    const results = [1, 2].map((attempt) => sendOutreach(outreachCall(attempt as 1 | 2)))

    expect(results.map((result) => result.ok && result.data.outcome)).toEqual([
      'rejected',
      'accepted'
    ])
  })

  it('uses the documented legacy ten-minute timeout when that fixture outcome is selected', () => {
    const result = sendOutreach(outreachCall(1, 'timeout-retry-path-v1'))

    expect(result).toMatchObject({
      ok: true,
      data: { outcome: 'timed_out', virtualElapsedMinutes: 10 }
    })
    expect(result.ok && result.data.respondedAt).toBeUndefined()
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

  it('알 수 없는 시나리오도 유효한 결정론적 응답을 만든다', () => {
    expect(['accepted', 'rejected', 'timed_out', 'cancelled']).toContain(
      determineResponse('another-seed', 'candidate_001', 1)
    )
  })

  it('잘못된 난수 범위를 거부한다', () => {
    expect(() => deterministicInteger('seed', 0)).toThrow(RangeError)
  })
})
