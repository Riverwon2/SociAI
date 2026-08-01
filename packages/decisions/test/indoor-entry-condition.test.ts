import { describe, expect, it } from 'vitest'

import { SCHEMA_VERSION, type InitialRequest, type Task } from '@30-minute-exchange/contracts'

import { verifyIndoorEntryCondition } from '../safety/verify-indoor-entry-condition.js'
import { task } from './fixtures.js'

function requestWith(helpDescription: string, optionalNotes?: string): InitialRequest {
  return {
    schemaVersion: SCHEMA_VERSION,
    requestId: task.requestId,
    helpDescription,
    timeWindow: task.timeWindow,
    maxActivityDurationMinutes: 30,
    timeFlexibility: { kind: 'fixed' },
    activityRegion: task.region,
    costPolicy: { choice: 'none', paymentMethod: 'not_applicable' },
    fallbackPolicy: {
      allowTimeAdjustment: false,
      allowPartialCompletion: true,
      allowScopeReduction: true
    },
    ...(optionalNotes === undefined ? {} : { optionalNotes })
  }
}

function indoorTask(description = '집 안으로 들어가 상자를 옮겨 주세요.'): Task {
  return { ...task, title: '보안 실내 출입', description }
}

describe('verifyIndoorEntryCondition', () => {
  it.each([
    ['요청자', '제가 집에 있습니다. 집 안의 상자를 옮겨 주세요.'],
    ['보호자', '보호자가 현장에 있습니다. 회사 안의 서류를 가져가 주세요.']
  ])('%s의 현장 여부가 최초 입력에 명시되면 조건을 통과한다', (_name, description) => {
    const result = verifyIndoorEntryCondition({
      initialRequest: requestWith(description),
      task: indoorTask()
    })

    expect(result.status).toBe('verified_present')
    expect(result.action).toBe('continue')
    expect(result.reasonCodes).toEqual(['requester_or_guardian_present'])
  })

  it('optionalNotes에 명시된 현장 여부도 최초 입력 사실로 사용한다', () => {
    const result = verifyIndoorEntryCondition({
      initialRequest: requestWith(
        '사무실 안의 서류를 가져가 주세요.',
        '요청자가 회사 현장에 대기합니다.'
      ),
      task: indoorTask('사무실에 들어가 서류를 가져가 주세요.')
    })

    expect(result.status).toBe('verified_present')
    expect(result.action).toBe('continue')
  })

  it.each([
    ['아무도 없음', '집에는 아무도 없습니다. 집 안의 상자를 옮겨 주세요.'],
    ['둘 다 부재', '요청자는 현장에 없고 보호자도 현장에 없습니다. 회사에 들어가 주세요.']
  ])('%s이 명시되면 조건 실패로 차단한다', (_name, description) => {
    const result = verifyIndoorEntryCondition({
      initialRequest: requestWith(description),
      task: indoorTask()
    })

    expect(result.status).toBe('verified_absent')
    expect(result.action).toBe('block')
    expect(result.reasonCodes).toEqual(['requester_and_guardian_absent'])
  })

  it('요청자와 보호자가 모두 없다는 결합 표현도 차단한다', () => {
    const result = verifyIndoorEntryCondition({
      initialRequest: requestWith('집에는 요청자와 보호자가 모두 없습니다.'),
      task: indoorTask()
    })

    expect(result.status).toBe('verified_absent')
    expect(result.action).toBe('block')
    expect(result.reasonCodes).toEqual(['requester_and_guardian_absent'])
  })

  it('요청자가 부재해도 보호자가 현장에 있으면 조건을 통과한다', () => {
    const result = verifyIndoorEntryCondition({
      initialRequest: requestWith(
        '요청자는 집에 없지만 보호자가 집에 있습니다. 집 안의 상자를 옮겨 주세요.'
      ),
      task: indoorTask()
    })

    expect(result.status).toBe('verified_present')
    expect(result.action).toBe('continue')
  })

  it('있지 않다는 표현을 현장 존재로 오인하지 않는다', () => {
    const result = verifyIndoorEntryCondition({
      initialRequest: requestWith(
        '요청자는 현장에 있지 않습니다. 보호자도 현장에 없습니다. 회사에 들어가 주세요.'
      ),
      task: indoorTask('회사에 들어가 주세요.')
    })

    expect(result.status).toBe('verified_absent')
    expect(result.action).toBe('block')
  })

  it('집과 회사의 현장 정보를 각 task 범위에 맞게 구분한다', () => {
    const initialRequest = requestWith(
      '집에는 아무도 없습니다. 회사에는 보호자가 있습니다. 집과 회사에서 물건을 가져가 주세요.'
    )

    const homeResult = verifyIndoorEntryCondition({
      initialRequest,
      task: indoorTask('집 안에 들어가 상자를 가져가 주세요.')
    })
    const workplaceResult = verifyIndoorEntryCondition({
      initialRequest,
      task: indoorTask('회사 안에 들어가 서류를 가져가 주세요.')
    })

    expect(homeResult.status).toBe('verified_absent')
    expect(homeResult.action).toBe('block')
    expect(workplaceResult.status).toBe('verified_present')
    expect(workplaceResult.action).toBe('continue')
  })

  it.each([
    ['현장 정보 없음', '집 안의 상자를 옮겨 주세요.'],
    ['요청자만 부재', '제가 없는 동안 집 안의 상자를 옮겨 주세요.']
  ])('%s이면 추정하지 않고 보류한다', (_name, description) => {
    const result = verifyIndoorEntryCondition({
      initialRequest: requestWith(description),
      task: indoorTask()
    })

    expect(result.status).toBe('unknown')
    expect(result.action).toBe('hold')
    expect(result.reasonCodes).toEqual(['requester_or_guardian_presence_unknown'])
  })

  it('서로 모순되는 현장 정보는 보류한다', () => {
    const result = verifyIndoorEntryCondition({
      initialRequest: requestWith(
        '보호자가 현장에 있습니다. 하지만 보호자는 현장에 없습니다. 집에 들어가 주세요.'
      ),
      task: indoorTask()
    })

    expect(result.status).toBe('conflicting')
    expect(result.action).toBe('hold')
    expect(result.reasonCodes).toEqual(['requester_or_guardian_presence_conflicting'])
  })

  it('파생된 task에만 있는 현장 정보는 최초 입력 사실로 사용하지 않는다', () => {
    const result = verifyIndoorEntryCondition({
      initialRequest: requestWith('집 안의 상자를 옮겨 주세요.'),
      task: indoorTask('집 안으로 들어가 주세요. 보호자가 현장에 있습니다.')
    })

    expect(result.status).toBe('unknown')
    expect(result.action).toBe('hold')
  })

  it('집 또는 회사 출입이 아닌 task에는 적용하지 않는다', () => {
    const result = verifyIndoorEntryCondition({
      initialRequest: requestWith('제가 현장에 있습니다. 주민센터에 서류를 제출해 주세요.'),
      task: { ...task, description: '주민센터에 서류를 제출해 주세요.' }
    })

    expect(result.status).toBe('not_applicable')
    expect(result.action).toBe('not_applicable')
    expect(result.reasonCodes).toEqual([])
  })

  it('requestId가 다른 최초 입력과 task를 섞지 않는다', () => {
    expect(() =>
      verifyIndoorEntryCondition({
        initialRequest: { ...requestWith('제가 집에 있습니다.'), requestId: 'request_other' },
        task: indoorTask()
      })
    ).toThrow('requestId must match')
  })
})
