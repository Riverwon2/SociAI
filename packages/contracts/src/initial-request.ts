import { z } from 'zod'

import {
  ActivityRegionSchema,
  RequestIdSchema,
  SchemaVersionSchema,
  TimeWindowSchema
} from './shared.js'

export const TimeFlexibilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed') }).strict(),
  z
    .object({
      kind: z.literal('flexible'),
      maxShiftMinutes: z.number().int().positive().max(1_440).optional()
    })
    .strict()
])

export const CostChoiceSchema = z.literal('none')
export const PaymentMethodSchema = z.literal('not_applicable')

export const CostPolicySchema = z
  .object({
    choice: CostChoiceSchema,
    paymentMethod: PaymentMethodSchema
  })
  .strict()

export const FallbackPolicySchema = z
  .object({
    allowTimeAdjustment: z.boolean(),
    allowPartialCompletion: z.boolean(),
    allowScopeReduction: z.boolean()
  })
  .strict()

export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const InitialRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    requestId: RequestIdSchema,
    helpDescription: z.string().trim().min(1).max(2_000),
    timeWindow: TimeWindowSchema,
    maxActivityDurationMinutes: z.number().int().min(1).max(30),
    timeFlexibility: TimeFlexibilitySchema,
    activityRegion: ActivityRegionSchema,
    costPolicy: CostPolicySchema,
    fallbackPolicy: FallbackPolicySchema,
    optionalNotes: z.string().trim().min(1).max(2_000).optional()
  })
  .strict()
  .superRefine(({ timeWindow, timeFlexibility, fallbackPolicy }, context) => {
    if (timeWindow.startAt.slice(0, 10) !== timeWindow.endAt.slice(0, 10)) {
      context.addIssue({
        code: 'custom',
        message: 'The initial request time window must stay within one local calendar day',
        path: ['timeWindow', 'endAt']
      })
    }

    if (timeFlexibility.kind === 'fixed' && fallbackPolicy.allowTimeAdjustment) {
      context.addIssue({
        code: 'custom',
        message: 'A fixed time window cannot allow time adjustment fallback',
        path: ['fallbackPolicy', 'allowTimeAdjustment']
      })
    }
  })

export function createInitialRequestSchemaForDate(localDate: string) {
  const expectedDate = LocalDateSchema.parse(localDate)

  return InitialRequestSchema.refine(
    ({ timeWindow }) => timeWindow.startAt.slice(0, 10) === expectedDate,
    {
      message: 'The initial request must be scheduled for the current local date',
      path: ['timeWindow', 'startAt']
    }
  )
}

export type TimeFlexibility = z.infer<typeof TimeFlexibilitySchema>
export type CostChoice = z.infer<typeof CostChoiceSchema>
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>
export type CostPolicy = z.infer<typeof CostPolicySchema>
export type FallbackPolicy = z.infer<typeof FallbackPolicySchema>
export type InitialRequest = z.infer<typeof InitialRequestSchema>
