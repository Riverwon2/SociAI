import { RawToolEventSchema, type RawToolEvent } from '@30-minute-exchange/contracts'

import type { SequenceGap } from './normalized-event-buffer.js'

export type RawEventIssueCode =
  | 'invalid_event'
  | 'run_mismatch'
  | 'sequence_conflict'
  | 'event_id_conflict'
  | 'duplicate_conflict'

export interface RawEventIssue {
  readonly code: RawEventIssueCode
  readonly message: string
  readonly value: unknown
}

export interface RawToolEventBuffer {
  readonly runId: string | null
  readonly afterSequence: number
  readonly resumeAfterSequence: number
  readonly latestSequence: number
  readonly items: readonly RawToolEvent[]
  readonly gaps: readonly SequenceGap[]
  readonly issues: readonly RawEventIssue[]
}

export interface CreateRawToolEventBufferOptions {
  readonly runId?: string
  readonly afterSequence?: number
}

export function createRawToolEventBuffer(
  options: CreateRawToolEventBufferOptions = {}
): RawToolEventBuffer {
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

export function appendRawToolEvent(state: RawToolEventBuffer, value: unknown): RawToolEventBuffer {
  const parsed = RawToolEventSchema.safeParse(value)
  if (!parsed.success)
    return appendIssue(state, 'invalid_event', 'Raw event validation failed', value)

  const event = parsed.data
  if (state.runId !== null && event.runId !== state.runId) {
    return appendIssue(state, 'run_mismatch', 'Raw event belongs to another run', value)
  }

  const sameSequence = state.items.find(({ sequence }) => sequence === event.sequence)
  const sameEventId = state.items.find(({ eventId }) => eventId === event.eventId)
  if (sameSequence === undefined && sameEventId === undefined) return insertEvent(state, event)
  if (sameSequence === sameEventId && isSameValue(sameSequence, event)) return state
  if (sameSequence !== undefined && sameEventId === undefined) {
    return appendIssue(
      state,
      'sequence_conflict',
      'Sequence is already used by another raw event',
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
  return appendIssue(state, 'duplicate_conflict', 'Replayed raw event changed its payload', value)
}

function insertEvent(state: RawToolEventBuffer, event: RawToolEvent): RawToolEventBuffer {
  const items = [...state.items, event].sort((left, right) => left.sequence - right.sequence)
  return {
    ...state,
    runId: state.runId ?? event.runId,
    resumeAfterSequence: findResumeSequence(items, state.afterSequence),
    latestSequence: Math.max(state.latestSequence, event.sequence),
    items,
    gaps: findSequenceGaps(items, state.afterSequence)
  }
}

function findResumeSequence(items: readonly RawToolEvent[], afterSequence: number): number {
  let contiguous = afterSequence
  for (const { sequence } of items) {
    if (sequence <= contiguous) continue
    if (sequence !== contiguous + 1) break
    contiguous = sequence
  }
  return contiguous
}

function findSequenceGaps(items: readonly RawToolEvent[], afterSequence: number): SequenceGap[] {
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
  state: RawToolEventBuffer,
  code: RawEventIssueCode,
  message: string,
  value: unknown
): RawToolEventBuffer {
  return { ...state, issues: [...state.issues, { code, message, value }] }
}

function normalizeAfterSequence(value: number | undefined): number {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : 0
}

function isSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
