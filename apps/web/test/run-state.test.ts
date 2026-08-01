import { describe, expect, it } from 'vitest'
import type { DemoScenarioFixture, FinalResult, RawToolEvent } from '@30-minute-exchange/contracts'

import { buildFixtureEvents } from '../src/demo/fixture-events.js'
import { getDemoScenario } from '../src/demo/scenarios.js'
import { createClarificationFixture } from './clarification-fixture.js'
import {
  createInitialRunState,
  deriveTaskViews,
  runReducer,
  type RunState
} from '../src/state/run-state.js'

describe('run state reducer', () => {
  it('derives retry attempts and final candidate from append-only events', () => {
    const fixture = getDemoScenario('reject_timeout_accept').fixture
    const state = reduceFixture(fixture)
    const task = deriveTaskViews(state.normalized)[0]

    expect(state.phase).toBe('complete')
    expect(state.result?.status).toBe('fully_matched')
    expect(task?.safetyReasonCodes).toEqual(['ordinary_life_support'])
    expect(task?.sufficiencyReasonCodes).toEqual(['required_information_present'])
    expect(task?.attempts.map(({ outcome }) => outcome)).toEqual([
      'rejected',
      'timed_out',
      'accepted'
    ])
    expect(task?.matchedCandidateId).toBe('candidate_retry_003')
  })

  it('keeps blocked and matched tasks separate in a partial result', () => {
    const fixture = getDemoScenario('mixed_risk_partial_match').fixture
    const tasks = deriveTaskViews(reduceFixture(fixture).normalized)

    expect(tasks.map(({ status }) => status)).toEqual(['매칭 완료', '안전 제외'])
    expect(tasks[1]?.blockGuidance).toContain('일반 이웃 매칭에서 제외')
    expect(tasks[1]?.safetyReasonCodes).toEqual(['medication_assistance'])
  })

  it('fans bundle and assignment planning out to every task in the bundle', () => {
    const fixture = getDemoScenario('multi_helper_split').fixture
    const tasks = deriveTaskViews(reduceFixture(fixture).normalized)

    expect(tasks.map(({ bundle }) => bundle?.bundleId)).toEqual(['bundle_1', 'bundle_2'])
    expect(tasks.map(({ assignment }) => assignment?.assignmentId)).toEqual([
      'assignment_1',
      'assignment_2'
    ])
    expect(tasks.map(({ assignment }) => assignment?.candidateId)).toEqual([
      'candidate_multi_meal',
      'candidate_multi_dog'
    ])
    expect(tasks[1]?.bundle?.totalActivityDurationMinutes).toBe(25)
    expect(tasks.every(({ bundle }) => bundle?.companionTaskIds.length === 0)).toBe(true)
  })

  it('keeps a clarification agreement held without creating an assignment or match', () => {
    const fixture = createClarificationFixture()
    const state = reduceFixture(fixture)
    const task = deriveTaskViews(state.normalized)[0]
    const eventTypes = state.normalized.items.map(({ type }) => type)

    expect(task).toMatchObject({
      status: '정보 보류',
      clarificationCandidateId: 'candidate_happy_001',
      clarificationOutcome: 'conversation_agreed',
      clarificationRequesterMessage: '가상 이웃 하나: 정보 확인 대화에 동의했습니다.',
      assignment: null,
      matchedCandidateId: null
    })
    expect(eventTypes).toContain('clarification.invited')
    expect(eventTypes).toContain('clarification.responded')
    expect(eventTypes).not.toContain('assignments.planned')
    expect(eventTypes).not.toContain('match.confirmed')
    expect(state.result?.taskResults[0]).toMatchObject({ status: 'held' })
  })

  it('names an assigned neighbour only when a ranking event introduced them', () => {
    const fixture = getDemoScenario('multi_helper_split').fixture
    const tasks = deriveTaskViews(reduceFixture(fixture).normalized)

    expect(tasks[0]?.assignment?.candidateName).toBe(
      fixture.candidates.find(({ candidateId }) => candidateId === 'candidate_multi_meal')
        ?.displayName
    )
    expect(tasks[1]?.assignment?.candidateName).toBeNull()
  })

  it('does not lose a raw provider payload or completed events on a failure', () => {
    const fixture = getDemoScenario('first_candidate_accepts').fixture
    const complete = reduceFixture(fixture)
    const raw: RawToolEvent = {
      schemaVersion: 2,
      eventId: 'raw_1',
      runId: fixture.expectedFinalResult.runId,
      requestId: fixture.initialRequest.requestId,
      toolCallId: 'call_1',
      sequence: 1,
      occurredAt: '2026-08-01T08:00:00.000Z',
      direction: 'tool_call',
      provider: 'openai',
      raw: { exact: ['provider', 1, false] }
    }
    const withRaw = runReducer(complete, { type: 'raw.received', value: raw })
    const failed = runReducer(withRaw, { type: 'run.failed', message: '연결 오류' })

    expect(failed.raw.items[0]?.raw).toEqual(raw.raw)
    expect(failed.normalized.items).toEqual(complete.normalized.items)
    expect(failed.phase).toBe('failed')
  })

  it('resets all run-specific state', () => {
    const fixture = getDemoScenario('first_candidate_accepts').fixture
    const reset = runReducer(reduceFixture(fixture), { type: 'run.reset' })

    expect(reset).toEqual(createInitialRunState())
  })

  it('waits for missing sequences before treating request.completed as complete', () => {
    const fixture = getDemoScenario('first_candidate_accepts').fixture
    const events = buildFixtureEvents(fixture)
    let state = runReducer(createInitialRunState(), {
      type: 'run.started',
      mode: 'live',
      runId: fixture.expectedFinalResult.runId,
      scenario: fixture
    })
    const completion = events.at(-1)
    if (completion === undefined) throw new Error('Fixture requires completion')

    state = runReducer(state, { type: 'agent.received', value: completion })
    expect(state.phase).toBe('running')
    expect(state.connectionStatus).toBe('connecting')

    state = runReducer(state, { type: 'connection.changed', status: 'open' })
    for (const event of events.slice(0, -1)) {
      state = runReducer(state, { type: 'agent.received', value: event })
    }
    expect(state.phase).toBe('complete')
    expect(state.result?.status).toBe('fully_matched')
  })

  it('isolates a malformed event and keeps the last valid task state', () => {
    const fixture = getDemoScenario('first_candidate_accepts').fixture
    const events = buildFixtureEvents(fixture)
    let state = runReducer(createInitialRunState(), {
      type: 'run.started',
      mode: 'live',
      runId: fixture.expectedFinalResult.runId,
      scenario: null
    })
    const firstTaskIndex = events.findIndex(({ type }) => type === 'task.created')
    for (const event of events.slice(0, firstTaskIndex + 1)) {
      state = runReducer(state, { type: 'agent.received', value: event })
    }

    const beforeMalformed = deriveTaskViews(state.normalized)
    state = runReducer(state, {
      type: 'agent.received',
      value: { type: 'safety.checked', script: '<script>alert(1)</script>' }
    })

    expect(state.normalized.issues.at(-1)?.code).toBe('invalid_event')
    expect(deriveTaskViews(state.normalized)).toEqual(beforeMalformed)
    expect(state.phase).toBe('running')
  })

  it.each([
    ['held', '정보 보류', 'task.held'],
    ['failed', '실행 실패', 'tool.failed']
  ] as const)(
    'preserves a server-provided %s task result as a safe unmatched completion',
    (taskStatus, expectedLabel, extraEventType) => {
      const base = getDemoScenario('first_candidate_accepts').fixture
      const taskId = base.expectedFinalResult.taskResults[0]?.taskId
      if (taskId === undefined) throw new Error('Fixture requires one task')
      const result: FinalResult = {
        ...base.expectedFinalResult,
        status: 'unmatched',
        taskResults: [
          {
            taskId,
            status: taskStatus,
            reasonCodes: [taskStatus === 'held' ? 'missing_information' : 'tool_failure'],
            userMessage:
              taskStatus === 'held'
                ? '정보가 부족해 안전하게 보류했습니다.'
                : '도구 오류로 안전하게 종료했습니다.'
          }
        ],
        userMessage: '안전한 종료 결과입니다.'
      }
      const fixture: DemoScenarioFixture = {
        ...base,
        expectedFinalResult: result,
        expectedEventTypes: [
          ...base.expectedEventTypes.slice(0, -1),
          extraEventType,
          'request.completed'
        ]
      }
      const state = reduceFixture(fixture)

      expect(state.phase).toBe('complete')
      expect(state.result).toMatchObject({
        status: 'unmatched',
        taskResults: result.taskResults,
        userMessage: result.userMessage,
        executionBoundary: { openaiInterpretation: 'replay' }
      })
      expect(deriveTaskViews(state.normalized)[0]?.status).toBe(expectedLabel)
      expect(state.normalized.items.some(({ type }) => type === extraEventType)).toBe(true)
    }
  )
})

function reduceFixture(fixture: ReturnType<typeof getDemoScenario>['fixture']): RunState {
  let state = runReducer(createInitialRunState(), {
    type: 'run.started',
    mode: 'replay',
    runId: fixture.expectedFinalResult.runId,
    scenario: fixture
  })
  for (const event of buildFixtureEvents(fixture)) {
    state = runReducer(state, { type: 'agent.received', value: event })
  }
  return state
}
