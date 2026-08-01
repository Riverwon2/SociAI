import type { AgentEvent, RawToolEvent } from '@30-minute-exchange/contracts'

export function createAgentEvent(
  sequence: number,
  overrides: Partial<AgentEvent> = {}
): AgentEvent {
  return {
    schemaVersion: 2,
    eventId: `event_${sequence}`,
    runId: 'run_demo',
    requestId: 'request_demo',
    sequence,
    occurredAt: `2026-08-01T09:00:${String(sequence).padStart(2, '0')}.000Z`,
    type: 'plan.created',
    message: '실행 계획을 만들었습니다.',
    isSimulation: false,
    data: {
      revision: 1,
      taskIds: ['task_demo'],
      summary: '안전한 지역 도움을 순서대로 연결합니다.',
      userInputRequired: false
    },
    ...overrides
  } as AgentEvent
}

export function createRawToolEvent(
  sequence: number,
  direction: RawToolEvent['direction'],
  overrides: Partial<RawToolEvent> = {}
): RawToolEvent {
  return {
    schemaVersion: 2,
    eventId: `raw_event_${sequence}`,
    runId: 'run_demo',
    requestId: 'request_demo',
    taskId: 'task_demo',
    toolCallId: 'tool_call_demo',
    sequence,
    occurredAt: `2026-08-01T09:01:${String(sequence).padStart(2, '0')}.000Z`,
    direction,
    provider: 'openai',
    raw: {
      type: direction === 'tool_call' ? 'response.output_item.added' : 'response.output_item.done',
      payload: { sequence }
    },
    ...overrides
  }
}
