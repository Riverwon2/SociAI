import { describe, expect, it, vi } from 'vitest'
import type { EventSourceLike } from '@30-minute-exchange/event-stream'

import { getDemoScenario } from '../src/demo/scenarios.js'
import {
  createBrowserLiveRunTransport,
  type FetchLike
} from '../src/live/browser-live-run-transport.js'
import { LiveRunStartError, type LiveStreamSink } from '../src/live/live-run-session.js'

describe('browser live transport adapter', () => {
  const request = getDemoScenario('first_candidate_accepts').fixture.initialRequest
  const accepted = {
    schemaVersion: 2,
    runId: 'run_live',
    requestId: request.requestId,
    status: 'accepted',
    agentEventsUrl: '/api/runs/run_live/events',
    rawToolEventsUrl: '/api/runs/run_live/raw-events'
  } as const

  it('posts InitialRequest, validates the 202 response, and opens both named streams', async () => {
    const fetcher = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 202,
      json: async () => accepted
    }))
    const sources: FakeEventSource[] = []
    const transport = createBrowserLiveRunTransport({
      fetcher,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source
      }
    })

    const identity = await transport.start(request)
    expect(identity).toEqual({
      runId: accepted.runId,
      requestId: accepted.requestId,
      agentEventsUrl: accepted.agentEventsUrl,
      rawToolEventsUrl: accepted.rawToolEventsUrl
    })
    expect(fetcher).toHaveBeenCalledWith('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      credentials: 'same-origin'
    })

    const agentSink = sink()
    const rawSink = sink()
    const agent = transport.openAgentStream(identity, 0, agentSink)
    const raw = transport.openRawStream(identity, 4, rawSink)
    sources[0]?.emit('open', {})
    sources[0]?.emit('message', { data: '{"ignored":true}' })
    sources[0]?.emit('agent_event', { data: '{"sequence":1}' })
    sources[1]?.emit('raw_tool_event', { data: '{bad' })

    expect(agent.url).toBe('/api/runs/run_live/events?afterSequence=0')
    expect(raw.url).toBe('/api/runs/run_live/raw-events?afterSequence=4')
    expect(agentSink.onStatus).toHaveBeenCalledWith('open')
    expect(agentSink.onMessage).toHaveBeenCalledOnce()
    expect(agentSink.onMessage).toHaveBeenCalledWith({ sequence: 1 })
    expect(rawSink.onMalformedMessage).toHaveBeenCalledWith('{bad')
  })

  it('rejects non-202 success responses, invalid response URLs, and error bodies safely', async () => {
    const wrongStatus = createBrowserLiveRunTransport({
      fetcher: async () => ({ ok: true, status: 200, json: async () => accepted }),
      eventSourceFactory: () => new FakeEventSource('/unused')
    })
    await expect(wrongStatus.start(request)).rejects.toThrow('status 200')

    const wrongUrl = createBrowserLiveRunTransport({
      fetcher: async () => ({
        ok: true,
        status: 202,
        json: async () => ({ ...accepted, agentEventsUrl: '/api/runs/another_run/events' })
      }),
      eventSourceFactory: () => new FakeEventSource('/unused')
    })
    await expect(wrongUrl.start(request)).rejects.toThrow()

    const rejected = createBrowserLiveRunTransport({
      fetcher: async () => ({
        ok: false,
        status: 503,
        json: async () => ({ providerSecret: 'must not appear in error' })
      }),
      eventSourceFactory: () => new FakeEventSource('/unused')
    })
    await expect(rejected.start(request)).rejects.toThrow('status 503')
    await expect(rejected.start(request)).rejects.not.toThrow('providerSecret')

    const invalid = createBrowserLiveRunTransport({
      fetcher: async () => ({ ok: false, status: 422, json: async () => ({}) }),
      eventSourceFactory: () => new FakeEventSource('/unused')
    })
    await expect(invalid.start(request)).rejects.toBeInstanceOf(LiveRunStartError)
    await expect(invalid.start(request)).rejects.toMatchObject({ category: 'validation' })
  })
})

class FakeEventSource implements EventSourceLike {
  readonly listeners = new Map<string, Array<(event: unknown) => void>>()
  readonly close = vi.fn()

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? []
    this.listeners.set(type, [...listeners, listener])
  }

  emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function sink(): LiveStreamSink {
  return {
    onMessage: vi.fn(),
    onStatus: vi.fn(),
    onMalformedMessage: vi.fn()
  }
}

