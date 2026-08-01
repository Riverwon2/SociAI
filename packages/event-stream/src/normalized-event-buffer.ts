import {
  AgentEventSchema,
  AgentEventTypeSchema,
  EventIdSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  RequestIdSchema,
  RunIdSchema,
  SchemaVersionSchema,
  TaskIdSchema,
  type AgentEvent,
  type JsonValue
} from '@30-minute-exchange/contracts'

export type NormalizedEventIssueCode =
  | 'invalid_event'
  | 'run_mismatch'
  | 'sequence_conflict'
  | 'event_id_conflict'
  | 'duplicate_conflict'

export interface NormalizedEventIssue {
  readonly code: NormalizedEventIssueCode
  readonly message: string
  readonly value: unknown
}

export interface SequenceGap {
  readonly from: number
  readonly to: number
}

interface ConsumableEventEnvelope {
  readonly eventId: string
  readonly runId: string
  readonly requestId: string
  readonly sequence: number
  readonly occurredAt: string
  readonly type: string
  readonly message: string
  readonly isSimulation: boolean
}

export interface KnownAgentEventItem extends ConsumableEventEnvelope {
  readonly kind: 'known'
  readonly event: AgentEvent
}

export interface UnknownAgentEventItem extends ConsumableEventEnvelope {
  readonly kind: 'unknown'
  readonly schemaVersion: 2
  readonly taskId?: string
  readonly data: JsonValue
}

export type ConsumableAgentEvent = KnownAgentEventItem | UnknownAgentEventItem

export interface NormalizedEventBuffer {
  readonly runId: string | null
  readonly afterSequence: number
  readonly resumeAfterSequence: number
  readonly latestSequence: number
  readonly items: readonly ConsumableAgentEvent[]
  readonly gaps: readonly SequenceGap[]
  readonly issues: readonly NormalizedEventIssue[]
}

export interface CreateNormalizedEventBufferOptions {
  readonly runId?: string
  readonly afterSequence?: number
}

export function createNormalizedEventBuffer(
  options: CreateNormalizedEventBufferOptions = {}
): NormalizedEventBuffer {
  const afterSequence = normalizeAfterSequence(options.afterSequence)

  return {
    runId: options.runId ?? null,
    afterSequence,
    resumeAfterSequence: afterSequence,
    latestSequence: afterSequence,
    items: [],
    gaps: [],
    issues: []
  }
}

export function appendNormalizedEvent(
  state: NormalizedEventBuffer,
  value: unknown
): NormalizedEventBuffer {
  const parsed = parseConsumableEvent(value)
  if (parsed === null)
    return appendIssue(state, 'invalid_event', 'Event contract validation failed', value)

  if (state.runId !== null && parsed.runId !== state.runId) {
    return appendIssue(state, 'run_mismatch', 'Event belongs to another run', value)
  }

  const sameSequence = state.items.find(({ sequence }) => sequence === parsed.sequence)
  const sameEventId = state.items.find(({ eventId }) => eventId === parsed.eventId)
  if (sameSequence === undefined && sameEventId === undefined) return insertEvent(state, parsed)
  if (sameSequence === sameEventId && isSameValue(sameSequence, parsed)) return state
  if (sameSequence !== undefined && sameEventId === undefined) {
    return appendIssue(
      state,
      'sequence_conflict',
      'Sequence is already used by another event',
      value
    )
  }
  if (sameEventId !== undefined && sameSequence === undefined) {
    return appendIssue(
      state,
      'event_id_conflict',
      'Event id is already used at another sequence',
      value
    )
  }
  return appendIssue(state, 'duplicate_conflict', 'Replayed event changed its payload', value)
}

function parseConsumableEvent(value: unknown): ConsumableAgentEvent | null {
  const known = AgentEventSchema.safeParse(value)
  if (known.success) return toKnownItem(known.data)

  const record = asRecord(value)
  if (record === null || AgentEventTypeSchema.safeParse(record.type).success) return null

  const schemaVersion = SchemaVersionSchema.safeParse(record.schemaVersion)
  const eventId = EventIdSchema.safeParse(record.eventId)
  const runId = RunIdSchema.safeParse(record.runId)
  const requestId = RequestIdSchema.safeParse(record.requestId)
  const taskId = record.taskId === undefined ? null : TaskIdSchema.safeParse(record.taskId)
  const occurredAt = IsoDateTimeSchema.safeParse(record.occurredAt)
  const data = JsonValueSchema.safeParse(record.data)

  if (
    !schemaVersion.success ||
    !eventId.success ||
    !runId.success ||
    !requestId.success ||
    (taskId !== null && !taskId.success) ||
    !Number.isInteger(record.sequence) ||
    typeof record.sequence !== 'number' ||
    record.sequence <= 0 ||
    !occurredAt.success ||
    typeof record.type !== 'string' ||
    record.type.trim().length === 0 ||
    typeof record.message !== 'string' ||
    record.message.trim().length === 0 ||
    typeof record.isSimulation !== 'boolean' ||
    !data.success
  ) {
    return null
  }

  return {
    kind: 'unknown',
    schemaVersion: schemaVersion.data,
    eventId: eventId.data,
    runId: runId.data,
    requestId: requestId.data,
    ...(taskId === null ? {} : { taskId: taskId.data }),
    sequence: record.sequence,
    occurredAt: occurredAt.data,
    type: record.type,
    message: record.message,
    isSimulation: record.isSimulation,
    data: data.data
  }
}

function toKnownItem(event: AgentEvent): KnownAgentEventItem {
  return {
    kind: 'known',
    eventId: event.eventId,
    runId: event.runId,
    requestId: event.requestId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    type: event.type,
    message: event.message,
    isSimulation: event.isSimulation,
    event
  }
}

function insertEvent(
  state: NormalizedEventBuffer,
  event: ConsumableAgentEvent
): NormalizedEventBuffer {
  const items = [...state.items, event].sort((left, right) => left.sequence - right.sequence)
  const resumeAfterSequence = findResumeSequence(items, state.afterSequence)

  return {
    ...state,
    runId: state.runId ?? event.runId,
    resumeAfterSequence,
    latestSequence: Math.max(state.latestSequence, event.sequence),
    items,
    gaps: findSequenceGaps(items, state.afterSequence)
  }
}

function findResumeSequence(items: readonly ConsumableAgentEvent[], afterSequence: number): number {
  let contiguous = afterSequence
  for (const { sequence } of items) {
    if (sequence <= contiguous) continue
    if (sequence !== contiguous + 1) break
    contiguous = sequence
  }
  return contiguous
}

function findSequenceGaps(
  items: readonly ConsumableAgentEvent[],
  afterSequence: number
): SequenceGap[] {
  const gaps: SequenceGap[] = []
  let expected = afterSequence + 1
  for (const { sequence } of items) {
    if (sequence < expected) continue
    if (sequence > expected) gaps.push({ from: expected, to: sequence - 1 })
    expected = sequence + 1
  }
  return gaps
}

function appendIssue(
  state: NormalizedEventBuffer,
  code: NormalizedEventIssueCode,
  message: string,
  value: unknown
): NormalizedEventBuffer {
  return { ...state, issues: [...state.issues, { code, message, value }] }
}

function normalizeAfterSequence(value: number | undefined): number {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
