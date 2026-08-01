import { describe, expect, it } from 'vitest'

import happyPath from '../examples/first-candidate-accepts.json' with { type: 'json' }
import mixedRisk from '../examples/mixed-risk-partial-match.json' with { type: 'json' }
import multiHelperSplit from '../examples/multi-helper-split.json' with { type: 'json' }
import retryPath from '../examples/reject-timeout-accept.json' with { type: 'json' }
import { DemoScenarioFixtureSchema } from '../src/index.js'

describe('shared scenario JSON fixtures', () => {
  it.each([
    ['first candidate accepts', happyPath, 'first_candidate_accepts'],
    ['reject, timeout, then accept', retryPath, 'reject_timeout_accept'],
    ['mixed-risk partial match', mixedRisk, 'mixed_risk_partial_match'],
    ['multiple helpers are split by time', multiHelperSplit, 'multi_helper_split']
  ])('keeps %s contract-valid', (_name, fixture, scenarioId) => {
    const parsed = DemoScenarioFixtureSchema.parse(fixture)

    expect(parsed.scenarioId).toBe(scenarioId)
    expect(parsed.expectedEventTypes).toContain('sufficiency.checked')
    expect(parsed.expectedEventTypes.at(-1)).toBe('request.completed')
    expect(parsed.expectedRawToolCorrelations.length).toBeGreaterThan(0)
  })

  it('keeps bundle and assignment records linked in the multiple-helper scenario', () => {
    const parsed = DemoScenarioFixtureSchema.parse(multiHelperSplit)

    expect(parsed.expectedBundles).toHaveLength(2)
    expect(parsed.expectedAssignments).toHaveLength(2)
  })

  it('rejects fixture references that do not exist', () => {
    const invalid = {
      ...happyPath,
      responseSequence: [
        {
          ...happyPath.responseSequence[0],
          taskId: 'unknown_task',
          candidateId: 'unknown_candidate'
        }
      ]
    }

    expect(() => DemoScenarioFixtureSchema.parse(invalid)).toThrow()
  })

  it('rejects a final result tied to another request', () => {
    const invalid = {
      ...happyPath,
      expectedFinalResult: {
        ...happyPath.expectedFinalResult,
        requestId: 'another_request'
      }
    }

    expect(() => DemoScenarioFixtureSchema.parse(invalid)).toThrow()
  })

  it('requires request.completed as the final expected event', () => {
    const invalid = {
      ...happyPath,
      expectedEventTypes: happyPath.expectedEventTypes.slice(0, -1)
    }

    expect(() => DemoScenarioFixtureSchema.parse(invalid)).toThrow()
  })

  it('rejects final results that reference unknown fixture records', () => {
    const invalid = {
      ...happyPath,
      expectedFinalResult: {
        ...happyPath.expectedFinalResult,
        runId: 'unknown_run',
        taskResults: [
          {
            ...happyPath.expectedFinalResult.taskResults[0],
            taskId: 'unknown_task',
            matchedCandidateId: 'unknown_candidate'
          }
        ]
      }
    }

    expect(() => DemoScenarioFixtureSchema.parse(invalid)).toThrow()
  })

  it('rejects duplicate or reversed raw tool correlations', () => {
    const invalid = {
      ...happyPath,
      expectedRawToolCorrelations: [
        {
          toolCallId: 'duplicate_call',
          callSequence: 2,
          resultSequence: 1
        },
        {
          toolCallId: 'duplicate_call',
          callSequence: 3,
          resultSequence: 4
        }
      ]
    }

    expect(() => DemoScenarioFixtureSchema.parse(invalid)).toThrow()
  })

  it('rejects a match that uses a candidate from another task', () => {
    const [candidate] = mixedRisk.candidates
    if (candidate === undefined) throw new Error('Fixture requires a candidate')

    const invalid = {
      ...mixedRisk,
      expectedFinalResult: {
        ...mixedRisk.expectedFinalResult,
        status: 'fully_matched',
        taskResults: mixedRisk.tasks.map((task) => ({
          taskId: task.taskId,
          status: 'matched',
          matchedCandidateId: candidate.candidateId,
          reasonCodes: [],
          userMessage: '매칭되었습니다.'
        }))
      }
    }

    expect(() => DemoScenarioFixtureSchema.parse(invalid)).toThrow()
  })

  it('rejects a fixture that mixes multiple runs', () => {
    const invalid = {
      ...mixedRisk,
      tasks: [mixedRisk.tasks[0], { ...mixedRisk.tasks[1], runId: 'another_run' }]
    }

    expect(() => DemoScenarioFixtureSchema.parse(invalid)).toThrow()
  })

  it('rejects a task longer than the initial request maximum duration', () => {
    const invalid = {
      ...happyPath,
      initialRequest: { ...happyPath.initialRequest, maxActivityDurationMinutes: 10 }
    }

    expect(() => DemoScenarioFixtureSchema.parse(invalid)).toThrow()
  })
})
