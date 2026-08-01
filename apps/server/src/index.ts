import process from 'node:process'

import { loadOpenAIConfig } from './config/openai-config.js'
import { OfficialOpenAIPlanClient } from './openai/official-openai-client.js'
import { OpenAITaskPlanner } from './openai/openai-task-planner.js'
import { decomposeFixedRequest } from './orchestration/decompose-fixed-request.js'

const config = loadOpenAIConfig(process.env)
const result = await decomposeFixedRequest({
  planner: new OpenAITaskPlanner({
    client: new OfficialOpenAIPlanClient(config),
    model: config.model
  })
})

console.log(
  JSON.stringify(
    {
      requestId: result.requestId,
      tasks: result.tasks,
      summary: result.summary
    },
    null,
    2
  )
)
