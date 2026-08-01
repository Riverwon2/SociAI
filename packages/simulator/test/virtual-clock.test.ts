import { describe, expect, it } from 'vitest'

import { advanceVirtualTime } from '../src/virtual-clock.js'

describe('virtual clock', () => {
  it('실제 대기 없이 가상 시간을 분 단위로 이동한다', () => {
    expect(advanceVirtualTime('2026-08-01T10:00:00.000Z', 10)).toBe('2026-08-01T10:10:00.000Z')
  })

  it('잘못된 시작 시각과 음수 경과 시간을 거부한다', () => {
    expect(() => advanceVirtualTime('invalid', 1)).toThrow(RangeError)
    expect(() => advanceVirtualTime('2026-08-01T10:00:00.000Z', -1)).toThrow(RangeError)
  })
})
