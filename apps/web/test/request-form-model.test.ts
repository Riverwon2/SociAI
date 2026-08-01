import { describe, expect, it } from 'vitest'

import { getDemoScenario } from '../src/demo/scenarios.js'
import {
  fieldsFromFixture,
  getSeoulDate,
  parseRequestForm
} from '../src/request/request-form-model.js'

describe('one-shot request form boundary', () => {
  const fixture = getDemoScenario('first_candidate_accepts').fixture

  it('creates a contract-valid free same-day request', () => {
    const result = parseRequestForm(
      fieldsFromFixture(fixture, '2026-08-01'),
      fixture.initialRequest.requestId,
      '2026-08-01'
    )

    expect(result.success).toBe(true)
    if (!result.success) throw new Error('Expected a valid request')
    expect(result.request.costPolicy).toEqual({ choice: 'none', paymentMethod: 'not_applicable' })
    expect(result.request.maxActivityDurationMinutes).toBe(30)
  })

  it('rejects a duration longer than 30 minutes before submission', () => {
    const fields = { ...fieldsFromFixture(fixture, '2026-08-01'), maxDuration: '31' }
    const result = parseRequestForm(fields, fixture.initialRequest.requestId, '2026-08-01')

    expect(result).toEqual({
      success: false,
      errors: ['활동 시간은 1분 이상 30분 이하로 입력해 주세요.']
    })
  })

  it('rejects a request outside today and accepts optional notes and flexibility', () => {
    const fields = {
      ...fieldsFromFixture(fixture, '2026-08-01'),
      allowTimeAdjustment: true,
      optionalNotes: '실내 출입은 필요하지 않습니다.'
    }
    const wrongDay = parseRequestForm(fields, fixture.initialRequest.requestId, '2026-08-02')
    const valid = parseRequestForm(fields, fixture.initialRequest.requestId, '2026-08-01')

    expect(wrongDay.success).toBe(false)
    expect(valid.success).toBe(true)
    if (!valid.success) throw new Error('Expected a valid flexible request')
    expect(valid.request.timeFlexibility).toEqual({ kind: 'flexible', maxShiftMinutes: 30 })
    expect(valid.request.optionalNotes).toBe('실내 출입은 필요하지 않습니다.')
  })

  it('moves a fixture onto the current day so the demo works on any date', () => {
    const fields = fieldsFromFixture(fixture, '2027-03-09')

    expect(fields.startAt.slice(0, 10)).toBe('2027-03-09')
    expect(fields.endAt.slice(0, 10)).toBe('2027-03-09')
    expect(fields.startAt.slice(11)).toBe('17:00')
    expect(parseRequestForm(fields, fixture.initialRequest.requestId, '2027-03-09').success).toBe(
      true
    )
  })

  it('formats the current date explicitly in the Seoul timezone', () => {
    expect(getSeoulDate(new Date('2026-07-31T15:30:00.000Z'))).toBe('2026-08-01')
  })

  it.each([
    [{ helpDescription: '' }, '도움받을 내용을 입력해 주세요.'],
    [{ regionLabel: '' }, '활동 지역과 대략적인 위치를 입력해 주세요.'],
    [{ endAt: '2026-08-01T16:00' }, '희망 시간은 오늘 안에서 시작보다 종료가 늦어야 합니다.']
  ] as const)('maps invalid boundary fields to clear guidance', (change, message) => {
    const result = parseRequestForm(
      { ...fieldsFromFixture(fixture, '2026-08-01'), ...change },
      fixture.initialRequest.requestId,
      '2026-08-01'
    )

    expect(result.success).toBe(false)
    if (result.success) throw new Error('Expected invalid form')
    expect(result.errors).toContain(message)
  })
})
