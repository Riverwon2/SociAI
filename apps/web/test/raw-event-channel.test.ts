import { describe, expect, it, vi } from 'vitest'
import type { RawToolEvent } from '@30-minute-exchange/contracts'

import {
  createRawEventPublisher,
  subscribeToRawEvents,
  type BroadcastChannelFactory,
  type BroadcastChannelLike,
  type MessageEventLike
} from '../src/raw-console/raw-event-channel.js'

class FakeChannelHub {
  readonly channels = new Set<FakeChannel>()

  readonly factory: BroadcastChannelFactory = () => {
    const channel = new FakeChannel(this)
    this.channels.add(channel)
    return channel
  }

  broadcast(sender: FakeChannel, message: unknown) {
    for (const channel of this.channels) {
      if (channel !== sender && !channel.closed) channel.receive(message)
    }
  }
}

class FakeChannel implements BroadcastChannelLike {
  readonly listeners: Array<(event: MessageEventLike) => void> = []
  closed = false

  constructor(private readonly hub: FakeChannelHub) {}

  postMessage(message: unknown) {
    this.hub.broadcast(this, message)
  }

  addEventListener(_type: 'message', listener: (event: MessageEventLike) => void) {
    this.listeners.push(listener)
  }

  receive(data: unknown) {
    for (const listener of this.listeners) listener({ data })
  }

  close() {
    this.closed = true
  }
}

describe('raw second-screen channel', () => {
  it('synchronizes existing events and forwards new events without changing raw', () => {
    const hub = new FakeChannelHub()
    const publisher = createRawEventPublisher(hub.factory)
    const first = rawEvent(1, 'tool_call')
    const second = rawEvent(2, 'tool_result')
    publisher.publish(first)
    const received: RawToolEvent[] = []
    const subscription = subscribeToRawEvents(
      'run_demo',
      (event) => received.push(event),
      hub.factory
    )

    publisher.publish(second)

    expect(received).toEqual([first, second])
    expect(received[1]?.raw).toEqual({ exact: '<script>text only</script>', sequence: 2 })
    subscription.close()
    publisher.close()
    expect([...hub.channels].every(({ closed }) => closed)).toBe(true)
  })

  it('ignores invalid messages and events from another run', () => {
    const hub = new FakeChannelHub()
    const received = vi.fn()
    subscribeToRawEvents('run_demo', received, hub.factory)
    const sender = hub.factory('ignored') as FakeChannel

    sender.postMessage({ kind: 'event', event: { invalid: true } })
    sender.postMessage({ kind: 'event', event: rawEvent(1, 'tool_call', 'another_run') })
    sender.postMessage({ kind: 'sync.snapshot', runId: 'run_demo', events: [{ invalid: true }] })

    expect(received).not.toHaveBeenCalled()
  })
})

function rawEvent(
  sequence: number,
  direction: RawToolEvent['direction'],
  runId = 'run_demo'
): RawToolEvent {
  return {
    schemaVersion: 2,
    eventId: `raw_${sequence}`,
    runId,
    requestId: 'request_demo',
    toolCallId: 'call_demo',
    sequence,
    occurredAt: `2026-08-01T08:00:0${sequence}.000Z`,
    direction,
    provider: 'openai',
    raw: { exact: '<script>text only</script>', sequence }
  }
}
