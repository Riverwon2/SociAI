import { describe, expect, it } from 'vitest'

import {
  OfficialOpenAIPlanClient,
  type OpenAIResponsesApi,
  type OpenAIResponsesRequest
} from '../src/openai/official-openai-client.js'

describe('OfficialOpenAIPlanClient', () => {
  it('uses a strict object JSON Schema instead of the SDK Zod helper', async () => {
    let receivedRequest: OpenAIResponsesRequest | undefined
    const responsesApi: OpenAIResponsesApi = {
      create: async (request) => {
        receivedRequest = request
        return { output_text: JSON.stringify({ tasks: [], summary: '실행 계획입니다.' }) }
      }
    }
    const client = new OfficialOpenAIPlanClient(
      { apiKey: 'test-key', model: 'gpt-5-mini' },
      responsesApi
    )

    await expect(
      client.createStructuredTaskPlan({ model: 'gpt-5-mini', prompt: 'test prompt' })
    ).resolves.toEqual({ tasks: [], summary: '실행 계획입니다.' })
    expect(receivedRequest?.text.format).toMatchObject({
      type: 'json_schema',
      name: 'task_plan',
      strict: true
    })
    expect(receivedRequest?.text.format.schema).toMatchObject({ type: 'object' })
  })

  it('fails safely when OpenAI returns non-JSON output', async () => {
    const responsesApi: OpenAIResponsesApi = {
      create: async () => ({ output_text: 'not JSON' })
    }
    const client = new OfficialOpenAIPlanClient(
      { apiKey: 'test-key', model: 'gpt-5-mini' },
      responsesApi
    )

    await expect(
      client.createStructuredTaskPlan({ model: 'gpt-5-mini', prompt: 'test prompt' })
    ).rejects.toThrow(/valid JSON/)
  })
})
