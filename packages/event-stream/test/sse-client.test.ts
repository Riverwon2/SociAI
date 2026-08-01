import { describe, expect, it, vi } from 'vitest'

import { buildResumeUrl, connectEventStream, type EventSourceLike } from '../src/sse-client.js'

class FakeEventSource implements EventSourceLike {
  readonly listeners = new Map<string, Array<(event: unknown) => void>>()
  closed = false

  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  close() {
    this.closed = true
  }

  emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

describe('SSE client boundary', () => {
  it('adds the last contiguous sequence without dropping existing query parameters', () => {
    expect(buildResumeUrl('/api/runs/run_demo/events?mode=live', 12)).toBe(
      '/api/runs/run_demo/events?mode=live&afterSequence=12'
    )
    expect(buildResumeUrl('/api/runs/run_demo/events', 0)).toBe(
      '/api/runs/run_demo/events?afterSequence=0'
    )
    expect(buildResumeUrl('https://example.test/events#raw', 2)).toBe(
      'https://example.test/events?afterSequence=2#raw'
    )
  })

  it('reports connection state and parses message JSON without assuming its schema', () => {
    const source = new FakeEventSource()
    const statuses: string[] = []
    const messages: unknown[] = []
    const malformed: string[] = []
    const factory = vi.fn(() => source)

    const connection = connectEventStream({
      url: '/api/events',
      afterSequence: 3,
      eventSourceFactory: factory,
      onStatus: (status) => statuses.push(status),
      onMessage: (message) => messages.push(message),
      onMalformedMessage: (value) => malformed.push(value)
    })

    source.emit('open', {})
    source.emit('message', { data: '{"sequence":4}' })
    source.emit('message', { data: '{not-json' })
    source.emit('message', {})
    source.emit('error', {})
    connection.close()
    source.emit('error', {})
    connection.close()

    expect(factory).toHaveBeenCalledWith('/api/events?afterSequence=3')
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'closed'])
    expect(messages).toEqual([{ sequence: 4 }])
    expect(malformed).toEqual(['{not-json', ''])
    expect(source.closed).toBe(true)
  })

  it('consumes a named SSE event and keeps the same source for native reconnects', () => {
    const source = new FakeEventSource()
    const statuses: string[] = []
    const messages: unknown[] = []
    const factory = vi.fn(() => source)

    connectEventStream({
      url: '/api/runs/run_demo/events',
      eventName: 'agent_event',
      eventSourceFactory: factory,
      onStatus: (status) => statuses.push(status),
      onMessage: (message) => messages.push(message)
    })

    source.emit('message', { data: '{"ignored":true}' })
    source.emit('agent_event', { data: '{"sequence":1}' })
    source.emit('error', {})
    source.emit('open', {})
    source.emit('agent_event', { data: '{"sequence":2}' })

    expect(factory).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledWith('/api/runs/run_demo/events?afterSequence=0')
    expect(messages).toEqual([{ sequence: 1 }, { sequence: 2 }])
    expect(statuses).toEqual(['connecting', 'reconnecting', 'open'])
  })

  it('reports a factory failure before surfacing it', () => {
    const statuses: string[] = []

    expect(() =>
      connectEventStream({
        url: '/api/events',
        eventSourceFactory: () => {
          throw new Error('connection failed')
        },
        onStatus: (status) => statuses.push(status),
        onMessage: () => undefined
      })
    ).toThrow('connection failed')
    expect(statuses).toEqual(['connecting', 'failed'])
  })
})
