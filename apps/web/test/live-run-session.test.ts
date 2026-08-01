import { describe, expect, it, vi } from 'vitest'
import type { InitialRequest, RawToolEvent } from '@30-minute-exchange/contracts'
import type { EventStreamConnection } from '@30-minute-exchange/event-stream'

import { getDemoScenario } from '../src/demo/scenarios.js'
import {
  connectLiveRunStreams,
  startLiveRun,
  type LiveRunTransport,
  type LiveStreamSink
} from '../src/live/live-run-session.js'

describe('live run integration seam', () => {
  const request = getDemoScenario('first_candidate_accepts').fixture.initialRequest

  it('validates the started run identity against the submitted request', async () => {
    const transport = createTransport(request)

    await expect(startLiveRun(request, transport)).resolves.toEqual({
      runId: 'run_live',
      requestId: request.requestId,
      agentEventsUrl: '/api/runs/run_live/events',
      rawToolEventsUrl: '/api/runs/run_live/raw-events'
    })

    const mismatch = createTransport({ ...request, requestId: 'another_request' })
    await expect(startLiveRun(request, mismatch)).rejects.toThrow('requestId does not match')
  })

  it('opens separate streams from their own last sequence and validates raw events', () => {
    const transport = createTransport(request)
    const agentEvents: unknown[] = []
    const rawEvents: RawToolEvent[] = []
    const issues: string[] = []
    const statuses: string[] = []
    const identity = liveIdentity(request.requestId)
    const connections = connectLiveRunStreams(
      identity,
      transport,
      {
        onAgentEvent: (event) => agentEvents.push(event),
        onRawEvent: (event) => rawEvents.push(event),
        onStatus: (stream, status) => statuses.push(`${stream}:${status}`),
        onIssue: (stream, message) => issues.push(`${stream}:${message}`)
      },
      { agent: 7, raw: 4 }
    )

    transport.agentSink?.onMessage({ sequence: 8 })
    transport.agentSink?.onStatus('open')
    transport.agentSink?.onMalformedMessage('{bad')
    transport.rawSink?.onMessage(rawEvent(request.requestId))
    transport.rawSink?.onMessage({ invalid: true })
    transport.rawSink?.onMalformedMessage('{bad')

    expect(transport.agentAfterSequences).toEqual([7])
    expect(transport.rawAfterSequences).toEqual([4])
    expect(agentEvents).toEqual([{ sequence: 8 }])
    expect(rawEvents).toHaveLength(1)
    expect(statuses).toEqual(['agent:open'])
    expect(issues).toEqual([
      'agent:정규화 이벤트 JSON을 읽지 못했습니다.',
      'raw:RawToolEvent 계약 검증에 실패했습니다.',
      'raw:raw 이벤트 JSON을 읽지 못했습니다.'
    ])
    connections.close()
    connections.close()
    expect(transport.agentConnection.close).toHaveBeenCalledOnce()
    expect(transport.rawConnection.close).toHaveBeenCalledOnce()
  })

  it('closes the normalized stream if opening the raw stream fails', () => {
    const transport = createTransport(request)
    transport.openRawStream = () => {
      throw new Error('raw unavailable')
    }

    expect(() =>
      connectLiveRunStreams(liveIdentity(request.requestId), transport, emptyCallbacks())
    ).toThrow('raw unavailable')
    expect(transport.agentConnection.close).toHaveBeenCalledOnce()
  })
})

interface TestTransport extends LiveRunTransport {
  agentSink: LiveStreamSink | null
  rawSink: LiveStreamSink | null
  agentAfterSequences: number[]
  rawAfterSequences: number[]
  readonly agentConnection: EventStreamConnection & { close: ReturnType<typeof vi.fn> }
  readonly rawConnection: EventStreamConnection & { close: ReturnType<typeof vi.fn> }
}

function createTransport(responseRequest: InitialRequest): TestTransport {
  const agentConnection = connection('/agent')
  const rawConnection = connection('/raw')
  return {
    agentSink: null,
    rawSink: null,
    agentAfterSequences: [],
    rawAfterSequences: [],
    agentConnection,
    rawConnection,
    start: vi.fn(async () => liveIdentity(responseRequest.requestId)),
    openAgentStream(_identity, afterSequence, sink) {
      this.agentAfterSequences.push(afterSequence)
      this.agentSink = sink
      return agentConnection
    },
    openRawStream(_identity, afterSequence, sink) {
      this.rawAfterSequences.push(afterSequence)
      this.rawSink = sink
      return rawConnection
    }
  }
}

function connection(url: string) {
  return { url, close: vi.fn() }
}

function emptyCallbacks() {
  return {
    onAgentEvent: vi.fn(),
    onRawEvent: vi.fn(),
    onStatus: vi.fn(),
    onIssue: vi.fn()
  }
}

function rawEvent(requestId: string): RawToolEvent {
  return {
    schemaVersion: 2,
    eventId: 'raw_live_1',
    runId: 'run_live',
    requestId,
    toolCallId: 'call_live_1',
    sequence: 1,
    occurredAt: '2026-08-01T08:00:00.000Z',
    direction: 'tool_call',
    provider: 'openai',
    raw: { exact: true }
  }
}

function liveIdentity(requestId: string) {
  return {
    runId: 'run_live',
    requestId,
    agentEventsUrl: '/api/runs/run_live/events',
    rawToolEventsUrl: '/api/runs/run_live/raw-events'
  }
}
