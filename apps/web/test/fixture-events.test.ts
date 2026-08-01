import { describe, expect, it } from 'vitest'
import { AgentEventSchema, type DemoScenarioFixture } from '@30-minute-exchange/contracts'

import { buildFixtureEvents } from '../src/demo/fixture-events.js'
import { demoScenarios, getDemoScenario } from '../src/demo/scenarios.js'

describe('contract-valid fixture event streams', () => {
  it.each(demoScenarios.map((scenario) => [scenario.fixture.scenarioId, scenario] as const))(
    'builds the complete %s event stream from the shared fixture',
    (_scenarioId, scenario) => {
      const events = buildFixtureEvents(scenario.fixture)

      expect(events.map(({ type }) => type)).toEqual(scenario.fixture.expectedEventTypes)
      expect(events.map(({ sequence }) => sequence)).toEqual(
        events.map((_event, index) => index + 1)
      )
      expect(events.every((event) => AgentEventSchema.safeParse(event).success)).toBe(true)
      expect(events.every(({ isSimulation }) => isSimulation)).toBe(true)

      const completed = events.at(-1)
      expect(completed?.type).toBe('request.completed')
      if (completed?.type !== 'request.completed') throw new Error('Fixture must complete')
      expect(completed.data.result.status).toBe(scenario.fixture.expectedFinalResult.status)
      expect(completed.data.result.executionBoundary.openaiInterpretation).toBe('replay')
    }
  )

  it('puts each retry plan update before the next outreach', () => {
    const events = buildFixtureEvents(getDemoScenario('reject_timeout_accept').fixture)
    const types = events.map(({ type }) => type)
    const planIndexes = types
      .map((type, index) => (type === 'plan.updated' ? index : -1))
      .filter((index) => index >= 0)

    expect(planIndexes).toHaveLength(2)
    for (const index of planIndexes) expect(types[index + 1]).toBe('outreach.sent')
  })

  it('preserves the safe task result in the mixed-risk scenario', () => {
    const events = buildFixtureEvents(getDemoScenario('mixed_risk_partial_match').fixture)
    const completed = events.at(-1)
    if (completed?.type !== 'request.completed') throw new Error('Fixture must complete')

    expect(completed.data.result.status).toBe('partially_matched')
    expect(completed.data.result.taskResults.map(({ status }) => status)).toEqual([
      'matched',
      'safety_excluded'
    ])
  })

  it('replays the same contract-valid sequence across ten rehearsals', () => {
    const fixture = getDemoScenario('first_candidate_accepts').fixture
    const baseline = buildFixtureEvents(fixture)

    for (let rehearsal = 0; rehearsal < 10; rehearsal += 1) {
      expect(buildFixtureEvents(fixture)).toEqual(baseline)
    }
  })

  it('can render held and tool failure events without inventing a provider payload', () => {
    const base = getDemoScenario('first_candidate_accepts').fixture
    const fixture: DemoScenarioFixture = {
      ...base,
      expectedEventTypes: [
        ...base.expectedEventTypes.slice(0, -1),
        'task.held',
        'tool.failed',
        'request.completed'
      ]
    }
    const events = buildFixtureEvents(fixture)

    expect(events.map(({ type }) => type)).toContain('task.held')
    expect(events.map(({ type }) => type)).toContain('tool.failed')
    expect(events.some((event) => 'raw' in event)).toBe(false)
  })

  it('rejects an unknown demo scenario id', () => {
    expect(() => getDemoScenario('unknown' as DemoScenarioFixture['scenarioId'])).toThrow(
      'Unknown demo scenario'
    )
  })
})
