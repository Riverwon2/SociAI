import { RunAcceptedResponseSchema } from '@30-minute-exchange/contracts'
import {
  appendNormalizedEvent,
  createNormalizedEventBuffer,
  type ConsumableAgentEvent
} from '@30-minute-exchange/event-stream'

import { createInitialRunState, runReducer, type RunState } from '../state/run-state.js'
import type { LiveRunIdentity } from './live-run-session.js'

export const LIVE_RUN_CHECKPOINT_KEY = 'sociai.live-run-checkpoint.v2'

export interface LiveRunCheckpoint {
  readonly schemaVersion: 2
  readonly identity: LiveRunIdentity
  readonly agentAfterSequence: number
  readonly rawAfterSequence: number
  readonly normalizedEvents: readonly unknown[]
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface LiveRunCheckpointStore {
  read(): LiveRunCheckpoint | null
  write(checkpoint: LiveRunCheckpoint): boolean
  clear(): void
}

export function createLiveRunCheckpointStore(storage: StorageLike): LiveRunCheckpointStore {
  return {
    read() {
      try {
        const value = storage.getItem(LIVE_RUN_CHECKPOINT_KEY)
        return value === null ? null : parseCheckpoint(JSON.parse(value) as unknown)
      } catch {
        return null
      }
    },
    write(checkpoint) {
      try {
        storage.setItem(LIVE_RUN_CHECKPOINT_KEY, JSON.stringify(checkpoint))
        return true
      } catch {
        return false
      }
    },
    clear() {
      try {
        storage.removeItem(LIVE_RUN_CHECKPOINT_KEY)
      } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
      }
    }
  }
}

export function checkpointFromRunState(state: RunState): LiveRunCheckpoint | null {
  if (
    state.mode !== 'live' ||
    state.normalized.runId === null ||
    state.requestId === null ||
    state.liveStreamUrls === null
  ) {
    return null
  }
  return {
    schemaVersion: 2,
    identity: {
      runId: state.normalized.runId,
      requestId: state.requestId,
      ...state.liveStreamUrls
    },
    agentAfterSequence: state.normalized.resumeAfterSequence,
    rawAfterSequence: state.raw.resumeAfterSequence,
    normalizedEvents: state.normalized.items.map(toStorableEvent)
  }
}

export function restoreLiveRunState(checkpoint: LiveRunCheckpoint): RunState {
  let state = runReducer(createInitialRunState(), {
    type: 'run.started',
    mode: 'live',
    runId: checkpoint.identity.runId,
    requestId: checkpoint.identity.requestId,
    liveStreamUrls: {
      agentEventsUrl: checkpoint.identity.agentEventsUrl,
      rawToolEventsUrl: checkpoint.identity.rawToolEventsUrl
    },
    scenario: null,
    afterSequence: {
      agent: checkpoint.agentAfterSequence,
      raw: checkpoint.rawAfterSequence
    }
  })
  for (const event of checkpoint.normalizedEvents) {
    state = runReducer(state, { type: 'agent.received', value: event })
  }
  return state.result === null ? { ...state, connectionStatus: 'connecting' } : state
}

function parseCheckpoint(value: unknown): LiveRunCheckpoint | null {
  const record = asRecord(value)
  if (record === null || record.schemaVersion !== 2) return null
  const identity = asRecord(record.identity)
  if (identity === null) return null
  const accepted = RunAcceptedResponseSchema.safeParse({
    schemaVersion: 2,
    status: 'accepted',
    runId: identity.runId,
    requestId: identity.requestId,
    agentEventsUrl: identity.agentEventsUrl,
    rawToolEventsUrl: identity.rawToolEventsUrl
  })
  if (!accepted.success) return null
  if (!isSequence(record.agentAfterSequence) || !isSequence(record.rawAfterSequence)) return null
  if (!Array.isArray(record.normalizedEvents)) return null

  let buffer = createNormalizedEventBuffer({ runId: accepted.data.runId })
  for (const event of record.normalizedEvents) buffer = appendNormalizedEvent(buffer, event)
  if (
    buffer.issues.length > 0 ||
    buffer.resumeAfterSequence !== record.agentAfterSequence ||
    buffer.items.some((item) => item.requestId !== accepted.data.requestId)
  ) {
    return null
  }

  return {
    schemaVersion: 2,
    identity: {
      runId: accepted.data.runId,
      requestId: accepted.data.requestId,
      agentEventsUrl: accepted.data.agentEventsUrl,
      rawToolEventsUrl: accepted.data.rawToolEventsUrl
    },
    agentAfterSequence: record.agentAfterSequence,
    rawAfterSequence: record.rawAfterSequence,
    normalizedEvents: record.normalizedEvents
  }
}

function toStorableEvent(item: ConsumableAgentEvent): unknown {
  if (item.kind === 'known') return item.event
  return {
    schemaVersion: item.schemaVersion,
    eventId: item.eventId,
    runId: item.runId,
    requestId: item.requestId,
    ...(item.taskId === undefined ? {} : { taskId: item.taskId }),
    sequence: item.sequence,
    occurredAt: item.occurredAt,
    type: item.type,
    message: item.message,
    isSimulation: item.isSimulation,
    data: item.data
  }
}

function isSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
