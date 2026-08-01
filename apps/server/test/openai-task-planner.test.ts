import { describe, expect, it } from 'vitest'

import { fixedInitialRequest } from '../src/fixtures/fixed-initial-request.js'
import type { OpenAIPlanClient, OpenAIPlanRequest } from '../src/openai/official-openai-client.js'
import { OpenAITaskPlanner } from '../src/openai/openai-task-planner.js'

describe('OpenAITaskPlanner', () => {
  it('uses an injected OpenAI client and sends an untrusted-data instruction', async () => {
    let receivedRequest: OpenAIPlanRequest | undefined
    const client: OpenAIPlanClient = {
      createStructuredTaskPlan: async (request) => {
        receivedRequest = request
        return { tasks: [], summary: '계획' }
      }
    }
    const planner = new OpenAITaskPlanner({ client, model: 'gpt-5-mini' })

    await planner.decompose({
      initialRequest: fixedInitialRequest,
      runId: 'run-fixed-library-return'
    })

    expect(receivedRequest).toMatchObject({ model: 'gpt-5-mini' })
    expect(receivedRequest?.prompt).toContain('untrusted data')
    expect(receivedRequest?.prompt).toContain('llm_estimated')
    expect(receivedRequest?.prompt).toContain('Do not group tasks')
  })
})
