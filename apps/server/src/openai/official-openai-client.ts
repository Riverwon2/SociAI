import { SCHEMA_VERSION } from '@30-minute-exchange/contracts'
import OpenAI from 'openai'

import type { OpenAIConfig } from '../config/openai-config.js'

type JsonSchema = Readonly<Record<string, unknown>>

export type OpenAIResponsesRequest = Readonly<{
  model: string
  input: string
  text: Readonly<{
    format: Readonly<{
      type: 'json_schema'
      name: 'task_plan'
      strict: true
      schema: JsonSchema
    }>
  }>
}>

export type OpenAIResponsesStreamEvent = Readonly<{
  type: string
  [key: string]: unknown
}>

export type OpenAIResponsesApi = Readonly<{
  create: (request: OpenAIResponsesRequest) => Promise<Readonly<{ output_text: string }>>
  createStream?: (
    request: OpenAIResponsesRequest
  ) => Promise<AsyncIterable<OpenAIResponsesStreamEvent>>
}>

export type OpenAIPlanRequest = Readonly<{
  model: string
  prompt: string
  onRawEvent?: (event: OpenAIResponsesStreamEvent) => void
}>

export type OpenAIPlanClient = Readonly<{
  createStructuredTaskPlan: (request: OpenAIPlanRequest) => Promise<unknown>
}>

export class OfficialOpenAIPlanClient implements OpenAIPlanClient {
  private readonly responsesApi: OpenAIResponsesApi

  constructor(config: OpenAIConfig, responsesApi = createOpenAIResponsesApi(config)) {
    this.responsesApi = responsesApi
  }

  async createStructuredTaskPlan({
    model,
    prompt,
    onRawEvent
  }: OpenAIPlanRequest): Promise<unknown> {
    const request: OpenAIResponsesRequest = {
      model,
      input: prompt,
      text: {
        format: {
          type: 'json_schema',
          name: 'task_plan',
          strict: true,
          schema: TaskPlanResponseJsonSchema
        }
      }
    }

    if (onRawEvent === undefined || this.responsesApi.createStream === undefined) {
      const response = await this.responsesApi.create(request)
      return parseStructuredOutput(response.output_text)
    }

    const stream = await this.responsesApi.createStream(request)
    let outputText = ''
    for await (const event of stream) {
      onRawEvent(event)
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        outputText += event.delta
      }
      if (
        event.type === 'response.completed' &&
        typeof event.response === 'object' &&
        event.response !== null &&
        'output_text' in event.response &&
        typeof event.response.output_text === 'string'
      ) {
        outputText = event.response.output_text
      }
    }

    return parseStructuredOutput(outputText)
  }
}

function createOpenAIResponsesApi(config: OpenAIConfig): OpenAIResponsesApi {
  const client = new OpenAI({ apiKey: config.apiKey })

  return {
    create: async (request) => {
      const response = await client.responses.create(request)
      return { output_text: response.output_text }
    },
    createStream: async (request) => {
      const stream = await client.responses.create({ ...request, stream: true })
      return stream as AsyncIterable<OpenAIResponsesStreamEvent>
    }
  }
}

function parseStructuredOutput(outputText: string): unknown {
  if (outputText.trim().length === 0) {
    throw new Error('OpenAI structured output did not contain text')
  }

  try {
    return JSON.parse(outputText)
  } catch {
    throw new Error('OpenAI structured output was not valid JSON')
  }
}

// This is an OpenAI-only transport schema. The shared Zod 4 contracts remain
// the source of truth and validate the parsed output in orchestration.
const TaskPlanResponseJsonSchema: JsonSchema = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'integer', enum: [SCHEMA_VERSION] },
          runId: { type: 'string' },
          requestId: { type: 'string' },
          taskId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          timeWindow: {
            type: 'object',
            properties: {
              startAt: { type: 'string', format: 'date-time' },
              endAt: { type: 'string', format: 'date-time' }
            },
            required: ['startAt', 'endAt'],
            additionalProperties: false
          },
          region: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              approximateLocation: { type: 'string' }
            },
            required: ['label', 'approximateLocation'],
            additionalProperties: false
          },
          requiredExperience: {
            type: 'array',
            items: { type: 'string' }
          },
          estimatedDurationMinutes: { type: 'integer' },
          durationSource: { type: 'string', enum: ['explicit', 'llm_estimated'] },
          timeSource: { type: 'string', enum: ['explicit', 'inherited_request_window'] },
          timeCertainty: { type: 'string', enum: ['fixed', 'flexible'] },
          status: { type: 'string', enum: ['created'] },
          missingInformation: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' }
              },
              required: ['code', 'message'],
              additionalProperties: false
            }
          }
        },
        required: [
          'schemaVersion',
          'runId',
          'requestId',
          'taskId',
          'title',
          'description',
          'timeWindow',
          'region',
          'requiredExperience',
          'estimatedDurationMinutes',
          'durationSource',
          'timeSource',
          'timeCertainty',
          'status',
          'missingInformation'
        ],
        additionalProperties: false
      }
    },
    summary: { type: 'string' }
  },
  required: ['tasks', 'summary'],
  additionalProperties: false
}
