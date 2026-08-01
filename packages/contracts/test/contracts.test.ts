import { describe, expect, it } from 'vitest'

import {
  AgentEventSchema,
  CandidateSchema,
  CheckSafetyCallSchema,
  CheckSafetyResultSchema,
  ConfirmMatchResultSchema,
  DemoScenarioFixtureSchema,
  FinalResultSchema,
  FindCandidatesCallSchema,
  InitialRequestSchema,
  RawToolEventSchema,
  SafetyDecisionSchema,
  SendOutreachCallSchema,
  SendOutreachResultSchema,
  TaskSchema,
  calculateCandidateScore,
  parseAgentEventSafely,
  type JsonValue
} from '../src/index.js'

const identifiers = {
  runId: 'run_demo_001',
  requestId: 'request_demo_001',
  taskId: 'task_demo_001'
} as const

const timeWindow = {
  startAt: '2026-08-01T09:00:00.000Z',
  endAt: '2026-08-01T09:30:00.000Z'
} as const

const region = {
  label: '해오름동',
  approximateLocation: '해오름동 주민센터 인근'
} as const

const initialRequest = {
  schemaVersion: 1,
  requestId: identifiers.requestId,
  helpDescription: '현관 앞 생필품 상자를 대신 수령해 주세요.',
  timeWindow,
  timeFlexibility: { kind: 'fixed' },
  activityRegion: region,
  costPolicy: { choice: 'none' },
  fallbackPolicy: {
    allowTimeAdjustment: false,
    allowPartialCompletion: true,
    allowScopeReduction: true
  }
} as const

const task = {
  schemaVersion: 1,
  ...identifiers,
  title: '생필품 상자 수령',
  description: '관리실에서 생필품 상자를 수령해 현관 앞에 전달한다.',
  timeWindow,
  region,
  requiredExperience: ['가벼운 물품 전달'],
  estimatedDurationMinutes: 20,
  status: 'created',
  missingInformation: []
} as const

const candidate = {
  schemaVersion: 1,
  ...identifiers,
  candidateId: 'candidate_demo_001',
  displayName: '가상 이웃 하나',
  activityRegion: region,
  activityRadiusKm: 1,
  isAvailable: true,
  distanceKm: 0.4,
  experienceTags: ['가벼운 물품 전달'],
  reliabilityRate: 0.96,
  scoreBreakdown: {
    availability: 1,
    distance: 0.92,
    experience: 1,
    reliability: 0.96,
    weightedTotal: 0.974
  },
  rank: 1,
  isSimulation: true
} as const

describe('shared domain contracts', () => {
  it('accepts a complete one-shot initial request', () => {
    expect(InitialRequestSchema.parse(initialRequest)).toEqual(initialRequest)
  })

  it('rejects contradictory fixed-time fallback permission', () => {
    const invalid = {
      ...initialRequest,
      fallbackPolicy: {
        ...initialRequest.fallbackPolicy,
        allowTimeAdjustment: true
      }
    }

    expect(() => InitialRequestSchema.parse(invalid)).toThrow()
  })

  it('rejects payment data when cost is none', () => {
    const invalid = {
      ...initialRequest,
      costPolicy: {
        choice: 'none',
        paymentMethod: 'requester_online'
      }
    }

    expect(() => InitialRequestSchema.parse(invalid)).toThrow()
  })

  it('requires a payment choice when a cost is expected', () => {
    const invalid = {
      ...initialRequest,
      costPolicy: { choice: 'required' }
    }

    expect(() => InitialRequestSchema.parse(invalid)).toThrow()
  })

  it('rejects a time window whose end is not after its start', () => {
    const invalid = {
      ...task,
      timeWindow: {
        startAt: timeWindow.endAt,
        endAt: timeWindow.startAt
      }
    }

    expect(() => TaskSchema.parse(invalid)).toThrow()
  })

  it('keeps safety level separate from deterministic action', () => {
    const decision = {
      schemaVersion: 1,
      ...identifiers,
      level: 'high',
      action: 'block',
      reasonCodes: ['medical_procedure'],
      conditions: [],
      missingInformation: [],
      guidance: '일반 이웃 매칭에서 제외합니다.'
    } as const

    expect(SafetyDecisionSchema.parse(decision)).toEqual(decision)
  })

  it('rejects an action that contradicts the safety level', () => {
    const invalid = {
      schemaVersion: 1,
      ...identifiers,
      level: 'low',
      action: 'block',
      reasonCodes: ['ordinary_life_support'],
      conditions: [],
      missingInformation: []
    }

    expect(() => SafetyDecisionSchema.parse(invalid)).toThrow()
  })

  it('validates the documented weighted candidate score', () => {
    expect(calculateCandidateScore(candidate.scoreBreakdown)).toBeCloseTo(0.974)
    expect(CandidateSchema.parse(candidate)).toEqual(candidate)
  })

  it('rejects a candidate whose total does not match its score components', () => {
    const invalid = {
      ...candidate,
      scoreBreakdown: {
        ...candidate.scoreBreakdown,
        weightedTotal: 0.5
      }
    }

    expect(() => CandidateSchema.parse(invalid)).toThrow()
  })
})

describe('event contracts', () => {
  it('requires the complete plan.updated evidence payload', () => {
    const event = {
      schemaVersion: 1,
      eventId: 'event_demo_001',
      ...identifiers,
      sequence: 8,
      occurredAt: '2026-08-01T09:01:00.000Z',
      type: 'plan.updated',
      message: '첫 후보 거절로 다음 후보에게 섭외합니다.',
      isSimulation: true,
      data: {
        revision: 2,
        trigger: 'candidate_rejected',
        observation: '첫 후보가 거절함',
        previousAction: '첫 후보에게 섭외 발송',
        nextAction: '두 번째 후보에게 섭외 발송',
        policyApplied: 'next_ranked_candidate',
        userInputRequired: false
      }
    } as const

    expect(AgentEventSchema.parse(event)).toEqual(event)
  })

  it('preserves raw provider payload through a parse and serialize round trip', () => {
    const raw: JsonValue = {
      type: 'response.function_call_arguments.done',
      item_id: 'item_001',
      arguments: '{"taskId":"task_demo_001"}'
    }
    const event = {
      schemaVersion: 1,
      eventId: 'raw_event_demo_001',
      ...identifiers,
      toolCallId: 'tool_call_demo_001',
      sequence: 1,
      occurredAt: '2026-08-01T09:00:01.000Z',
      direction: 'tool_call',
      provider: 'openai',
      raw
    } as const

    const parsed = RawToolEventSchema.parse(event)

    expect(JSON.parse(JSON.stringify(parsed.raw))).toEqual(raw)
  })

  it('lets consumers ignore an unknown normalized event without crashing', () => {
    const unknownEvent = {
      schemaVersion: 1,
      eventId: 'event_future_001',
      runId: identifiers.runId,
      requestId: identifiers.requestId,
      sequence: 99,
      occurredAt: '2026-08-01T09:05:00.000Z',
      type: 'future.event',
      message: '미래 이벤트',
      isSimulation: true,
      data: {}
    }

    expect(parseAgentEventSafely(unknownEvent)).toBeNull()
  })

  it('requires taskId on task-scoped events', () => {
    const invalid = {
      schemaVersion: 1,
      eventId: 'event_timeout_001',
      runId: identifiers.runId,
      requestId: identifiers.requestId,
      sequence: 7,
      occurredAt: '2026-08-01T09:10:00.000Z',
      type: 'outreach.timed_out',
      message: '응답 시간이 초과되었습니다.',
      isSimulation: true,
      data: {
        candidateId: candidate.candidateId,
        attempt: 1,
        waitedMinutes: 10
      }
    }

    expect(() => AgentEventSchema.parse(invalid)).toThrow()
  })

  it('rejects a task event whose payload belongs to another task', () => {
    const invalid = {
      schemaVersion: 1,
      eventId: 'event_task_002',
      ...identifiers,
      sequence: 3,
      occurredAt: '2026-08-01T09:00:10.000Z',
      type: 'task.created',
      message: '태스크가 생성되었습니다.',
      isSimulation: false,
      data: {
        task: { ...task, taskId: 'another_task' }
      }
    }

    expect(() => AgentEventSchema.parse(invalid)).toThrow()
  })
})

describe('tool boundaries', () => {
  it('validates common call metadata and safety input', () => {
    const call = {
      schemaVersion: 1,
      ...identifiers,
      toolCallId: 'tool_call_safety_001',
      task
    }

    expect(CheckSafetyCallSchema.parse(call)).toEqual(call)
  })

  it('rejects tool metadata that does not match its task', () => {
    const call = {
      schemaVersion: 1,
      ...identifiers,
      requestId: 'different_request',
      toolCallId: 'tool_call_safety_002',
      task
    }

    expect(() => CheckSafetyCallSchema.parse(call)).toThrow()
  })

  it('rejects a safety result whose data belongs to another task', () => {
    const invalid = {
      schemaVersion: 1,
      ...identifiers,
      toolCallId: 'tool_call_safety_003',
      ok: true,
      data: {
        schemaVersion: 1,
        ...identifiers,
        taskId: 'another_task',
        level: 'low',
        action: 'proceed',
        reasonCodes: ['ordinary_life_support'],
        conditions: [],
        missingInformation: []
      }
    }

    expect(() => CheckSafetyResultSchema.parse(invalid)).toThrow()
  })

  it('treats an empty candidate pool as a valid business result input', () => {
    const call = {
      schemaVersion: 1,
      ...identifiers,
      toolCallId: 'tool_call_candidates_001',
      task,
      candidateProfiles: []
    }

    expect(FindCandidatesCallSchema.parse(call).candidateProfiles).toEqual([])
  })

  it('enforces the three-attempt and ten-minute outreach policy', () => {
    const valid = {
      schemaVersion: 1,
      ...identifiers,
      toolCallId: 'tool_call_outreach_001',
      task,
      candidate,
      attempt: 3,
      timeoutMinutes: 10,
      seed: 'happy-path-v1'
    }

    expect(SendOutreachCallSchema.parse(valid)).toEqual(valid)
    expect(() => SendOutreachCallSchema.parse({ ...valid, attempt: 4 })).toThrow()
    expect(() => SendOutreachCallSchema.parse({ ...valid, timeoutMinutes: 5 })).toThrow()
    expect(() =>
      SendOutreachCallSchema.parse({
        ...valid,
        candidate: { ...candidate, taskId: 'another_task' }
      })
    ).toThrow()
  })

  it('rejects candidate mismatches in outreach and match results', () => {
    const context = {
      schemaVersion: 1,
      ...identifiers,
      toolCallId: 'tool_call_candidate_result_001',
      candidateId: candidate.candidateId,
      ok: true
    } as const

    expect(() =>
      SendOutreachResultSchema.parse({
        ...context,
        data: {
          candidateId: 'another_candidate',
          outcome: 'accepted',
          virtualElapsedMinutes: 1,
          respondedAt: '2026-08-01T09:01:00.000Z'
        }
      })
    ).toThrow()

    expect(() =>
      ConfirmMatchResultSchema.parse({
        ...context,
        data: {
          matchId: 'match_demo_001',
          candidateId: 'another_candidate',
          status: 'confirmed',
          scheduledWindow: timeWindow,
          isSimulation: true
        }
      })
    ).toThrow()
  })
})

describe('result and fixture consistency', () => {
  it('rejects fully_matched when any task is not matched', () => {
    const invalid = {
      schemaVersion: 1,
      runId: identifiers.runId,
      requestId: identifiers.requestId,
      status: 'fully_matched',
      taskResults: [
        {
          taskId: identifiers.taskId,
          status: 'unmatched',
          reasonCodes: ['candidate_exhausted'],
          userMessage: '후보가 없습니다.'
        }
      ],
      userMessage: '모두 성사되었습니다.',
      completedAt: '2026-08-01T09:02:00.000Z',
      simulatedComponents: ['outreach'],
      executionBoundary: {
        openaiInterpretation: 'live',
        safetyPolicy: 'deterministic',
        candidateRanking: 'deterministic',
        outreach: 'simulation',
        neighborResponse: 'simulation',
        matchConfirmation: 'simulation'
      }
    }

    expect(() => FinalResultSchema.parse(invalid)).toThrow()
  })

  it('rejects a matched task without a matched candidate', () => {
    const invalid = {
      schemaVersion: 1,
      runId: identifiers.runId,
      requestId: identifiers.requestId,
      status: 'fully_matched',
      taskResults: [
        {
          taskId: identifiers.taskId,
          status: 'matched',
          reasonCodes: [],
          userMessage: '매칭되었습니다.'
        }
      ],
      userMessage: '요청이 성사되었습니다.',
      completedAt: '2026-08-01T09:02:00.000Z',
      simulatedComponents: ['outreach'],
      executionBoundary: {
        openaiInterpretation: 'live',
        safetyPolicy: 'deterministic',
        candidateRanking: 'deterministic',
        outreach: 'simulation',
        neighborResponse: 'simulation',
        matchConfirmation: 'simulation'
      }
    }

    expect(() => FinalResultSchema.parse(invalid)).toThrow()
  })

  it('rejects a candidate id on an unmatched task', () => {
    const invalid = {
      schemaVersion: 1,
      runId: identifiers.runId,
      requestId: identifiers.requestId,
      status: 'unmatched',
      taskResults: [
        {
          taskId: identifiers.taskId,
          status: 'unmatched',
          matchedCandidateId: candidate.candidateId,
          reasonCodes: ['candidate_exhausted'],
          userMessage: '후보가 없습니다.'
        }
      ],
      userMessage: '요청이 성사되지 않았습니다.',
      completedAt: '2026-08-01T09:02:00.000Z',
      simulatedComponents: ['outreach'],
      executionBoundary: {
        openaiInterpretation: 'live',
        safetyPolicy: 'deterministic',
        candidateRanking: 'deterministic',
        outreach: 'simulation',
        neighborResponse: 'simulation',
        matchConfirmation: 'simulation'
      }
    }

    expect(() => FinalResultSchema.parse(invalid)).toThrow()
  })

  it('accepts a contract-valid shared scenario fixture', () => {
    const finalResult = {
      schemaVersion: 1,
      runId: identifiers.runId,
      requestId: identifiers.requestId,
      status: 'fully_matched',
      taskResults: [
        {
          taskId: identifiers.taskId,
          status: 'matched',
          matchedCandidateId: candidate.candidateId,
          reasonCodes: [],
          userMessage: '첫 번째 후보와 매칭되었습니다.'
        }
      ],
      userMessage: '요청이 모두 성사되었습니다.',
      completedAt: '2026-08-01T09:02:00.000Z',
      simulatedComponents: ['outreach'],
      executionBoundary: {
        openaiInterpretation: 'live',
        safetyPolicy: 'deterministic',
        candidateRanking: 'deterministic',
        outreach: 'simulation',
        neighborResponse: 'simulation',
        matchConfirmation: 'simulation'
      }
    } as const

    const fixture = {
      schemaVersion: 1,
      scenarioId: 'first_candidate_accepts',
      seed: 'happy-path-v1',
      initialRequest,
      tasks: [task],
      candidates: [candidate],
      responseSequence: [
        {
          taskId: identifiers.taskId,
          candidateId: candidate.candidateId,
          attempt: 1,
          outcome: 'accepted'
        }
      ],
      expectedRawToolCorrelations: [
        {
          toolCallId: 'tool_call_demo_001',
          callSequence: 1,
          resultSequence: 2
        }
      ],
      expectedEventTypes: [
        'request.created',
        'plan.created',
        'task.created',
        'safety.checked',
        'candidates.ranked',
        'outreach.sent',
        'neighbor.replied',
        'match.confirmed',
        'request.completed'
      ],
      expectedFinalResult: finalResult
    } as const

    expect(DemoScenarioFixtureSchema.parse(fixture)).toEqual(fixture)
  })
})
