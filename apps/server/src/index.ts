import process from 'node:process'

import { loadInitialRequestFromEnvironment } from './config/initial-request-input.js'
import { loadWorkspaceEnvironmentFile } from './config/load-environment-file.js'
import { loadOpenAIConfig } from './config/openai-config.js'
import { fixedInitialRequest } from './fixtures/fixed-initial-request.js'
import helperUsersFixture from './fixtures/helper-users.json' with { type: 'json' }
import { createHelperUserCandidateProvider } from './fixtures/helper-user-candidate-provider.js'
import { OfficialOpenAIPlanClient } from './openai/official-openai-client.js'
import { OpenAITaskPlanner } from './openai/openai-task-planner.js'
import { decomposeFixedRequest } from './orchestration/decompose-fixed-request.js'
import { runBundleWorkflow } from './orchestration/run-bundle-workflow.js'
import {
  createWorkflowHookEmitter,
  writeWorkflowHookToConsole
} from './orchestration/workflow-hooks.js'

loadWorkspaceEnvironmentFile()
const config = loadOpenAIConfig(process.env)
const hooks = createWorkflowHookEmitter({ onHook: writeWorkflowHookToConsole })
const isInputRun = process.argv.includes('--input')
const initialRequest = isInputRun
  ? loadInitialRequestFromEnvironment(process.env)
  : fixedInitialRequest
const runId = isInputRun ? `run-${initialRequest.requestId}` : undefined
const decomposition = await decomposeFixedRequest({
  planner: new OpenAITaskPlanner({
    client: new OfficialOpenAIPlanClient(config),
    model: config.model
  }),
  initialRequest,
  hooks,
  ...(runId === undefined ? {} : { runId })
})
const helperUserCandidates = createHelperUserCandidateProvider(helperUsersFixture)
const result = runBundleWorkflow({
  initialRequest,
  tasks: decomposition.tasks,
  initialEvents: decomposition.events,
  candidateProfiles: helperUserCandidates.createCandidateProfiles(decomposition.tasks),
  seed: 'retry-path-v1',
  hooks,
  tools: { findCandidatesForBundle: helperUserCandidates.findCandidatesForBundle }
})

console.log(
  JSON.stringify(
    {
      requestId: decomposition.requestId,
      summary: decomposition.summary,
      bundles: result.bundles,
      assignmentResults: result.assignmentResults,
      finalResult: result.finalResult
    },
    null,
    2
  )
)
