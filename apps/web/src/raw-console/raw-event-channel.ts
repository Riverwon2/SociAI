import { RawToolEventSchema, type RawToolEvent } from '@30-minute-exchange/contracts'

export const RAW_EVENT_CHANNEL_NAME = 'sociai.raw-tool-events.v2'

export interface MessageEventLike {
  readonly data: unknown
}

export interface BroadcastChannelLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void
  close(): void
}

export type BroadcastChannelFactory = (name: string) => BroadcastChannelLike

export interface RawEventPublisher {
  publish(event: RawToolEvent): void
  close(): void
}

export interface RawEventSubscription {
  close(): void
}

type RawChannelMessage =
  | { readonly kind: 'event'; readonly event: RawToolEvent }
  | { readonly kind: 'sync.request'; readonly runId: string }
  | {
      readonly kind: 'sync.snapshot'
      readonly runId: string
      readonly events: readonly RawToolEvent[]
    }

export function createRawEventPublisher(
  factory: BroadcastChannelFactory = defaultChannelFactory
): RawEventPublisher {
  const channel = factory(RAW_EVENT_CHANNEL_NAME)
  const history = new Map<string, RawToolEvent[]>()

  channel.addEventListener('message', ({ data }) => {
    const message = parseMessage(data)
    if (message?.kind !== 'sync.request') return
    channel.postMessage({
      kind: 'sync.snapshot',
      runId: message.runId,
      events: history.get(message.runId) ?? []
    } satisfies RawChannelMessage)
  })

  return {
    publish(event) {
      const events = history.get(event.runId) ?? []
      history.set(event.runId, [...events, event])
      channel.postMessage({ kind: 'event', event } satisfies RawChannelMessage)
    },
    close: () => channel.close()
  }
}

export function subscribeToRawEvents(
  runId: string,
  onEvent: (event: RawToolEvent) => void,
  factory: BroadcastChannelFactory = defaultChannelFactory
): RawEventSubscription {
  const channel = factory(RAW_EVENT_CHANNEL_NAME)
  channel.addEventListener('message', ({ data }) => {
    const message = parseMessage(data)
    if (message?.kind === 'event' && message.event.runId === runId) onEvent(message.event)
    if (message?.kind === 'sync.snapshot' && message.runId === runId) {
      for (const event of message.events) onEvent(event)
    }
  })
  channel.postMessage({ kind: 'sync.request', runId } satisfies RawChannelMessage)
  return { close: () => channel.close() }
}

function parseMessage(value: unknown): RawChannelMessage | null {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return null
  if (value.kind === 'sync.request' && 'runId' in value && typeof value.runId === 'string') {
    return { kind: 'sync.request', runId: value.runId }
  }
  if (value.kind === 'event' && 'event' in value) {
    const event = RawToolEventSchema.safeParse(value.event)
    return event.success ? { kind: 'event', event: event.data } : null
  }
  if (value.kind === 'sync.snapshot' && 'runId' in value && 'events' in value) {
    if (typeof value.runId !== 'string' || !Array.isArray(value.events)) return null
    const events = value.events.map((event) => RawToolEventSchema.safeParse(event))
    if (events.some((event) => !event.success)) return null
    return {
      kind: 'sync.snapshot',
      runId: value.runId,
      events: events.flatMap((event) => (event.success ? [event.data] : []))
    }
  }
  return null
}

function defaultChannelFactory(name: string): BroadcastChannelLike {
  return new BroadcastChannel(name)
}
