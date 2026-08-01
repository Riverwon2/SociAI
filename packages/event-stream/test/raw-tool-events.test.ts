import { describe, expect, it } from 'vitest'

import { correlateRawToolEvents } from '../src/event-correlation.js'
import { appendRawToolEvent, createRawToolEventBuffer } from '../src/raw-event-buffer.js'
import { createRawToolEvent } from './fixtures.js'

describe('raw tool event buffer', () => {
  it('validates, sorts, and preserves the provider payload', () => {
    const rawPayload = {
      type: 'response.function_call_arguments.done',
      item_id: 'item_001',
      arguments: '{"taskId":"task_demo"}',
      nested: { untouched: ['one', 2, false, null] }
    }
    const event = createRawToolEvent(2, 'tool_result', { raw: rawPayload })
    const inputSnapshot = structuredClone(event)
    const withSecond = appendRawToolEvent(createRawToolEventBuffer({ runId: 'run_demo' }), event)
    const state = appendRawToolEvent(withSecond, createRawToolEvent(1, 'tool_call'))

    expect(state.items.map(({ sequence }) => sequence)).toEqual([1, 2])
    expect(state.items[1]?.raw).toEqual(rawPayload)
    expect(event).toEqual(inputSnapshot)
  })

  it('deduplicates replay and isolates malformed or mixed-run events', () => {
    const event = createRawToolEvent(1, 'tool_call')
    const once = appendRawToolEvent(createRawToolEventBuffer({ runId: 'run_demo' }), event)
    const replayed = appendRawToolEvent(once, event)
    const malformed = appendRawToolEvent(replayed, { ...event, provider: 'another-provider' })
    const mixed = appendRawToolEvent(
      malformed,
      createRawToolEvent(2, 'tool_result', { runId: 'another_run' })
    )

    expect(replayed).toBe(once)
    expect(mixed.items).toHaveLength(1)
    expect(mixed.issues.map(({ code }) => code)).toEqual(['invalid_event', 'run_mismatch'])
  })

  it('isolates sequence, event id, and changed replay conflicts', () => {
    const event = createRawToolEvent(1, 'tool_call')
    const first = appendRawToolEvent(createRawToolEventBuffer(), event)
    const sequenceConflict = appendRawToolEvent(
      first,
      createRawToolEvent(1, 'tool_call', { eventId: 'another_event' })
    )
    const eventIdConflict = appendRawToolEvent(
      sequenceConflict,
      createRawToolEvent(2, 'tool_result', { eventId: event.eventId })
    )
    const changedReplay = appendRawToolEvent(eventIdConflict, {
      ...event,
      raw: { changed: true }
    })

    expect(changedReplay.items).toHaveLength(1)
    expect(changedReplay.issues.map(({ code }) => code)).toEqual([
      'sequence_conflict',
      'event_id_conflict',
      'duplicate_conflict'
    ])
  })

  it('tracks contiguous resume sequence and gaps independently from normalized events', () => {
    const withGap = appendRawToolEvent(
      createRawToolEventBuffer({ runId: 'run_demo', afterSequence: 2 }),
      createRawToolEvent(4, 'tool_result')
    )
    const complete = appendRawToolEvent(withGap, createRawToolEvent(3, 'tool_call'))

    expect(withGap.gaps).toEqual([{ from: 3, to: 3 }])
    expect(withGap.resumeAfterSequence).toBe(2)
    expect(complete.gaps).toEqual([])
    expect(complete.resumeAfterSequence).toBe(4)
  })
})

describe('raw tool event correlation', () => {
  it('groups call and result events by toolCallId in sequence order', () => {
    const events = [
      createRawToolEvent(4, 'tool_result', { toolCallId: 'complete' }),
      createRawToolEvent(1, 'tool_result', { toolCallId: 'orphan' }),
      createRawToolEvent(3, 'tool_call', { toolCallId: 'complete' }),
      createRawToolEvent(2, 'tool_call', { toolCallId: 'waiting' })
    ]

    const correlations = correlateRawToolEvents(events)

    expect(correlations.map(({ toolCallId, status }) => ({ toolCallId, status }))).toEqual([
      { toolCallId: 'orphan', status: 'orphan_result' },
      { toolCallId: 'waiting', status: 'waiting_for_result' },
      { toolCallId: 'complete', status: 'complete' }
    ])
    expect(correlations[2]?.callEvents.map(({ sequence }) => sequence)).toEqual([3])
    expect(correlations[2]?.resultEvents.map(({ sequence }) => sequence)).toEqual([4])
  })
})
