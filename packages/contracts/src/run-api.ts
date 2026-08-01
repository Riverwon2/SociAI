import { z } from 'zod'

import { RequestIdSchema, RunIdSchema, SchemaVersionSchema } from './shared.js'

export const RunAcceptedResponseSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    status: z.literal('accepted'),
    agentEventsUrl: z.string().trim().min(1).max(2048),
    rawToolEventsUrl: z.string().trim().min(1).max(2048)
  })
  .strict()
  .superRefine(({ runId, agentEventsUrl, rawToolEventsUrl }, context) => {
    const encodedRunId = encodeURIComponent(runId)
    const expectedAgentUrl = `/api/runs/${encodedRunId}/events`
    const expectedRawUrl = `/api/runs/${encodedRunId}/raw-events`

    if (agentEventsUrl !== expectedAgentUrl) {
      context.addIssue({
        code: 'custom',
        message: `agentEventsUrl must be ${expectedAgentUrl}`,
        path: ['agentEventsUrl']
      })
    }
    if (rawToolEventsUrl !== expectedRawUrl) {
      context.addIssue({
        code: 'custom',
        message: `rawToolEventsUrl must be ${expectedRawUrl}`,
        path: ['rawToolEventsUrl']
      })
    }
  })

export type RunAcceptedResponse = z.infer<typeof RunAcceptedResponseSchema>
