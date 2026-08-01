import {
  RawToolEventSchema,
  RunAcceptedResponseSchema,
  type InitialRequest,
  type RawToolEvent
} from '@30-minute-exchange/contracts'
import type {
  EventStreamConnection,
  EventStreamConnectionStatus
} from '@30-minute-exchange/event-stream'

export interface LiveRunIdentity {
  readonly runId: string
  readonly requestId: string
  readonly agentEventsUrl: string
  readonly rawToolEventsUrl: string
}

export class LiveRunStartError extends Error {
  constructor(
    readonly category: 'validation' | 'unavailable',
    message: string
  ) {
    super(message)
    this.name = 'LiveRunStartError'
  }
}

export interface LiveStreamSink {
  readonly onMessage: (message: unknown) => void
  readonly onStatus: (status: EventStreamConnectionStatus) => void
  readonly onMalformedMessage: (value: string) => void
}

export interface LiveRunTransport {
  start(request: InitialRequest): Promise<LiveRunIdentity>
  openAgentStream(
    identity: LiveRunIdentity,
    afterSequence: number,
    sink: LiveStreamSink
  ): EventStreamConnection
  openRawStream(
    identity: LiveRunIdentity,
    afterSequence: number,
    sink: LiveStreamSink
  ): EventStreamConnection
}

export interface LiveRunCallbacks {
  readonly onAgentEvent: (event: unknown) => void
  readonly onRawEvent: (event: RawToolEvent) => void
  readonly onStatus: (stream: 'agent' | 'raw', status: EventStreamConnectionStatus) => void
  readonly onIssue: (stream: 'agent' | 'raw', message: string, value: unknown) => void
}

export interface LiveRunConnections {
  readonly identity: LiveRunIdentity
  close(): void
}

export async function startLiveRun(
  request: InitialRequest,
  transport: LiveRunTransport
): Promise<LiveRunIdentity> {
  const identity = await transport.start(request)
  const accepted = RunAcceptedResponseSchema.parse({
    schemaVersion: 2,
    status: 'accepted',
    ...identity
  })
  if (accepted.requestId !== request.requestId) {
    throw new Error('Live run response requestId does not match')
  }
  return {
    runId: accepted.runId,
    requestId: accepted.requestId,
    agentEventsUrl: accepted.agentEventsUrl,
    rawToolEventsUrl: accepted.rawToolEventsUrl
  }
}

export function connectLiveRunStreams(
  identity: LiveRunIdentity,
  transport: LiveRunTransport,
  callbacks: LiveRunCallbacks,
  afterSequence: { readonly agent: number; readonly raw: number } = { agent: 0, raw: 0 }
): LiveRunConnections {
  const streams = openStreams(identity, transport, callbacks, afterSequence)

  let closed = false
  return {
    identity,
    close() {
      if (closed) return
      closed = true
      streams.agent.close()
      streams.raw.close()
    }
  }
}

function openStreams(
  identity: LiveRunIdentity,
  transport: LiveRunTransport,
  callbacks: LiveRunCallbacks,
  afterSequence: { readonly agent: number; readonly raw: number }
): { readonly agent: EventStreamConnection; readonly raw: EventStreamConnection } {
  const agent = transport.openAgentStream(identity, afterSequence.agent, createAgentSink(callbacks))
  try {
    const raw = transport.openRawStream(identity, afterSequence.raw, createRawSink(callbacks))
    return { agent, raw }
  } catch (error) {
    agent.close()
    throw error
  }
}

function createAgentSink(callbacks: LiveRunCallbacks): LiveStreamSink {
  return {
    onMessage: callbacks.onAgentEvent,
    onStatus: (status) => callbacks.onStatus('agent', status),
    onMalformedMessage: (value) =>
      callbacks.onIssue('agent', '정규화 이벤트 JSON을 읽지 못했습니다.', value)
  }
}

function createRawSink(callbacks: LiveRunCallbacks): LiveStreamSink {
  return {
    onMessage(value) {
      const parsed = RawToolEventSchema.safeParse(value)
      if (parsed.success) callbacks.onRawEvent(parsed.data)
      else callbacks.onIssue('raw', 'RawToolEvent 계약 검증에 실패했습니다.', value)
    },
    onStatus: (status) => callbacks.onStatus('raw', status),
    onMalformedMessage: (value) =>
      callbacks.onIssue('raw', 'raw 이벤트 JSON을 읽지 못했습니다.', value)
  }
}

