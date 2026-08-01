import { z } from 'zod'

import {
  ActivityRegionSchema,
  MissingInformationSchema,
  RequestIdSchema,
  RunIdSchema,
  SchemaVersionSchema,
  TaskIdSchema,
  TimeWindowSchema
} from './shared.js'

export const TaskStatusSchema = z.enum([
  'created',
  'safety_checking',
  'held',
  'ready',
  'candidate_searching',
  'awaiting_response',
  'matched',
  'blocked',
  'unmatched',
  'failed'
])

export const TaskDurationSourceSchema = z.enum(['explicit', 'llm_estimated'])
export const TaskTimeSourceSchema = z.enum(['explicit', 'inherited_request_window'])
export const TaskTimeCertaintySchema = z.enum(['fixed', 'flexible'])

export const TaskSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    requestId: RequestIdSchema,
    taskId: TaskIdSchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000),
    timeWindow: TimeWindowSchema,
    region: ActivityRegionSchema,
    requiredExperience: z.array(z.string().trim().min(1).max(100)).max(20),
    estimatedDurationMinutes: z.number().int().min(1).max(30),
    durationSource: TaskDurationSourceSchema.optional(),
    timeSource: TaskTimeSourceSchema.optional(),
    timeCertainty: TaskTimeCertaintySchema.optional(),
    status: TaskStatusSchema,
    missingInformation: z.array(MissingInformationSchema).max(20)
  })
  .strict()
  .superRefine(
    ({ durationSource, estimatedDurationMinutes, timeCertainty, timeSource }, context) => {
      if (durationSource === 'llm_estimated' && estimatedDurationMinutes > 20) {
        context.addIssue({
          code: 'custom',
          message: 'An LLM-estimated task duration must not exceed 20 minutes',
          path: ['estimatedDurationMinutes']
        })
      }

      if (timeSource === 'inherited_request_window' && timeCertainty === 'fixed') {
        context.addIssue({
          code: 'custom',
          message: 'A task inheriting the request window must be flexible',
          path: ['timeCertainty']
        })
      }
    }
  )

export type TaskStatus = z.infer<typeof TaskStatusSchema>
export type TaskDurationSource = z.infer<typeof TaskDurationSourceSchema>
export type TaskTimeSource = z.infer<typeof TaskTimeSourceSchema>
export type TaskTimeCertainty = z.infer<typeof TaskTimeCertaintySchema>
export type Task = z.infer<typeof TaskSchema>
