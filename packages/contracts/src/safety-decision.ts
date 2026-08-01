import { z } from 'zod'

import { RequestIdSchema, RunIdSchema, SchemaVersionSchema, TaskIdSchema } from './shared.js'

export const SafetyLevelSchema = z.enum(['low', 'conditional', 'high', 'emergency'])
export const SafetyActionSchema = z.enum([
  'proceed',
  'verify_conditions',
  'block',
  'emergency_guidance'
])

export const SafetyDecisionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    taskId: TaskIdSchema,
    level: SafetyLevelSchema,
    action: SafetyActionSchema,
    reasonCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    conditions: z.array(z.string().trim().min(1).max(300)).max(20),
    guidance: z.string().trim().min(1).max(1_000).optional()
  })
  .strict()
  .superRefine(({ level, action }, context) => {
    const allowedActions: Record<z.infer<typeof SafetyLevelSchema>, readonly string[]> = {
      low: ['proceed'],
      conditional: ['verify_conditions'],
      high: ['block'],
      emergency: ['emergency_guidance']
    }

    if (!allowedActions[level].includes(action)) {
      context.addIssue({
        code: 'custom',
        message: `Safety action ${action} is not valid for level ${level}`,
        path: ['action']
      })
    }
  })

export type SafetyLevel = z.infer<typeof SafetyLevelSchema>
export type SafetyAction = z.infer<typeof SafetyActionSchema>
export type SafetyDecision = z.infer<typeof SafetyDecisionSchema>
