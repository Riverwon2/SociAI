import process from 'node:process'

import { loadWorkspaceEnvironmentFile } from './config/load-environment-file.js'
import { loadOpenAIConfig } from './config/openai-config.js'
import helperUsersFixture from './fixtures/helper-users.json' with { type: 'json' }
import { createHelperUserCandidateProvider } from './fixtures/helper-user-candidate-provider.js'
import { OfficialOpenAIPlanClient } from './openai/official-openai-client.js'
import { OpenAITaskPlanner } from './openai/openai-task-planner.js'
import { createLiveRunHttpServer } from './runtime/live-run-http.js'
import { createLiveRunService } from './runtime/live-run-service.js'

loadWorkspaceEnvironmentFile()
const config = loadOpenAIConfig(process.env)
const port = parsePort(process.env.PORT)
const helperUserCandidates = createHelperUserCandidateProvider(helperUsersFixture)
const service = createLiveRunService({
  planner: new OpenAITaskPlanner({
    client: new OfficialOpenAIPlanClient(config),
    model: config.model
  }),
  createCandidateProfiles: helperUserCandidates.createCandidateProfiles,
  workflowTools: {
    findCandidatesForBundle: helperUserCandidates.findCandidatesForBundle
  }
})
const server = createLiveRunHttpServer({ service })

server.listen(port, '127.0.0.1', () => {
  console.log(`30-minute-exchange live API listening on http://127.0.0.1:${port}`)
})

function parsePort(value: string | undefined): number {
  if (value === undefined) return 8787
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }
  return port
}
