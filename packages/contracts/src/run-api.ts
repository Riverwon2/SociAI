import { z } from 'zod'

import { RequestIdSchema, RunIdSchema, SchemaVersionSchema } from './shared.js'

export const RunAcceptedResponseSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    status: z.literal('accepted'),
    agentEventsUrl: z.string().trim().min(1).max(2_048),
    rawToolEventsUrl: z.string().trim().min(1).max(2_048)
  })
  .strict()
  .superRefine(({ runId, agentEventsUrl, rawToolEventsUrl }, context) => {
    const encodedRunId = encodeURIComponent(runId)
    const expectedAgentEventsUrl = `/api/runs/${encodedRunId}/events`
    const expectedRawToolEventsUrl = `/api/runs/${encodedRunId}/raw-events`

    if (agentEventsUrl !== expectedAgentEventsUrl) {
      context.addIssue({
        code: 'custom',
        message: `agentEventsUrl must be ${expectedAgentEventsUrl}`,
        path: ['agentEventsUrl']
      })
    }
    if (rawToolEventsUrl !== expectedRawToolEventsUrl) {
      context.addIssue({
        code: 'custom',
        message: `rawToolEventsUrl must be ${expectedRawToolEventsUrl}`,
        path: ['rawToolEventsUrl']
      })
    }
  })

export type RunAcceptedResponse = z.infer<typeof RunAcceptedResponseSchema>
