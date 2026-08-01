import { describe, expect, it } from 'vitest'

import { buildFixtureEvents } from '../src/demo/fixture-events.js'
import { deriveParticipantDemoView } from '../src/demo/participant-demo-model.js'
import { getDemoScenario } from '../src/demo/scenarios.js'
import { createInitialRunState, runReducer } from '../src/state/run-state.js'

describe('participant demo view model', () => {
  it('moves both participants from preparation to request and mission states', () => {
    const fixture = getDemoScenario('first_candidate_accepts').fixture
    const events = buildFixtureEvents(fixture)
    let state = startedState(fixture)

    state = receiveThrough(state, events, 'request.created')
    expect(deriveParticipantDemoView(state)).toMatchObject({
      requesterStage: 'preparing',
      helperStage: 'waiting'
    })

    state = receiveThrough(state, events, 'outreach.sent')
    expect(deriveParticipantDemoView(state)).toMatchObject({
      requesterStage: 'searching',
      helperStage: 'request_received',
      attempt: 1,
      candidate: { displayName: '가상 이웃 하나' },
      requestCard: {
        title: '생필품 상자 수령',
        regionLabel: '해오름동',
        durationMinutes: 20,
        distanceKm: 0.4
      }
    })

    state = receiveThrough(state, events, 'match.confirmed')
    expect(deriveParticipantDemoView(state)).toMatchObject({
      requesterStage: 'matched',
      helperStage: 'mission',
      matchedCandidateName: '가상 이웃 하나'
    })
  })

  it('shows rerouting after rejection and moves to the next independent attempt', () => {
    const fixture = getDemoScenario('reject_timeout_accept').fixture
    const events = buildFixtureEvents(fixture)
    let state = startedState(fixture)

    state = receiveThrough(state, events, 'neighbor.replied')
    expect(deriveParticipantDemoView(state)).toMatchObject({
      requesterStage: 'searching',
      helperStage: 'rerouting',
      previousOutcome: 'rejected',
      attempt: 1
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
      helperStage: 'request_received',
      attempt: 2,
      candidate: { displayName: '가상 이웃 둘' }
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
      helperStage: 'mission',
      requestCard: { title: '문서봉투 전달' },
      result: { status: 'partially_matched' }
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

