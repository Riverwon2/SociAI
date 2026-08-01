import { z } from 'zod'

export const SCHEMA_VERSION = 2 as const

export const SchemaVersionSchema = z.literal(SCHEMA_VERSION)

export const IdentifierSchema = z.string().trim().min(1).max(128)
export const RunIdSchema = IdentifierSchema
export const RequestIdSchema = IdentifierSchema
export const TaskIdSchema = IdentifierSchema
export const CandidateIdSchema = IdentifierSchema
export const ToolCallIdSchema = IdentifierSchema
export const EventIdSchema = IdentifierSchema

export const IsoDateTimeSchema = z.string().datetime({ offset: true })

export const TimeWindowSchema = z
  .object({
    startAt: IsoDateTimeSchema,
    endAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine(({ startAt, endAt }, context) => {
    if (Date.parse(endAt) <= Date.parse(startAt)) {
      context.addIssue({
        code: 'custom',
        message: 'endAt must be after startAt',
        path: ['endAt']
      })
    }
  })

export const GeoPointSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180)
  })
  .strict()

export const ActivityRegionSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    approximateLocation: z.string().trim().min(1).max(200),
    regionCode: z.string().trim().min(1).max(32).optional(),
    center: GeoPointSchema.optional()
  })
  .strict()

export const MissingInformationSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    field: z.string().trim().min(1).max(100).optional(),
    message: z.string().trim().min(1).max(500)
  })
  .strict()

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
)

export type TimeWindow = z.infer<typeof TimeWindowSchema>
export type ActivityRegion = z.infer<typeof ActivityRegionSchema>
export type MissingInformation = z.infer<typeof MissingInformationSchema>
