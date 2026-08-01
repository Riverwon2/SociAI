import { describe, expect, it } from 'vitest'

import { sendClarificationInvite } from '../src/send-clarification-invite.js'
import { clarificationInviteCall } from './fixtures.js'

describe('deterministic clarification invite simulator', () => {
  it.each([
    ['clarification-agreed-v1', 'conversation_agreed'],
    ['clarification-rejected-v1', 'rejected']
  ])('%s 시나리오는 %s 결과를 요청자에게 반환한다', (seed, expected) => {
    const result = sendClarificationInvite(clarificationInviteCall(seed))

    expect(result.ok).toBe(true)
    expect(result.data.outcome).toBe(expected)
    expect(result.data.isSimulation).toBe(true)
  })

  it('대화 동의 결과는 매칭이나 Assignment를 생성하지 않는다', () => {
    const result = sendClarificationInvite(clarificationInviteCall('clarification-agreed-v1'))

    expect(result.data.outcome).toBe('conversation_agreed')
    expect(result.data.taskStatus).toBe('held')
    expect(result.data.requesterMessage).toContain('정보 확인 대화에 동의했습니다')
    expect(result.data).not.toHaveProperty('assignment')
    expect(result.data).not.toHaveProperty('matchId')
  })

  it('같은 seed와 입력은 같은 결과를 만든다', () => {
    const call = clarificationInviteCall('custom-clarification-v1')

    expect(sendClarificationInvite(call)).toEqual(sendClarificationInvite(call))
  })

  it('결과는 대화 동의 또는 거절 두 가지뿐이다', () => {
    const outcomes = Array.from(
      { length: 20 },
      (_, index) =>
        sendClarificationInvite(clarificationInviteCall(`clarification-${index}`)).data.outcome
    )

    expect(outcomes.every((outcome) => ['conversation_agreed', 'rejected'].includes(outcome))).toBe(
      true
    )
  })

  it('입력 객체를 변경하지 않는다', () => {
    const input = clarificationInviteCall('clarification-agreed-v1')
    const snapshot = structuredClone(input)

    sendClarificationInvite(input)

    expect(input).toEqual(snapshot)
  })

  it('다른 task의 후보를 섞지 않는다', () => {
    const input = clarificationInviteCall('clarification-agreed-v1')

    expect(() =>
      sendClarificationInvite({
        ...input,
        candidate: { ...input.candidate, taskId: 'task_other' }
      })
    ).toThrow('candidate context must match')
  })

  it('sufficient decision에는 대화 의향 요청을 보내지 않는다', () => {
    const input = clarificationInviteCall('clarification-agreed-v1')

    expect(() =>
      sendClarificationInvite({
        ...input,
        sufficiencyDecision: {
          ...input.sufficiencyDecision,
          status: 'sufficient',
          action: 'proceed',
          reasonCodes: ['required_information_available'],
          missingInformation: []
        }
      })
    ).toThrow('requires an insufficient decision')
  })
})
