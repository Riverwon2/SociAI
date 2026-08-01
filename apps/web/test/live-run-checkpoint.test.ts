import { describe, expect, it } from 'vitest'
import type { RawToolEvent } from '@30-minute-exchange/contracts'

import { buildFixtureEvents } from '../src/demo/fixture-events.js'
import { getDemoScenario } from '../src/demo/scenarios.js'
import {
  checkpointFromRunState,
  createLiveRunCheckpointStore,
  LIVE_RUN_CHECKPOINT_KEY,
  restoreLiveRunState,
  type StorageLike
} from '../src/live/live-run-checkpoint.js'
import { createInitialRunState, deriveTaskViews, runReducer } from '../src/state/run-state.js'

describe('live run refresh checkpoint', () => {
  it('restores normalized history and independent resume sequences without storing raw payloads', () => {
    const fixture = getDemoScenario('first_candidate_accepts').fixture
    let state = runReducer(createInitialRunState(), {
      type: 'run.started',
      mode: 'live',
      runId: fixture.expectedFinalResult.runId,
      requestId: fixture.initialRequest.requestId,
      liveStreamUrls: streamUrls(fixture.expectedFinalResult.runId),
      scenario: null
    })
    for (const event of buildFixtureEvents(fixture).slice(0, 6)) {
      state = runReducer(state, { type: 'agent.received', value: event })
    }
    const raw = rawEvent(fixture.expectedFinalResult.runId, fixture.initialRequest.requestId)
    state = runReducer(state, { type: 'raw.received', value: raw })
    const checkpoint = checkpointFromRunState(state)
    if (checkpoint === null) throw new Error('Live state should produce a checkpoint')
    const storage = new MemoryStorage()
    const store = createLiveRunCheckpointStore(storage)

    expect(store.write(checkpoint)).toBe(true)
    expect(storage.value).not.toContain('provider-secret-must-not-persist')
    const read = store.read()
    expect(read).toEqual(checkpoint)
    if (read === null) throw new Error('Checkpoint should round-trip')

    const restored = restoreLiveRunState(read)
    expect(restored.normalized.resumeAfterSequence).toBe(6)
    expect(restored.raw.resumeAfterSequence).toBe(1)
    expect(restored.raw.items).toEqual([])
    expect(deriveTaskViews(restored.normalized)).toEqual(deriveTaskViews(state.normalized))
    expect(restored.connectionStatus).toBe('connecting')
  })

  it('rejects a corrupt or non-contiguous checkpoint', () => {
    const storage = new MemoryStorage()
    const store = createLiveRunCheckpointStore(storage)
    storage.value = JSON.stringify({
      schemaVersion: 2,
      identity: {
        runId: 'run_demo',
        requestId: 'request_demo',
        ...streamUrls('run_demo')
      },
      agentAfterSequence: 7,
      rawAfterSequence: 0,
      normalizedEvents: []
    })

    expect(store.read()).toBeNull()
    storage.value = '{not-json'
    expect(store.read()).toBeNull()
    store.clear()
    expect(storage.value).toBeNull()
  })

  it('fails closed when browser storage is unavailable', () => {
    const store = createLiveRunCheckpointStore({
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('denied')
      }
    })
    const checkpoint = {
      schemaVersion: 2,
      identity: {
        runId: 'run_demo',
        requestId: 'request_demo',
        ...streamUrls('run_demo')
      },
      agentAfterSequence: 0,
      rawAfterSequence: 0,
      normalizedEvents: []
    } as const

    expect(store.read()).toBeNull()
    expect(store.write(checkpoint)).toBe(false)
    expect(() => store.clear()).not.toThrow()
  })
})

class MemoryStorage implements StorageLike {
  value: string | null = null

  getItem(key: string) {
    return key === LIVE_RUN_CHECKPOINT_KEY ? this.value : null
  }

  setItem(key: string, value: string) {
    if (key === LIVE_RUN_CHECKPOINT_KEY) this.value = value
  }

  removeItem(key: string) {
    if (key === LIVE_RUN_CHECKPOINT_KEY) this.value = null
  }
}

function rawEvent(runId: string, requestId: string): RawToolEvent {
  return {
    schemaVersion: 2,
    eventId: 'raw_checkpoint_1',
    runId,
    requestId,
    toolCallId: 'call_checkpoint_1',
    sequence: 1,
    occurredAt: '2026-08-01T08:00:00.000Z',
    direction: 'tool_call',
    provider: 'openai',
    raw: { secret: 'provider-secret-must-not-persist' }
  }
}

function streamUrls(runId: string) {
  return {
    agentEventsUrl: `/api/runs/${runId}/events`,
    rawToolEventsUrl: `/api/runs/${runId}/raw-events`
  }
}

