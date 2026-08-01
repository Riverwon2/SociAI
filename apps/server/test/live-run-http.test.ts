import { once } from 'node:events'

import { describe, expect, it } from 'vitest'

import {
  AgentEventSchema,
  RawToolEventSchema,
  SCHEMA_VERSION,
  type BuildTaskBundlesCall
} from '@30-minute-exchange/contracts'

import { createLiveRunHttpServer } from '../src/runtime/live-run-http.js'
import type { LiveRunSubscription } from '../src/runtime/live-run-service.js'

const agentEvent = AgentEventSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  eventId: 'event-http-agent-004',
  runId: 'run-http-001',
  requestId: 'request-http-001',
  sequence: 4,
  occurredAt: '2026-08-01T09:00:00.000Z',
  type: 'plan.created',
  message: 'Plan created.',
  isSimulation: false,
  data: {
    revision: 1,
    taskIds: ['task-http-001'],
    summary: 'A plan is being prepared.',
    userInputRequired: false
  }
})

const rawEvent = RawToolEventSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  eventId: 'event-http-raw-002',
  runId: 'run-http-001',
  requestId: 'request-http-001',
  toolCallId: 'call-http-001',
  sequence: 2,
  occurredAt: '2026-08-01T09:00:00.000Z',
  direction: 'tool_result',
  provider: 'openai',
  raw: { type: 'response.completed' }
})

describe('createLiveRunHttpServer', () => {
  it('builds deterministic task bundles through the tool endpoint', async () => {
    const server = createLiveRunHttpServer({
      service: createUnusedService()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Expected a TCP address')

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/tools/build-task-bundles`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(bundleCall)
        }
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        runId: bundleCall.runId,
        requestId: bundleCall.requestId,
        toolCallId: bundleCall.toolCallId,
        data: { processedTaskIds: ['task-http-bundle-001'], heldTaskIds: [] }
      })
    } finally {
      server.close()
      await once(server, 'close')
    }
  })

  it('rejects invalid bundle-tool input without exposing implementation details', async () => {
    const server = createLiveRunHttpServer({
      service: createUnusedService()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Expected a TCP address')

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/tools/build-task-bundles`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...bundleCall, tasks: [] })
        }
      )

      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toEqual({ error: 'input_invalid' })
    } finally {
      server.close()
      await once(server, 'close')
    }
  })

  it('accepts a browser run request and returns the stream endpoints', async () => {
    const server = createLiveRunHttpServer({
      service: {
        start: () => ({
          schemaVersion: SCHEMA_VERSION,
          runId: 'run-http-001',
          requestId: 'request-http-001',
          status: 'accepted',
          agentEventsUrl: '/api/runs/run-http-001/events',
          rawToolEventsUrl: '/api/runs/run-http-001/raw-events'
        }),
        subscribeAgentEvents: () => ({ close: () => undefined }),
        subscribeRawToolEvents: () => ({ close: () => undefined }),
        appendRawToolEvent: () => undefined,
        waitForCompletion: async () => undefined
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Expected a TCP address')

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: 'request-http-001' })
      })

      expect(response.status).toBe(202)
      await expect(response.json()).resolves.toMatchObject({
        runId: 'run-http-001',
        agentEventsUrl: '/api/runs/run-http-001/events'
      })
    } finally {
      server.close()
      await once(server, 'close')
    }
  })

  it('streams agent and raw events with their named SSE event types', async () => {
    const subscriptions: LiveRunSubscription[] = []
    const server = createLiveRunHttpServer({
      service: {
        start: () => {
          throw new Error('Not used by this test')
        },
        subscribeAgentEvents: (_runId, afterSequence, listener) => {
          expect(afterSequence).toBe(3)
          listener(agentEvent)
          const subscription = { close: () => undefined }
          subscriptions.push(subscription)
          return subscription
        },
        subscribeRawToolEvents: (_runId, afterSequence, listener) => {
          expect(afterSequence).toBe(1)
          listener(rawEvent)
          const subscription = { close: () => undefined }
          subscriptions.push(subscription)
          return subscription
        },
        appendRawToolEvent: () => undefined,
        waitForCompletion: async () => undefined
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Expected a TCP address')

    try {
      const agentResponse = await fetch(
        `http://127.0.0.1:${address.port}/api/runs/run-http-001/events?afterSequence=3`
      )
      expect(agentResponse.headers.get('content-type')).toContain('text/event-stream')
      await expect(readFirstSseChunk(agentResponse)).resolves.toContain('event: agent_event')

      const rawResponse = await fetch(
        `http://127.0.0.1:${address.port}/api/runs/run-http-001/raw-events?afterSequence=1`
      )
      await expect(readFirstSseChunk(rawResponse)).resolves.toContain('event: raw_tool_event')
      expect(subscriptions).toHaveLength(2)
    } finally {
      server.close()
      await once(server, 'close')
    }
  })

  it('returns bounded client errors for invalid requests and unknown paths', async () => {
    const server = createLiveRunHttpServer({
      service: {
        start: () => {
          throw new Error('Initial request failed validation')
        },
        subscribeAgentEvents: () => ({ close: () => undefined }),
        subscribeRawToolEvents: () => ({ close: () => undefined }),
        appendRawToolEvent: () => undefined,
        waitForCompletion: async () => undefined
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Expected a TCP address')
    const baseUrl = `http://127.0.0.1:${address.port}`

    try {
      const invalid = await fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })
      expect(invalid.status).toBe(422)
      await expect(invalid.json()).resolves.toMatchObject({ error: 'input_invalid' })

      const empty = await fetch(`${baseUrl}/api/runs`, { method: 'POST' })
      expect(empty.status).toBe(422)

      const unknown = await fetch(`${baseUrl}/not-a-route`)
      expect(unknown.status).toBe(404)
      await expect(unknown.json()).resolves.toEqual({ error: 'not_found' })
    } finally {
      server.close()
      await once(server, 'close')
    }
  })
})

const bundleCall: BuildTaskBundlesCall = {
  schemaVersion: SCHEMA_VERSION,
  runId: 'run-http-bundle-001',
  requestId: 'request-http-bundle-001',
  toolCallId: 'call-http-bundle-001',
  tasks: [
    {
      schemaVersion: SCHEMA_VERSION,
      runId: 'run-http-bundle-001',
      requestId: 'request-http-bundle-001',
      taskId: 'task-http-bundle-001',
      title: 'Return library books',
      description: 'Accompany the requester to return books.',
      timeWindow: {
        startAt: '2026-08-03T01:00:00.000Z',
        endAt: '2026-08-03T01:30:00.000Z'
      },
      region: {
        label: 'Demo district',
        approximateLocation: 'Demo library',
        center: { latitude: 37.5, longitude: 127 }
      },
      requiredExperience: ['library support'],
      estimatedDurationMinutes: 20,
      durationSource: 'explicit',
      timeSource: 'explicit',
      timeCertainty: 'fixed',
      status: 'ready',
      missingInformation: []
    }
  ]
}

function createUnusedService() {
  return {
    start: () => {
      throw new Error('Not used by this test')
    },
    subscribeAgentEvents: () => ({ close: () => undefined }),
    subscribeRawToolEvents: () => ({ close: () => undefined }),
    appendRawToolEvent: () => undefined,
    waitForCompletion: async () => undefined
  }
}

async function readFirstSseChunk(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('Expected a response body')
  const item = await reader.read()
  await reader.cancel()
  return new TextDecoder().decode(item.value)
}
