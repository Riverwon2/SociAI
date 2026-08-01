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
    status: TaskStatusSchema,
    missingInformation: z.array(MissingInformationSchema).max(20)
  })
  .strict()

export type TaskStatus = z.infer<typeof TaskStatusSchema>
export type Task = z.infer<typeof TaskSchema>
