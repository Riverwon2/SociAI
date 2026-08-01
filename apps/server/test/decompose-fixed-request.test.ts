import { describe, expect, it } from 'vitest'

import { SCHEMA_VERSION } from '@30-minute-exchange/contracts'

import { fixedInitialRequest } from '../src/fixtures/fixed-initial-request.js'
import {
  decomposeFixedRequest,
  type TaskPlanner
} from '../src/orchestration/decompose-fixed-request.js'

const validPlannerOutput = {
  summary: '도서 반납을 위한 실행 계획입니다. 아직 매칭 결과는 확정되지 않았습니다.',
  tasks: [
    {
      schemaVersion: SCHEMA_VERSION,
      runId: 'run-fixed-library-return',
      requestId: 'request-fixed-library-return',
      taskId: 'task-fixed-library-return-1',
      title: '도서관 도서 반납 동행',
      description: '미래구 중앙도서관에 도서를 반납할 수 있도록 동행합니다.',
      timeWindow: {
        startAt: '2026-08-03T10:00:00+09:00',
        endAt: '2026-08-03T10:30:00+09:00'
      },
      region: {
        label: '미래구 중앙도서관 인근',
        approximateLocation: '미래구 별빛로 12 인근'
      },
      requiredExperience: ['도서관 방문 동행'],
      estimatedDurationMinutes: 30,
      status: 'created',
      missingInformation: []
    }
  ]
}

function createPlanner(output: unknown): TaskPlanner {
  return {
    decompose: async () => output
  }
}

describe('decomposeFixedRequest', () => {
  it('validates the fixed fixture before calling OpenAI boundary', async () => {
    let calls = 0
    const invalidFixture = { ...fixedInitialRequest, helpDescription: '' }
    const planner: TaskPlanner = {
      decompose: async () => {
        calls += 1
        return validPlannerOutput
      }
    }

    await expect(
      decomposeFixedRequest({ planner, initialRequest: invalidFixture })
    ).rejects.toThrow(/InitialRequest validation failed/)
    expect(calls).toBe(0)
  })

  it('returns only TaskSchema-validated tasks and a plan-only summary', async () => {
    const result = await decomposeFixedRequest({ planner: createPlanner(validPlannerOutput) })

    expect(result).toMatchObject({
      requestId: fixedInitialRequest.requestId,
      tasks: validPlannerOutput.tasks,
      summary: `실행 계획 요약(매칭 확정 전): ${validPlannerOutput.summary}`
    })
    expect(result.events.map((event) => event.type)).toEqual([
      'request.created',
      'plan.created',
      'task.created'
    ])
    expect(result.events.every((event) => event.schemaVersion === SCHEMA_VERSION)).toBe(true)
  })

  it('fails safely when the LLM output does not satisfy TaskSchema', async () => {
    const invalidOutput = {
      ...validPlannerOutput,
      tasks: [{ ...validPlannerOutput.tasks[0], estimatedDurationMinutes: 31 }]
    }

    await expect(decomposeFixedRequest({ planner: createPlanner(invalidOutput) })).rejects.toThrow(
      /OpenAI plan output failed contract validation/
    )
  })

  it('rejects a non-created task status from the LLM output', async () => {
    const invalidOutput = {
      ...validPlannerOutput,
      tasks: [{ ...validPlannerOutput.tasks[0], status: 'matched' }]
    }

    await expect(decomposeFixedRequest({ planner: createPlanner(invalidOutput) })).rejects.toThrow(
      /OpenAI plan task must use status created/
    )
  })

  it('appends only initial events with increasing sequence numbers', async () => {
    const result = await decomposeFixedRequest({ planner: createPlanner(validPlannerOutput) })

    expect(result.events.map((event) => event.sequence)).toEqual([1, 2, 3])
    expect(result.events.every((event) => event.runId === 'run-fixed-library-return')).toBe(true)
  })
})
