import { describe, expect, it } from 'vitest'

import {
  SCHEMA_VERSION,
  type Candidate,
  type MissingInformation,
  type SufficiencyDecision
} from '@30-minute-exchange/contracts'

import { planCandidateContact } from '../policies/candidate-contact-policy.js'
import { candidateProfiles, candidatesCall, identifiers, task } from './fixtures.js'
import { findCandidates } from '../ranking/find-candidates.js'

const missingInformation: MissingInformation[] = [
  { code: 'item_weight', message: '물품 무게가 필요합니다.' }
]

function decision(status: 'sufficient' | 'insufficient'): SufficiencyDecision {
  return {
    schemaVersion: SCHEMA_VERSION,
    ...identifiers,
    status,
    action: status === 'sufficient' ? 'proceed' : 'hold',
    reasonCodes: [
      status === 'sufficient' ? 'required_information_available' : 'missing_required_information'
    ],
    missingInformation: status === 'sufficient' ? [] : missingInformation
  }
}

function rankedCandidates(): Candidate[] {
  const result = findCandidates(candidatesCall(candidateProfiles))
  if (!result.ok) throw new Error('candidate fixture must rank successfully')
  return result.data.candidates
}

describe('planCandidateContact', () => {
  it('sufficient task는 최고 순위 후보에 대한 기존 매칭 계획을 만든다', () => {
    const candidates = rankedCandidates().reverse()
    const result = planCandidateContact({ decision: decision('sufficient'), candidates })

    expect(result).toEqual({
      kind: 'matching',
      taskId: identifiers.taskId,
      candidateId: 'candidate_alpha',
      taskStatus: 'ready'
    })
  })

  it('insufficient task는 최고 순위 후보에 대한 대화 의향 확인 계획만 만든다', () => {
    const candidates = rankedCandidates().reverse()
    const result = planCandidateContact({ decision: decision('insufficient'), candidates })

    expect(result).toEqual({
      kind: 'clarification',
      taskId: identifiers.taskId,
      candidateId: 'candidate_alpha',
      taskStatus: 'held'
    })
    expect(result).not.toHaveProperty('assignment')
  })

  it('held task도 번들 없이 대화 요청용 후보 순위화가 가능하다', () => {
    const call = candidatesCall(candidateProfiles)
    const rankingResult = findCandidates({
      ...call,
      task: { ...task, status: 'held', missingInformation }
    })
    if (!rankingResult.ok) throw new Error('held task fixture must rank successfully')

    const result = planCandidateContact({
      decision: decision('insufficient'),
      candidates: rankingResult.data.candidates
    })

    expect(result?.kind).toBe('clarification')
    expect(result?.candidateId).toBe('candidate_alpha')
    expect(result?.taskStatus).toBe('held')
  })

  it('후보가 없으면 연락 계획을 만들지 않는다', () => {
    expect(planCandidateContact({ decision: decision('insufficient'), candidates: [] })).toBeNull()
  })

  it('다른 task의 후보를 섞지 않는다', () => {
    const candidate = rankedCandidates()[0]
    if (candidate === undefined) throw new Error('candidate fixture must not be empty')

    expect(() =>
      planCandidateContact({
        decision: decision('insufficient'),
        candidates: [{ ...candidate, taskId: 'task_other' }]
      })
    ).toThrow('candidate context must match')
  })

  it('입력 후보 배열과 decision을 변경하지 않는다', () => {
    const input = { decision: decision('insufficient'), candidates: rankedCandidates().reverse() }
    const snapshot = structuredClone(input)

    planCandidateContact(input)

    expect(input).toEqual(snapshot)
  })
})
