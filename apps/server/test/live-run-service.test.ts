import { describe, expect, it } from 'vitest'

import {
  AgentEventSchema,
  RawToolEventSchema,
  SCHEMA_VERSION,
  type Task
} from '@30-minute-exchange/contracts'

import { fixedInitialRequest } from '../src/fixtures/fixed-initial-request.js'
import type { TaskPlanner } from '../src/orchestration/decompose-fixed-request.js'
import { createLiveRunService } from '../src/runtime/live-run-service.js'

const runId = 'run-live-service-001'

const planner: TaskPlanner = {
  decompose: async () => ({
    summary: 'This is a proposed plan, not a confirmed match.',
    tasks: [
      {
        schemaVersion: SCHEMA_VERSION,
        runId,
        requestId: fixedInitialRequest.requestId,
        taskId: 'task-live-service-001',
        title: 'Return library books',
        description: 'Return the books during the requested time window.',
        timeWindow: fixedInitialRequest.timeWindow,
        region: fixedInitialRequest.activityRegion,
        requiredExperience: ['library support'],
        estimatedDurationMinutes: 20,
        durationSource: 'llm_estimated',
        timeSource: 'inherited_request_window',
        timeCertainty: 'flexible',
        status: 'created',
        missingInformation: []
      } satisfies Task
    ]
  })
}

describe('createLiveRunService', () => {
  it('starts a validated request and publishes its workflow events in sequence', async () => {
    const service = createLiveRunService({
      planner,
      createCandidateProfiles: () => [],
      createRunId: () => runId,
      occurredAt: '2026-08-01T09:00:00.000Z'
    })

    const accepted = service.start(fixedInitialRequest)
    const received: unknown[] = []
    const subscription = service.subscribeAgentEvents(accepted.runId, 0, (event) => {
      received.push(event)
    })

    await service.waitForCompletion(accepted.runId)
    subscription.close()

    expect(accepted).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      runId,
      requestId: fixedInitialRequest.requestId,
      status: 'accepted',
      agentEventsUrl: `/api/runs/${runId}/events`,
      rawToolEventsUrl: `/api/runs/${runId}/raw-events`
    })
    expect(received.map((event) => AgentEventSchema.parse(event).sequence)).toEqual(
      received.map((_, index) => index + 1)
    )
    expect(received.at(-1)).toMatchObject({ type: 'request.completed' })
  })

  it('replays raw provider events after a requested sequence and rejects unknown runs', async () => {
    const service = createLiveRunService({
      planner,
      createCandidateProfiles: () => [],
      createRunId: () => runId,
      occurredAt: '2026-08-01T09:00:00.000Z'
    })
    service.start(fixedInitialRequest)

    service.appendRawToolEvent(
      runId,
      RawToolEventSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        eventId: 'raw-live-service-001',
        runId,
        requestId: fixedInitialRequest.requestId,
        toolCallId: 'call-openai-001',
        sequence: 1,
        occurredAt: '2026-08-01T09:00:00.000Z',
        direction: 'tool_result',
        provider: 'openai',
        raw: { type: 'response.completed' }
      })
    )
    const received: unknown[] = []
    const subscription = service.subscribeRawToolEvents(runId, -1, (event) => received.push(event))
    subscription.close()

    expect(received).toHaveLength(1)
    expect(() => service.subscribeAgentEvents('run-unknown', 0, () => undefined)).toThrow(
      'Unknown run'
    )
    expect(() => service.start(fixedInitialRequest)).toThrow('A run already exists')
    await service.waitForCompletion(runId)
  })
})
