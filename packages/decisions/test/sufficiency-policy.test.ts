import { describe, expect, it } from 'vitest'

import {
  SCHEMA_VERSION,
  type AvailableFact,
  type CheckSufficiencyCall,
  type Task
} from '@30-minute-exchange/contracts'

import { checkSufficiency } from '../sufficiency/check-sufficiency.js'
import { getRequiredMissingInformation } from '../sufficiency/sufficiency-rules.js'
import { isAvailableFactValid } from '../sufficiency/validate-available-fact.js'
import { identifiers, task } from './fixtures.js'

function taskWith(description: string, title = '정보 충분성 검증'): Task {
  return { ...task, title, description, missingInformation: [] }
}

function call(
  targetTask: Task,
  availableFacts: readonly AvailableFact[] = []
): CheckSufficiencyCall {
  return {
    schemaVersion: SCHEMA_VERSION,
    ...identifiers,
    toolCallId: 'call_sufficiency_policy_001',
    task: targetTask,
    availableFacts: [...availableFacts]
  }
}

function missingCodes(targetTask: Task, availableFacts: readonly AvailableFact[] = []): string[] {
  const result = checkSufficiency(call(targetTask, availableFacts))
  if (!result.ok) throw new Error('sufficiency fixture must succeed')
  return result.data.missingInformation.map(({ code }) => code)
}

describe('deterministic sufficiency policy', () => {
  it('수행 대상과 출발·도착·수량이 명확한 전달 task는 sufficient다', () => {
    const targetTask = taskWith(
      '주민센터 안내 데스크에서 서류봉투 1개를 받아 도서관 안내 데스크에 전달해 주세요.'
    )
    const result = checkSufficiency(call(targetTask))

    expect(result.ok && result.data.status).toBe('sufficient')
    expect(result.ok && result.data.action).toBe('proceed')
  })

  it('지정된 장소에서 물품을 받기만 하는 task에 도착 위치를 요구하지 않는다', () => {
    const targetTask = taskWith('약국에서 처방약 봉투 1개를 받아 주세요.')
    const result = checkSufficiency(call(targetTask))

    expect(result.ok && result.data.status).toBe('sufficient')
  })

  it('대상만 지시한 요청은 task_object가 부족하다', () => {
    expect(missingCodes(taskWith('이거 좀 옮겨 주세요.'))).toContain('task_object')
  })

  it('출발·도착 정보가 없는 가져다주기 요청은 두 위치가 부족하다', () => {
    expect(missingCodes(taskWith('상자를 가져다주세요.'))).toEqual(
      expect.arrayContaining(['pickup_point', 'dropoff_point'])
    )
  })

  it('수량을 모르는 상자 이동 요청은 item_quantity가 부족하다', () => {
    expect(missingCodes(taskWith('상자를 현관에서 창고로 옮겨 주세요.'))).toContain('item_quantity')
  })

  it('무거운 물건의 무게를 모르면 item_weight가 부족하다', () => {
    expect(missingCodes(taskWith('무거운 상자 1개를 현관에서 창고로 옮겨 주세요.'))).toContain(
      'item_weight'
    )
  })

  it('가구 정리 범위가 불명확하면 task_scope가 부족하다', () => {
    expect(missingCodes(taskWith('가구를 정리해 주세요.'))).toContain('task_scope')
  })

  it('대형 가구 운반에 장비 정보가 없으면 required_equipment가 부족하다', () => {
    expect(
      missingCodes(taskWith('대형 가구 1개를 현관에서 창고로 옮겨 주세요. 무게는 10kg입니다.'))
    ).toContain('required_equipment')
  })

  it('유효한 사실만 누락 정보를 해결한다', () => {
    const targetTask = taskWith('무거운 상자를 가져다주세요.')
    const validFacts: AvailableFact[] = [
      { code: 'pickup_point', value: '주민센터 안내 데스크', source: 'initial_request' },
      { code: 'dropoff_point', value: '도서관 안내 데스크', source: 'initial_request' },
      { code: 'item_quantity', value: 1, source: 'initial_request' },
      { code: 'item_weight', value: '5kg', source: 'initial_request' }
    ]

    expect(missingCodes(targetTask, validFacts)).toEqual([])
  })

  it('별도 장비가 필요 없다는 false 값도 유효한 장비 정보다', () => {
    const targetTask = taskWith('대형 가구 1개를 현관에서 창고로 옮겨 주세요. 무게는 10kg입니다.')

    expect(
      missingCodes(targetTask, [
        { code: 'required_equipment', value: false, source: 'initial_request' }
      ])
    ).not.toContain('required_equipment')
  })

  it.each([
    ['빈 위치', 'pickup_point', ''],
    ['0개 수량', 'item_quantity', 0],
    ['단위 없는 무게 문자열', 'item_weight', '무거움'],
    ['null 작업 범위', 'task_scope', null],
    ['현장 인원 false', 'requester_or_guardian_present', false]
  ] as const)('%s 값은 확인된 사실로 인정하지 않는다', (_name, code, value) => {
    const targetTask: Task = {
      ...task,
      missingInformation: [{ code, message: `${code} 정보가 필요합니다.` }]
    }

    expect(
      missingCodes(targetTask, [{ code, value, source: 'initial_request' } as AvailableFact])
    ).toContain(code)
  })

  it('정확한 주소·연락처가 없어도 일반 전달 task를 insufficient로 만들지 않는다', () => {
    const codes = missingCodes(
      taskWith('문서봉투 1개를 주민센터 민원함에 전달해 주세요.', '문서 전달')
    )

    expect(codes).not.toContain('exact_address')
    expect(codes).not.toContain('contact_details')
  })

  it('집·회사 현장 인원은 sufficiency 누락 정보로 자동 생성하지 않는다', () => {
    const codes = missingCodes(taskWith('집 안으로 들어가 상자 1개를 옮겨 주세요.'))

    expect(codes).not.toContain('requester_or_guardian_present')
  })

  it('입력 task와 availableFacts를 변경하지 않는다', () => {
    const targetTask = taskWith('상자를 가져다주세요.')
    const facts: AvailableFact[] = [
      { code: 'pickup_point', value: '주민센터', source: 'initial_request' }
    ]
    const input = call(targetTask, facts)
    const snapshot = structuredClone(input)

    checkSufficiency(input)

    expect(input).toEqual(snapshot)
  })

  it('명시적 missingInformation과 추론된 코드를 중복하지 않는다', () => {
    const targetTask: Task = {
      ...taskWith('가구를 정리해 주세요.'),
      missingInformation: [{ code: 'task_scope', message: '구체적인 정리 범위가 필요합니다.' }]
    }

    expect(
      getRequiredMissingInformation(targetTask).filter(({ code }) => code === 'task_scope')
    ).toHaveLength(1)
  })

  it.each([
    ['문자열 위치', 'pickup_point', '주민센터'],
    ['구조화 위치', 'dropoff_point', { label: '도서관 안내 데스크' }],
    ['숫자 수량', 'item_quantity', 2],
    ['한글 수량', 'item_quantity', '두 개'],
    ['숫자 무게', 'item_weight', 5],
    ['문자열 무게', 'item_weight', '2.5kg'],
    ['구조화 무게', 'item_weight', { amount: 3, unit: 'kg' }],
    ['장비 불필요', 'required_equipment', false],
    ['일반 boolean', 'custom_boolean', false],
    ['일반 배열', 'custom_array', ['확인됨']],
    ['일반 객체', 'custom_object', { value: '확인됨' }]
  ] as const)('%s AvailableFact 값을 유효하게 인정한다', (_name, code, value) => {
    expect(
      isAvailableFactValid({
        code,
        value: value as AvailableFact['value'],
        source: 'initial_request'
      })
    ).toBe(true)
  })

  it.each([
    ['빈 구조화 위치', 'pickup_point', { label: '' }],
    ['소수 수량', 'item_quantity', 1.5],
    ['빈 수량 객체', 'item_quantity', {}],
    ['0 무게', 'item_weight', 0],
    ['잘못된 무게 단위', 'item_weight', { amount: 3, unit: 'meter' }],
    ['빈 장비 문자열', 'required_equipment', ''],
    ['빈 일반 배열', 'custom_array', []],
    ['빈 일반 객체', 'custom_object', {}],
    ['null이 포함된 일반 객체', 'custom_object', { value: null }]
  ] as const)('%s AvailableFact 값을 유효하지 않게 판정한다', (_name, code, value) => {
    expect(
      isAvailableFactValid({
        code,
        value: value as AvailableFact['value'],
        source: 'initial_request'
      })
    ).toBe(false)
  })
})
