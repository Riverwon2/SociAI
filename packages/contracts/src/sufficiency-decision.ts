import { z } from 'zod'

import {
  JsonValueSchema,
  MissingInformationSchema,
  RequestIdSchema,
  RunIdSchema,
  SchemaVersionSchema,
  TaskIdSchema
} from './shared.js'

export const AvailableFactSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    value: JsonValueSchema,
    source: z.enum(['initial_request', 'tool_result', 'scenario_fixture'])
  })
  .strict()

export const SufficiencyStatusSchema = z.enum(['sufficient', 'insufficient'])
export const SufficiencyActionSchema = z.enum(['proceed', 'hold'])

export const SufficiencyDecisionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    taskId: TaskIdSchema,
    status: SufficiencyStatusSchema,
    action: SufficiencyActionSchema,
    reasonCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    missingInformation: z.array(MissingInformationSchema).max(20),
    guidance: z.string().trim().min(1).max(1_000).optional()
  })
  .strict()
  .superRefine(({ status, action, missingInformation }, context) => {
    if (status === 'sufficient') {
      if (action !== 'proceed') {
        context.addIssue({
          code: 'custom',
          message: 'A sufficient task must proceed',
          path: ['action']
        })
      }
      if (missingInformation.length > 0) {
        context.addIssue({
          code: 'custom',
          message: 'A sufficient task cannot contain missing information',
          path: ['missingInformation']
        })
      }
    }

    if (status === 'insufficient') {
      if (action !== 'hold') {
        context.addIssue({
          code: 'custom',
          message: 'An insufficient task must be held',
          path: ['action']
        })
      }
      if (missingInformation.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'An insufficient task must identify missing information',
          path: ['missingInformation']
        })
      }
    }
  })

export type SufficiencyStatus = z.infer<typeof SufficiencyStatusSchema>
export type SufficiencyAction = z.infer<typeof SufficiencyActionSchema>
export type AvailableFact = z.infer<typeof AvailableFactSchema>
export type SufficiencyDecision = z.infer<typeof SufficiencyDecisionSchema>
