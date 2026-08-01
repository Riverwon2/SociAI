import { describe, expect, it } from 'vitest'

import { buildFixtureEvents } from '../src/demo/fixture-events.js'
import { deriveParticipantDemoView } from '../src/demo/participant-demo-model.js'
import { getDemoScenario } from '../src/demo/scenarios.js'
import { createInitialRunState, runReducer } from '../src/state/run-state.js'
import { createClarificationFixture } from './clarification-fixture.js'

describe('participant demo view model', () => {
  it('moves both participants from preparation to request and mission states', () => {
    const fixture = getDemoScenario('first_candidate_accepts').fixture
    const events = buildFixtureEvents(fixture)
    let state = startedState(fixture)

    state = receiveThrough(state, events, 'request.created')
    expect(deriveParticipantDemoView(state)).toMatchObject({
      requesterStage: 'preparing',
      helpers: []
    })

    state = receiveThrough(state, events, 'outreach.sent')
    expect(deriveParticipantDemoView(state)).toMatchObject({
      requesterStage: 'searching',
      helpers: [
        {
          stage: 'request_received',
          attempt: 1,
          candidate: { displayName: '가상 이웃 하나' },
          requestCard: {
            title: '생필품 상자 수령',
            regionLabel: '해오름동',
            durationMinutes: 20,
            distanceKm: 0.4
          }
        }
      ]
    })

    state = receiveThrough(state, events, 'match.confirmed')
    expect(deriveParticipantDemoView(state)).toMatchObject({
      requesterStage: 'matched',
      helpers: [{ stage: 'mission', matchedCandidateName: '가상 이웃 하나' }]
    })
  })

  it('keeps one connection per task when a request is split across neighbours', () => {
    const fixture = getDemoScenario('three_way_conflict').fixture
    const events = buildFixtureEvents(fixture)
    const lastOutreach = events.reduce(
      (last, event, index) => (event.type === 'outreach.sent' ? index : last),
      -1
    )
    const afterOutreach = events
      .slice(0, lastOutreach + 1)
      .reduce(
        (next, event) => runReducer(next, { type: 'agent.received', value: event }),
        startedState(fixture)
      )

    const view = deriveParticipantDemoView(afterOutreach)
    expect(view.helpers.map(({ taskTitle }) => taskTitle)).toEqual([
      '아이 마중',
      '택배 수령',
      '배송 수령'
    ])
    expect(view.helpers.map(({ candidateName }) => candidateName)).toEqual([
      '가상 이웃 하나',
      '가상 이웃 두리',
      '가상 이웃 세아'
    ])
    expect(view.helpers.every(({ stage }) => stage === 'request_received')).toBe(true)

    const completed = events.reduce(
      (next, event) => runReducer(next, { type: 'agent.received', value: event }),
      startedState(fixture)
    )
    const done = deriveParticipantDemoView(completed)
    expect(done.requesterStage).toBe('matched')
    expect(done.helpers.map(({ stage }) => stage)).toEqual(['mission', 'mission', 'mission'])
    expect(done.helpers.map(({ matchedCandidateName }) => matchedCandidateName)).toEqual([
      '가상 이웃 하나',
      '가상 이웃 두리',
      '가상 이웃 세아'
    ])
  })

  it('shows rerouting after rejection and moves to the next independent attempt', () => {
    const fixture = getDemoScenario('reject_timeout_accept').fixture
    const events = buildFixtureEvents(fixture)
    let state = startedState(fixture)

    state = receiveThrough(state, events, 'neighbor.replied')
    expect(deriveParticipantDemoView(state)).toMatchObject({
      requesterStage: 'searching',
      helpers: [{ stage: 'rerouting', previousOutcome: 'rejected', attempt: 1 }]
    })

    const secondOutreachIndex = events.findIndex(
      (event) => event.type === 'outreach.sent' && event.data.attempt === 2
    )
    state = events
      .slice(0, secondOutreachIndex + 1)
      .reduce(
        (next, event) => runReducer(next, { type: 'agent.received', value: event }),
        startedState(fixture)
      )
    expect(deriveParticipantDemoView(state)).toMatchObject({
      helpers: [
        { stage: 'request_received', attempt: 2, candidate: { displayName: '가상 이웃 둘' } }
      ]
    })
  })

  it('presents a mixed-risk completion as a safe partial match', () => {
    const fixture = getDemoScenario('mixed_risk_partial_match').fixture
    const state = buildFixtureEvents(fixture).reduce(
      (next, event) => runReducer(next, { type: 'agent.received', value: event }),
      startedState(fixture)
    )

    expect(deriveParticipantDemoView(state)).toMatchObject({
      requesterStage: 'partially_matched',
      helpers: [{ stage: 'mission', requestCard: { title: '문서봉투 전달' } }],
      result: { status: 'partially_matched' }
    })
  })

  it('derives a requester-only clarification result without a helper connection', () => {
    const fixture = createClarificationFixture()
    const events = buildFixtureEvents(fixture)
    const responseIndex = events.findIndex(({ type }) => type === 'clarification.responded')
    if (responseIndex < 0) throw new Error('Clarification fixture requires a response')
    const state = events
      .slice(0, responseIndex + 1)
      .reduce(
        (next, event) => runReducer(next, { type: 'agent.received', value: event }),
        startedState(fixture)
      )

    expect(deriveParticipantDemoView(state)).toMatchObject({
      requesterStage: 'clarification',
      helpers: [],
      clarificationResults: [
        {
          taskId: 'task_happy_001',
          candidateId: 'candidate_happy_001',
          outcome: 'conversation_agreed',
          requesterMessage: '가상 이웃 하나: 정보 확인 대화에 동의했습니다.'
        }
      ]
    })
  })
})

function startedState(fixture: ReturnType<typeof getDemoScenario>['fixture']) {
  return runReducer(createInitialRunState(), {
    type: 'run.started',
    mode: 'replay',
    runId: fixture.expectedFinalResult.runId,
    requestId: fixture.initialRequest.requestId,
    scenario: fixture
  })
}

function receiveThrough(
  state: ReturnType<typeof createInitialRunState>,
  events: ReturnType<typeof buildFixtureEvents>,
  type: ReturnType<typeof buildFixtureEvents>[number]['type']
) {
  const index = events.findIndex((event) => event.type === type)
  if (index < 0) throw new Error(`Fixture event missing: ${type}`)
  return events
    .slice(0, index + 1)
    .reduce((next, event) => runReducer(next, { type: 'agent.received', value: event }), state)
}
