import type {
  AgentEvent,
  Candidate,
  FinalResult,
  InitialRequest,
  Task
} from '@30-minute-exchange/contracts'

import type { RunState } from '../state/run-state.js'

export type RequesterDemoStage =
  | 'preparing'
  | 'searching'
  | 'matched'
  | 'partially_matched'
  | 'safety_excluded'
  | 'unmatched'
  | 'failed'

export type HelperDemoStage = 'waiting' | 'request_received' | 'rerouting' | 'mission'

export interface ParticipantRequestCard {
  readonly title: string
  readonly description: string
  readonly regionLabel: string
  readonly approximateLocation: string
  readonly startAt: string
  readonly endAt: string
  readonly durationMinutes: number
  readonly distanceKm: number | null
}

export interface ParticipantDemoView {
  readonly requesterStage: RequesterDemoStage
  readonly helperStage: HelperDemoStage
  readonly request: InitialRequest | null
  readonly requestCard: ParticipantRequestCard | null
  readonly candidate: Candidate | null
  readonly attempt: number | null
  readonly previousOutcome: 'rejected' | 'timed_out' | null
  readonly matchedCandidateName: string | null
  readonly result: FinalResult | null
}

export function deriveParticipantDemoView(run: RunState): ParticipantDemoView {
  const events = knownEvents(run)
  const request = firstEvent(events, 'request.created')?.data.request ?? null
  const tasks = events
    .filter((event): event is Extract<AgentEvent, { type: 'task.created' }> =>
      isEventType(event, 'task.created')
    )
    .map((event) => event.data.task)
  const candidates = events
    .filter((event): event is Extract<AgentEvent, { type: 'candidates.ranked' }> =>
      isEventType(event, 'candidates.ranked')
    )
    .flatMap((event) => event.data.candidates)
  const latestOutreach = lastEvent(events, 'outreach.sent')
  const latestReply = lastEvent(events, 'neighbor.replied')
  const latestTimeout = lastEvent(events, 'outreach.timed_out')
  const latestResponse = laterEvent(latestReply, latestTimeout)
  const match = lastEvent(events, 'match.confirmed')
  const result = run.result
  const candidateId = match?.data.candidateId ?? latestOutreach?.data.candidateId
  const candidate = candidates.find((item) => item.candidateId === candidateId) ?? null
  const taskId = match?.taskId ?? latestOutreach?.taskId ?? firstActionableTaskId(tasks, result)
  const task = tasks.find((item) => item.taskId === taskId) ?? tasks[0] ?? null
  const previousOutcome = responseOutcome(latestResponse)

  return {
    requesterStage: requesterStage(run, events),
    helperStage: helperStage(latestOutreach, latestResponse, match, result),
    request,
    requestCard: task === null ? null : toRequestCard(task, candidate),
    candidate,
    attempt: latestOutreach?.data.attempt ?? null,
    previousOutcome,
    matchedCandidateName:
      match === undefined
        ? null
        : (candidates.find((item) => item.candidateId === match.data.candidateId)?.displayName ??
          null),
    result
  }
}

function requesterStage(run: RunState, events: readonly AgentEvent[]): RequesterDemoStage {
  if (run.phase === 'failed') return 'failed'
  if (run.result !== null) {
    return run.result.status === 'fully_matched' ? 'matched' : run.result.status
  }
  if (lastEvent(events, 'match.confirmed') !== undefined) return 'matched'
  if (
    lastEvent(events, 'candidates.ranked') !== undefined ||
    lastEvent(events, 'outreach.sent') !== undefined
  ) {
    return 'searching'
  }
  return 'preparing'
}

function helperStage(
  outreach: Extract<AgentEvent, { type: 'outreach.sent' }> | undefined,
  response: Extract<AgentEvent, { type: 'neighbor.replied' | 'outreach.timed_out' }> | undefined,
  match: Extract<AgentEvent, { type: 'match.confirmed' }> | undefined,
  result: FinalResult | null
): HelperDemoStage {
  if (match !== undefined || result?.taskResults.some(({ status }) => status === 'matched')) {
    return 'mission'
  }
  if (outreach === undefined) return 'waiting'
  if (response === undefined || outreach.sequence > response.sequence) return 'request_received'
  return responseOutcome(response) === null ? 'mission' : 'rerouting'
}

function responseOutcome(
  event: Extract<AgentEvent, { type: 'neighbor.replied' | 'outreach.timed_out' }> | undefined
): 'rejected' | 'timed_out' | null {
  if (event === undefined) return null
  if (event.type === 'outreach.timed_out') return 'timed_out'
  return event.data.response === 'accepted' ? null : 'rejected'
}

function toRequestCard(task: Task, candidate: Candidate | null): ParticipantRequestCard {
  return {
    title: task.title,
    description: task.description,
    regionLabel: task.region.label,
    approximateLocation: task.region.approximateLocation,
    startAt: task.timeWindow.startAt,
    endAt: task.timeWindow.endAt,
    durationMinutes: task.estimatedDurationMinutes,
    distanceKm: candidate?.distanceKm ?? null
  }
}

function firstActionableTaskId(tasks: readonly Task[], result: FinalResult | null) {
  const matched = result?.taskResults.find(({ status }) => status === 'matched')
  if (matched !== undefined) return matched.taskId
  const excludedIds = new Set(
    result?.taskResults
      .filter(({ status }) => status === 'safety_excluded')
      .map(({ taskId }) => taskId) ?? []
  )
  return tasks.find(({ taskId }) => !excludedIds.has(taskId))?.taskId
}

function knownEvents(run: RunState): readonly AgentEvent[] {
  return run.normalized.items.flatMap((item) => (item.kind === 'known' ? [item.event] : []))
}

function isEventType<TType extends AgentEvent['type']>(
  event: AgentEvent,
  type: TType
): event is Extract<AgentEvent, { type: TType }> {
  return event.type === type
}

function firstEvent<TType extends AgentEvent['type']>(events: readonly AgentEvent[], type: TType) {
  return events.find((event): event is Extract<AgentEvent, { type: TType }> =>
    isEventType(event, type)
  )
}

function lastEvent<TType extends AgentEvent['type']>(
  events: readonly AgentEvent[],
  type: TType
): Extract<AgentEvent, { type: TType }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event !== undefined && isEventType(event, type)) return event
  }
  return undefined
}

function laterEvent(
  first: Extract<AgentEvent, { type: 'neighbor.replied' }> | undefined,
  second: Extract<AgentEvent, { type: 'outreach.timed_out' }> | undefined
) {
  if (first === undefined) return second
  if (second === undefined) return first
  return first.sequence > second.sequence ? first : second
}

