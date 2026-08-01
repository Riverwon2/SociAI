import {
  InitialRequestSchema,
  RunAcceptedResponseSchema,
  type InitialRequest
} from '@30-minute-exchange/contracts'
import {
  connectEventStream,
  type EventSourceFactory,
  type EventSourceLike
} from '@30-minute-exchange/event-stream'

import {
  LiveRunStartError,
  type LiveRunIdentity,
  type LiveRunTransport,
  type LiveStreamSink
} from './live-run-session.js'

export interface FetchResponseLike {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

export type FetchLike = (
  url: string,
  init: {
    readonly method: 'POST'
    readonly headers: Readonly<Record<string, string>>
    readonly body: string
    readonly credentials: 'same-origin'
  }
) => Promise<FetchResponseLike>

export interface BrowserLiveRunTransportOptions {
  readonly startUrl?: string
  readonly fetcher?: FetchLike
  readonly eventSourceFactory?: EventSourceFactory
}

export function createBrowserLiveRunTransport(
  options: BrowserLiveRunTransportOptions
): LiveRunTransport {
  const fetcher = options.fetcher ?? defaultFetch
  const eventSourceFactory = options.eventSourceFactory ?? defaultEventSourceFactory
  return {
    async start(request: InitialRequest) {
      const validatedRequest = InitialRequestSchema.parse(request)
      const response = await fetcher(options.startUrl ?? '/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validatedRequest),
        credentials: 'same-origin'
      })
      if (!response.ok || response.status !== 202) {
        throw new LiveRunStartError(
          response.status === 400 || response.status === 422 ? 'validation' : 'unavailable',
          `Live run request failed with status ${response.status}`
        )
      }
      const value = await response.json()
      return parseDirectIdentity(value)
    },
    openAgentStream(identity, afterSequence, sink) {
      return openStream(
        identity.agentEventsUrl,
        afterSequence,
        'agent_event',
        sink,
        eventSourceFactory
      )
    },
    openRawStream(identity, afterSequence, sink) {
      return openStream(
        identity.rawToolEventsUrl,
        afterSequence,
        'raw_tool_event',
        sink,
        eventSourceFactory
      )
    }
  }
}

function openStream(
  url: string,
  afterSequence: number,
  eventName: 'agent_event' | 'raw_tool_event',
  sink: LiveStreamSink,
  eventSourceFactory: EventSourceFactory
) {
  return connectEventStream({
    url,
    afterSequence,
    eventName,
    eventSourceFactory,
    onStatus: sink.onStatus,
    onMessage: sink.onMessage,
    onMalformedMessage: sink.onMalformedMessage
  })
}

function parseDirectIdentity(value: unknown): LiveRunIdentity {
  const response = RunAcceptedResponseSchema.parse(value)
  return {
    runId: response.runId,
    requestId: response.requestId,
    agentEventsUrl: response.agentEventsUrl,
    rawToolEventsUrl: response.rawToolEventsUrl
  }
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init)

function defaultEventSourceFactory(url: string): EventSourceLike {
  const source = new EventSource(url)
  return {
    addEventListener(type, listener) {
      source.addEventListener(type, listener as EventListener)
    },
    close: () => source.close()
  }
}

