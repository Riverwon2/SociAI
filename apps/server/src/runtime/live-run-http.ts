import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import {
  BuildTaskBundlesCallSchema,
  BuildTaskBundlesResultSchema,
  type AgentEvent,
  type RawToolEvent
} from '@30-minute-exchange/contracts'
import { buildTaskBundles } from '@30-minute-exchange/decisions'

import type { LiveRunService, LiveRunSubscription } from './live-run-service.js'

const MAX_REQUEST_BODY_BYTES = 64 * 1024

export function createLiveRunHttpServer({
  service
}: Readonly<{
  service: LiveRunService
}>): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'POST' && url.pathname === '/api/runs') {
        await handleStartRun(request, response, service)
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/tools/build-task-bundles') {
        await handleBuildTaskBundles(request, response)
        return
      }

      const stream = parseStreamPath(url.pathname)
      if (request.method === 'GET' && stream !== null) {
        handleEventStream(request, response, service, stream, parseAfterSequence(url))
        return
      }

      sendJson(response, 404, { error: 'not_found' })
    } catch {
      sendJson(response, 500, { error: 'internal_error' })
    }
  })
}

async function handleStartRun(
  request: IncomingMessage,
  response: ServerResponse,
  service: LiveRunService
): Promise<void> {
  try {
    const input = await readJson(request)
    const accepted = service.start(input)
    sendJson(response, 202, accepted)
  } catch (error) {
    sendJson(response, 422, {
      error: 'input_invalid',
      message: error instanceof Error ? error.message : 'The run request could not be validated.'
    })
  }
}

async function handleBuildTaskBundles(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  try {
    const call = BuildTaskBundlesCallSchema.parse(await readJson(request))
    const result = BuildTaskBundlesResultSchema.parse(buildTaskBundles(call))
    sendJson(response, 200, result)
  } catch {
    sendJson(response, 422, { error: 'input_invalid' })
  }
}

function handleEventStream(
  request: IncomingMessage,
  response: ServerResponse,
  service: LiveRunService,
  stream: Readonly<{ runId: string; kind: 'agent' | 'raw' }>,
  afterSequence: number
): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  })
  response.flushHeaders()

  const subscription =
    stream.kind === 'agent'
      ? service.subscribeAgentEvents(stream.runId, afterSequence, (event) =>
          writeSse(response, 'agent_event', event)
        )
      : service.subscribeRawToolEvents(stream.runId, afterSequence, (event) =>
          writeSse(response, 'raw_tool_event', event)
        )
  closeSubscriptionOnDisconnect(request, response, subscription)
}

function closeSubscriptionOnDisconnect(
  request: IncomingMessage,
  response: ServerResponse,
  subscription: LiveRunSubscription
): void {
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    subscription.close()
  }
  request.once('close', close)
  response.once('close', close)
}

function parseStreamPath(pathname: string): { runId: string; kind: 'agent' | 'raw' } | null {
  const match = /^\/api\/runs\/([^/]+)\/(events|raw-events)$/.exec(pathname)
  if (match === null) return null
  const encodedRunId = match[1]
  const endpoint = match[2]
  if (encodedRunId === undefined || endpoint === undefined) return null

  return {
    runId: decodeURIComponent(encodedRunId),
    kind: endpoint === 'events' ? 'agent' : 'raw'
  }
}

function parseAfterSequence(url: URL): number {
  const value = Number(url.searchParams.get('afterSequence') ?? '0')
  return Number.isInteger(value) && value >= 0 ? value : 0
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BODY_BYTES) throw new Error('Request body is too large.')
    chunks.push(buffer)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  if (body.trim().length === 0) throw new Error('Request body is required.')
  return JSON.parse(body) as unknown
}

function writeSse(
  response: ServerResponse,
  eventName: 'agent_event' | 'raw_tool_event',
  event: AgentEvent | RawToolEvent
): void {
  response.write(`event: ${eventName}\ndata: ${JSON.stringify(event)}\n\n`)
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}
