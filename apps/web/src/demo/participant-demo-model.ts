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
  | 'clarification'
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

/** One requester-to-helper connection. A request split into three tasks has three. */
export interface HelperConnectionView {
  readonly taskId: string
  readonly taskTitle: string
  readonly stage: HelperDemoStage
  readonly candidate: Candidate | null
  readonly candidateName: string | null
  readonly requestCard: ParticipantRequestCard | null
  readonly attempt: number | null
  readonly previousOutcome: 'rejected' | 'timed_out' | null
  readonly matchedCandidateName: string | null
}

export interface ParticipantDemoView {
  readonly requesterStage: RequesterDemoStage
  readonly request: InitialRequest | null
  readonly result: FinalResult | null
  readonly helpers: readonly HelperConnectionView[]
  readonly clarificationResults: readonly ClarificationRequesterResult[]
}

export interface ClarificationRequesterResult {
  readonly taskId: string
  readonly candidateId: string
  readonly outcome: 'conversation_agreed' | 'rejected'
  readonly requesterMessage: string
}

export function deriveParticipantDemoView(run: RunState): ParticipantDemoView {
  const events = knownEvents(run)
  const sources: HelperSources = {
    events,
    tasks: collect(events, 'task.created').map((event) => event.data.task),
    candidates: collect(events, 'candidates.ranked').flatMap((event) => event.data.candidates),
    result: run.result
  }
  const helpers = helperTaskIds(events).map((taskId) => buildHelperView(taskId, sources))

  return {
    requesterStage: requesterStage(run, events, helpers),
    request: collect(events, 'request.created')[0]?.data.request ?? null,
    result: run.result,
    helpers,
    clarificationResults: collect(events, 'clarification.responded').map((event) => ({
      taskId: event.taskId,
      candidateId: event.data.candidateId,
      outcome: event.data.outcome,
      requesterMessage: event.data.requesterMessage
    }))
  }
}

/**
 * A helper screen exists as soon as its task clears the safety check, so a split
 * request shows every connection while the plan is still being prepared.
 */
function helperTaskIds(events: readonly AgentEvent[]): readonly string[] {
  const excluded = new Set([
    ...collect(events, 'task.blocked').flatMap(({ taskId }) => taskId ?? []),
    ...collect(events, 'task.held').flatMap(({ taskId }) => taskId ?? [])
  ])
  const cleared = collect(events, 'safety.checked')
    .filter((event) => event.data.decision.action !== 'block')
    .flatMap(({ taskId }) => taskId ?? [])
  const contacted = collect(events, 'outreach.sent').flatMap(({ taskId }) => taskId ?? [])

  return [...new Set([...cleared, ...contacted])].filter((taskId) => !excluded.has(taskId))
}

interface HelperSources {
  readonly events: readonly AgentEvent[]
  readonly tasks: readonly Task[]
  readonly candidates: readonly Candidate[]
  readonly result: FinalResult | null
}

function buildHelperView(taskId: string, sources: HelperSources): HelperConnectionView {
  const { candidates, events, result, tasks } = sources
  const task = tasks.find((item) => item.taskId === taskId) ?? null
  const outreach = lastOf(collect(events, 'outreach.sent').filter(onTask(taskId)))
  const response = lastResponse(events, taskId)
  const match = lastOf(collect(events, 'match.confirmed').filter(onTask(taskId)))
  const matchedByResult =
    result?.taskResults.some((item) => item.taskId === taskId && item.status === 'matched') === true

  const candidateId = match?.data.candidateId ?? outreach?.data.candidateId
  const candidate = candidates.find((item) => item.candidateId === candidateId) ?? null

  return {
    taskId,
    taskTitle: task?.title ?? taskId,
    stage: helperStage(outreach, response, match !== undefined || matchedByResult),
    candidate,
    candidateName: candidate?.displayName ?? null,
    requestCard: task === null ? null : toRequestCard(task, candidate),
    attempt: outreach?.data.attempt ?? null,
    previousOutcome: responseOutcome(response),
    matchedCandidateName: match === undefined ? null : (candidate?.displayName ?? null)
  }
}

function helperStage(
  outreach: Extract<AgentEvent, { type: 'outreach.sent' }> | undefined,
  response: ResponseEvent | undefined,
  matched: boolean
): HelperDemoStage {
  if (matched) return 'mission'
  if (outreach === undefined) return 'waiting'
  if (response === undefined || outreach.sequence > response.sequence) return 'request_received'
  return responseOutcome(response) === null ? 'mission' : 'rerouting'
}

function requesterStage(
  run: RunState,
  events: readonly AgentEvent[],
  helpers: readonly HelperConnectionView[]
): RequesterDemoStage {
  if (run.phase === 'failed') return 'failed'
  if (run.result !== null) {
    return run.result.status === 'fully_matched' ? 'matched' : run.result.status
  }
  if (collect(events, 'clarification.responded').length > 0) return 'clarification'
  // A split request stays in search until every connection has been accepted.
  if (helpers.length > 0 && helpers.every(({ stage }) => stage === 'mission')) return 'matched'
  if (
    collect(events, 'candidates.ranked').length > 0 ||
    collect(events, 'outreach.sent').length > 0
  ) {
    return 'searching'
  }
  return 'preparing'
}

type ResponseEvent = Extract<AgentEvent, { type: 'neighbor.replied' | 'outreach.timed_out' }>

function lastResponse(events: readonly AgentEvent[], taskId: string): ResponseEvent | undefined {
  return lastOf(
    events.filter(
      (event): event is ResponseEvent =>
        (event.type === 'neighbor.replied' || event.type === 'outreach.timed_out') &&
        event.taskId === taskId
    )
  )
}

function responseOutcome(event: ResponseEvent | undefined): 'rejected' | 'timed_out' | null {
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

function knownEvents(run: RunState): readonly AgentEvent[] {
  return run.normalized.items.flatMap((item) => (item.kind === 'known' ? [item.event] : []))
}

function collect<TType extends AgentEvent['type']>(
  events: readonly AgentEvent[],
  type: TType
): readonly Extract<AgentEvent, { type: TType }>[] {
  return events.filter(
    (event): event is Extract<AgentEvent, { type: TType }> => event.type === type
  )
}

function onTask(taskId: string) {
  return (event: AgentEvent) => event.taskId === taskId
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1]
}
