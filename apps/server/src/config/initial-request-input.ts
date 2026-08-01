import { InitialRequestSchema, type InitialRequest } from '@30-minute-exchange/contracts'

type InputEnvironment = Readonly<Record<string, string | undefined>>

/** Parses a one-run request without persisting user input in a fixture or log. */
export function loadInitialRequestFromEnvironment(environment: InputEnvironment): InitialRequest {
  const serialized = environment.INITIAL_REQUEST_JSON?.trim()
  if (serialized === undefined || serialized.length === 0) {
    throw new Error('Missing required environment variable: INITIAL_REQUEST_JSON')
  }

  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error('INITIAL_REQUEST_JSON must contain valid JSON')
  }

  const result = InitialRequestSchema.safeParse(value)
  if (!result.success) {
    throw new Error('INITIAL_REQUEST_JSON failed InitialRequest contract validation')
  }
  return result.data
}
