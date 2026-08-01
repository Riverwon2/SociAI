export type EventStreamConnectionStatus =
  'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed'

export interface EventSourceLike {
  addEventListener(type: string, listener: (event: unknown) => void): void
  close(): void
}

export type EventSourceFactory = (url: string) => EventSourceLike

export interface ConnectEventStreamOptions {
  readonly url: string
  readonly afterSequence?: number
  readonly eventName?: string
  readonly eventSourceFactory: EventSourceFactory
  readonly onStatus: (status: EventStreamConnectionStatus) => void
  readonly onMessage: (message: unknown) => void
  readonly onMalformedMessage?: (value: string) => void
}

export interface EventStreamConnection {
  readonly url: string
  close(): void
}

export function buildResumeUrl(url: string, afterSequence: number): string {
  if (!Number.isInteger(afterSequence) || afterSequence < 0) return url

  const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(url)
  const parsed = new URL(url, 'http://event-stream.local')
  parsed.searchParams.set('afterSequence', String(afterSequence))
  return isAbsolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function connectEventStream(options: ConnectEventStreamOptions): EventStreamConnection {
  const resolvedUrl = buildResumeUrl(options.url, options.afterSequence ?? 0)
  options.onStatus('connecting')

  let source: EventSourceLike
  try {
    source = options.eventSourceFactory(resolvedUrl)
  } catch (error) {
    options.onStatus('failed')
    throw error
  }

  let closed = false
  source.addEventListener('open', () => options.onStatus('open'))
  source.addEventListener('error', () => {
    if (!closed) options.onStatus('reconnecting')
  })
  source.addEventListener(options.eventName ?? 'message', (event) => parseMessage(event, options))

  return {
    url: resolvedUrl,
    close() {
      if (closed) return
      closed = true
      source.close()
      options.onStatus('closed')
    }
  }
}

function parseMessage(event: unknown, options: ConnectEventStreamOptions) {
  const data = getMessageData(event)
  if (data === null) {
    options.onMalformedMessage?.('')
    return
  }

  try {
    options.onMessage(JSON.parse(data) as unknown)
  } catch {
    options.onMalformedMessage?.(data)
  }
}

function getMessageData(event: unknown): string | null {
  if (typeof event !== 'object' || event === null || !('data' in event)) return null
  return typeof event.data === 'string' ? event.data : null
}
