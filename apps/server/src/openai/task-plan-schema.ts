import { TaskSchema } from '@30-minute-exchange/contracts'
import { z } from 'zod'

export const TaskPlanOutputSchema = z
  .object({
    tasks: z.array(TaskSchema).min(1).max(10),
    summary: z.string().trim().min(1).max(1_000)
  })
  .strict()

export type TaskPlanOutput = z.infer<typeof TaskPlanOutputSchema>
