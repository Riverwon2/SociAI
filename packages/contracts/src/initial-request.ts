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

export const CostChoiceSchema = z.enum(['none', 'required', 'unknown'])
export const PaymentMethodSchema = z.enum([
  'requester_prepaid',
  'requester_online',
  'requester_on_site',
  'undecided'
])

export const CostPolicySchema = z
  .object({
    choice: CostChoiceSchema,
    paymentMethod: PaymentMethodSchema.optional()
  })
  .strict()
  .superRefine(({ choice, paymentMethod }, context) => {
    if (choice === 'none' && paymentMethod !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'paymentMethod must be omitted when no cost is expected',
        path: ['paymentMethod']
      })
    }

    if (choice === 'required' && paymentMethod === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'paymentMethod is required when a cost is expected',
        path: ['paymentMethod']
      })
    }
  })

export const FallbackPolicySchema = z
  .object({
    allowTimeAdjustment: z.boolean(),
    allowPartialCompletion: z.boolean(),
    allowScopeReduction: z.boolean()
  })
  .strict()

export const InitialRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    requestId: RequestIdSchema,
    helpDescription: z.string().trim().min(1).max(2_000),
    timeWindow: TimeWindowSchema,
    timeFlexibility: TimeFlexibilitySchema,
    activityRegion: ActivityRegionSchema,
    costPolicy: CostPolicySchema,
    fallbackPolicy: FallbackPolicySchema,
    optionalNotes: z.string().trim().min(1).max(2_000).optional()
  })
  .strict()
  .superRefine(({ timeFlexibility, fallbackPolicy }, context) => {
    if (timeFlexibility.kind === 'fixed' && fallbackPolicy.allowTimeAdjustment) {
      context.addIssue({
        code: 'custom',
        message: 'A fixed time window cannot allow time adjustment fallback',
        path: ['fallbackPolicy', 'allowTimeAdjustment']
      })
    }
  })

export type TimeFlexibility = z.infer<typeof TimeFlexibilitySchema>
export type CostChoice = z.infer<typeof CostChoiceSchema>
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>
export type CostPolicy = z.infer<typeof CostPolicySchema>
export type FallbackPolicy = z.infer<typeof FallbackPolicySchema>
export type InitialRequest = z.infer<typeof InitialRequestSchema>
