import { describe, expect, it } from 'vitest'

import {
  appendNormalizedEvent,
  createNormalizedEventBuffer
} from '../src/normalized-event-buffer.js'
import { createAgentEvent } from './fixtures.js'

describe('normalized event buffer', () => {
  it('sorts out-of-order events by sequence and closes detected gaps', () => {
    const initial = createNormalizedEventBuffer({ runId: 'run_demo' })
    const withFirst = appendNormalizedEvent(initial, createAgentEvent(1))
    const withGap = appendNormalizedEvent(withFirst, createAgentEvent(3))

    expect(withGap.items.map(({ sequence }) => sequence)).toEqual([1, 3])
    expect(withGap.gaps).toEqual([{ from: 2, to: 2 }])
    expect(withGap.resumeAfterSequence).toBe(1)

    const complete = appendNormalizedEvent(withGap, createAgentEvent(2))

    expect(complete.items.map(({ sequence }) => sequence)).toEqual([1, 2, 3])
    expect(complete.gaps).toEqual([])
    expect(complete.resumeAfterSequence).toBe(3)
  })

  it('deduplicates a replayed event without mutating the previous state', () => {
    const event = createAgentEvent(1)
    const initial = createNormalizedEventBuffer({ runId: 'run_demo' })
    const once = appendNormalizedEvent(initial, event)
    const twice = appendNormalizedEvent(once, event)

    expect(initial.items).toEqual([])
    expect(twice).toBe(once)
    expect(twice.items).toHaveLength(1)
    expect(twice.issues).toEqual([])
  })

  it('isolates conflicting sequence and event identifiers', () => {
    const first = appendNormalizedEvent(
      createNormalizedEventBuffer({ runId: 'run_demo' }),
      createAgentEvent(1)
    )
    const sequenceConflict = appendNormalizedEvent(
      first,
      createAgentEvent(1, { eventId: 'another_event' })
    )
    const identifierConflict = appendNormalizedEvent(
      sequenceConflict,
      createAgentEvent(2, { eventId: 'event_1' })
    )

    expect(identifierConflict.items).toHaveLength(1)
    expect(identifierConflict.issues.map(({ code }) => code)).toEqual([
      'sequence_conflict',
      'event_id_conflict'
    ])
  })

  it('isolates a replay whose identifiers match but payload changed', () => {
    const first = appendNormalizedEvent(
      createNormalizedEventBuffer({ runId: 'run_demo' }),
      createAgentEvent(1)
    )
    const changed = appendNormalizedEvent(first, createAgentEvent(1, { message: '변경됨' }))

    expect(changed.items).toHaveLength(1)
    expect(changed.issues.map(({ code }) => code)).toEqual(['duplicate_conflict'])
  })

  it('keeps an unknown future event visible without crashing the consumer', () => {
    const unknown = {
      ...createAgentEvent(1),
      taskId: 'task_demo',
      type: 'future.policy.explained',
      data: { explanation: '<script>not executable</script>' }
    }

    const state = appendNormalizedEvent(createNormalizedEventBuffer({ runId: 'run_demo' }), unknown)

    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({
      kind: 'unknown',
      sequence: 1,
      taskId: 'task_demo',
      type: 'future.policy.explained'
    })
    expect(state.issues).toEqual([])
  })

  it('rejects malformed known events and events from another run', () => {
    const initial = createNormalizedEventBuffer({ runId: 'run_demo' })
    const malformed = appendNormalizedEvent(initial, {
      ...createAgentEvent(1),
      data: { revision: 2 }
    })
    const mixedRun = appendNormalizedEvent(malformed, createAgentEvent(2, { runId: 'another_run' }))

    expect(mixedRun.items).toEqual([])
    expect(mixedRun.issues.map(({ code }) => code)).toEqual(['invalid_event', 'run_mismatch'])
  })

  it('rejects a malformed unknown envelope', () => {
    const state = appendNormalizedEvent(createNormalizedEventBuffer(), {
      ...createAgentEvent(1),
      type: 'future.event',
      sequence: 0
    })

    expect(state.items).toEqual([])
    expect(state.issues[0]?.code).toBe('invalid_event')
  })

  it('resumes from an existing contiguous sequence', () => {
    const state = appendNormalizedEvent(
      createNormalizedEventBuffer({ runId: 'run_demo', afterSequence: 7 }),
      createAgentEvent(8)
    )

    expect(state.resumeAfterSequence).toBe(8)
    expect(state.gaps).toEqual([])
  })
})
