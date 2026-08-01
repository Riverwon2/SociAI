import type { AgentEvent } from '@30-minute-exchange/contracts'

export type FixtureReplayDecision = 'accepted' | 'rejected' | 'timed_out'

const TAIL_TRACK = '__tail__'

export interface FixtureReplayTrack {
  readonly taskId: string
  readonly events: readonly AgentEvent[]
}

export interface FixtureReplayPlan {
  readonly prelude: readonly AgentEvent[]
  readonly tracks: readonly FixtureReplayTrack[]
  readonly tail: readonly AgentEvent[]
}

export interface FixtureReplayProgress {
  readonly preludeCursor: number
  readonly trackCursors: Readonly<Record<string, number>>
  readonly tailCursor: number
}

export interface FixtureReplayStep {
  readonly event: AgentEvent
  readonly progress: FixtureReplayProgress
}

export function decisionForEvent(event: AgentEvent | undefined): FixtureReplayDecision | null {
  if (event?.type === 'outreach.timed_out') return 'timed_out'
  if (event?.type !== 'neighbor.replied') return null
  return event.data.response === 'accepted' ? 'accepted' : 'rejected'
}

/**
 * Splits a fixture stream into a shared prelude, one queue per task that owns a
 * neighbour response, and a tail that only runs once every task queue is drained.
 * Task queues advance independently so helpers can answer in any order.
 */
export function planFixtureReplay(events: readonly AgentEvent[]): FixtureReplayPlan {
  const firstGated = events.findIndex((event) => decisionForEvent(event) !== null)
  if (firstGated < 0) return { prelude: events, tracks: [], tail: [] }

  const prelude = events.slice(0, firstGated)
  const grouped = new Map<string, AgentEvent[]>()
  for (const event of events.slice(firstGated)) {
    const key = event.taskId ?? TAIL_TRACK
    const bucket = grouped.get(key)
    if (bucket === undefined) grouped.set(key, [event])
    else bucket.push(event)
  }

  const tracks = [...grouped.entries()]
    .filter(([taskId]) => taskId !== TAIL_TRACK)
    .map(([taskId, trackEvents]) => ({ taskId, events: trackEvents }))

  return { prelude, tracks, tail: grouped.get(TAIL_TRACK) ?? [] }
}

export function createReplayProgress(plan: FixtureReplayPlan): FixtureReplayProgress {
  return {
    preludeCursor: 0,
    trackCursors: Object.fromEntries(plan.tracks.map(({ taskId }) => [taskId, 0])),
    tailCursor: 0
  }
}

/** The next event that needs no helper decision, or null while every queue waits. */
export function takeAutoStep(
  plan: FixtureReplayPlan,
  progress: FixtureReplayProgress
): FixtureReplayStep | null {
  const preludeEvent = plan.prelude[progress.preludeCursor]
  if (preludeEvent !== undefined) {
    return {
      event: preludeEvent,
      progress: { ...progress, preludeCursor: progress.preludeCursor + 1 }
    }
  }

  for (const track of plan.tracks) {
    const cursor = progress.trackCursors[track.taskId] ?? 0
    const event = track.events[cursor]
    if (event === undefined || decisionForEvent(event) !== null) continue
    return { event, progress: withTrackCursor(progress, track.taskId, cursor + 1) }
  }

  if (!tracksDrained(plan, progress)) return null
  const tailEvent = plan.tail[progress.tailCursor]
  if (tailEvent === undefined) return null
  return { event: tailEvent, progress: { ...progress, tailCursor: progress.tailCursor + 1 } }
}

/** The decision each task is waiting for, keyed by task id. */
export function pendingDecisions(
  plan: FixtureReplayPlan,
  progress: FixtureReplayProgress
): ReadonlyMap<string, FixtureReplayDecision> {
  const pending = new Map<string, FixtureReplayDecision>()
  if (progress.preludeCursor < plan.prelude.length) return pending

  for (const track of plan.tracks) {
    const event = track.events[progress.trackCursors[track.taskId] ?? 0]
    const decision = decisionForEvent(event)
    if (decision !== null) pending.set(track.taskId, decision)
  }
  return pending
}

export function takeDecisionStep(
  plan: FixtureReplayPlan,
  progress: FixtureReplayProgress,
  taskId: string,
  decision: FixtureReplayDecision
): FixtureReplayStep | null {
  if (pendingDecisions(plan, progress).get(taskId) !== decision) return null
  const track = plan.tracks.find((candidate) => candidate.taskId === taskId)
  if (track === undefined) return null

  const cursor = progress.trackCursors[taskId] ?? 0
  const event = track.events[cursor]
  if (event === undefined) return null
  return { event, progress: withTrackCursor(progress, taskId, cursor + 1) }
}

function tracksDrained(plan: FixtureReplayPlan, progress: FixtureReplayProgress): boolean {
  return plan.tracks.every(
    (track) => (progress.trackCursors[track.taskId] ?? 0) >= track.events.length
  )
}

function withTrackCursor(
  progress: FixtureReplayProgress,
  taskId: string,
  cursor: number
): FixtureReplayProgress {
  return { ...progress, trackCursors: { ...progress.trackCursors, [taskId]: cursor } }
}
