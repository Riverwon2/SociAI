import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RawToolEvent } from '@30-minute-exchange/contracts'

import { MAX_VISIBLE_RAW_CORRELATIONS, RawConsolePage } from '../src/raw-console/RawConsolePage.js'
import {
  createRawEventPublisher,
  type BroadcastChannelFactory,
  type BroadcastChannelLike,
  type MessageEventLike
} from '../src/raw-console/raw-event-channel.js'

afterEach(() => window.history.replaceState({}, '', '/'))

describe('live raw console', () => {
  it('renders an unchanged call/result pair received from the second-screen channel', () => {
    const hub = new FakeChannelHub()
    const publisher = createRawEventPublisher(hub.factory)
    const call = rawEvent(1, 'tool_call', {
      type: 'response.function_call_arguments.done',
      untrusted: '<script>window.compromised=true</script>'
    })
    const result = rawEvent(2, 'tool_result', {
      output: { accepted: true, untouched: [1, false, null] }
    })
    publisher.publish(call)
    window.history.replaceState({}, '', '/raw?mode=live&runId=run_demo')

    render(<RawConsolePage channelFactory={hub.factory} />)
    act(() => publisher.publish(result))

    expect(screen.getByText('complete')).toBeInTheDocument()
    expect(screen.getByText('call_demo')).toBeInTheDocument()
    const payloads = screen.getAllByText((_content, element) => element?.tagName === 'PRE')
    expect(payloads.map(({ textContent }) => textContent)).toEqual([
      JSON.stringify(call.raw, null, 2),
      JSON.stringify(result.raw, null, 2)
    ])
    expect(document.querySelector('script')).toBeNull()
    publisher.close()
  })

  it('caps rendered correlations without dropping them from the receive buffer', () => {
    const hub = new FakeChannelHub()
    const publisher = createRawEventPublisher(hub.factory)
    for (let sequence = 1; sequence <= MAX_VISIBLE_RAW_CORRELATIONS + 1; sequence += 1) {
      publisher.publish(
        rawEvent(sequence, 'tool_call', { sequence }, `call_${String(sequence).padStart(3, '0')}`)
      )
    }
    window.history.replaceState({}, '', '/raw?mode=live&runId=run_demo')

    render(<RawConsolePage channelFactory={hub.factory} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      `최근 ${MAX_VISIBLE_RAW_CORRELATIONS}개 호출만 표시`
    )
    expect(screen.getByText(`${MAX_VISIBLE_RAW_CORRELATIONS + 1} events`)).toBeInTheDocument()
    expect(screen.queryByText('call_001')).not.toBeInTheDocument()
    expect(screen.getByText('call_201')).toBeInTheDocument()
    publisher.close()
  })
})

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

function rawEvent(
  sequence: number,
  direction: RawToolEvent['direction'],
  raw: RawToolEvent['raw'],
  toolCallId = 'call_demo'
): RawToolEvent {
  return {
    schemaVersion: 2,
    eventId: `raw_${sequence}`,
    runId: 'run_demo',
    requestId: 'request_demo',
    toolCallId,
    sequence,
    occurredAt: `2026-08-01T${String(Math.floor(sequence / 60)).padStart(2, '0')}:${String(sequence % 60).padStart(2, '0')}:00.000Z`,
    direction,
    provider: 'openai',
    raw
  }
}

