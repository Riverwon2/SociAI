import type {
  AgentEvent,
  Candidate,
  DemoScenarioFixture,
  FinalResult,
  RawToolEvent
} from '@30-minute-exchange/contracts'
import {
  appendNormalizedEvent,
  appendRawToolEvent,
  createNormalizedEventBuffer,
  createRawToolEventBuffer,
  type NormalizedEventBuffer,
  type RawToolEventBuffer
} from '@30-minute-exchange/event-stream'

export type RunPhase = 'draft' | 'running' | 'complete' | 'failed'
export type RunMode = 'live' | 'replay'
export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed'

export interface RunState {
  readonly phase: RunPhase
  readonly mode: RunMode
  readonly connectionStatus: ConnectionStatus
  readonly requestId: string | null
  readonly liveStreamUrls: {
    readonly agentEventsUrl: string
    readonly rawToolEventsUrl: string
  } | null
  readonly scenario: DemoScenarioFixture | null
  readonly normalized: NormalizedEventBuffer
  readonly raw: RawToolEventBuffer
  readonly result: FinalResult | null
  readonly failureMessage: string | null
  readonly streamIssues: readonly string[]
}

export type RunAction =
  | {
      readonly type: 'run.started'
      readonly mode: RunMode
      readonly runId: string
      readonly requestId?: string
      readonly liveStreamUrls?: {
        readonly agentEventsUrl: string
        readonly rawToolEventsUrl: string
      }
      readonly scenario: DemoScenarioFixture | null
      readonly afterSequence?: { readonly agent: number; readonly raw: number }
    }
  | { readonly type: 'agent.received'; readonly value: unknown }
  | { readonly type: 'raw.received'; readonly value: RawToolEvent }
  | { readonly type: 'connection.changed'; readonly status: ConnectionStatus }
  | { readonly type: 'stream.issue'; readonly message: string }
  | { readonly type: 'run.failed'; readonly message: string }
  | { readonly type: 'run.reset' }

export function createInitialRunState(): RunState {
  return {
    phase: 'draft',
    mode: 'replay',
    connectionStatus: 'idle',
    requestId: null,
    liveStreamUrls: null,
    scenario: null,
    normalized: createNormalizedEventBuffer(),
    raw: createRawToolEventBuffer(),
    result: null,
    failureMessage: null,
    streamIssues: []
  }
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'run.started':
      return startRun(action)
    case 'agent.received':
      return receiveAgentEvent(state, action.value)
    case 'raw.received':
      return { ...state, raw: appendRawToolEvent(state.raw, action.value) }
    case 'connection.changed':
      return { ...state, connectionStatus: action.status }
    case 'stream.issue':
      return { ...state, streamIssues: [...state.streamIssues, action.message] }
    case 'run.failed':
      return {
        ...state,
        phase: 'failed',
        connectionStatus: 'failed',
        failureMessage: action.message
      }
    case 'run.reset':
      return createInitialRunState()
  }
}

function startRun(action: Extract<RunAction, { type: 'run.started' }>): RunState {
  return {
    phase: 'running',
    mode: action.mode,
    connectionStatus: action.mode === 'replay' ? 'open' : 'connecting',
    requestId: action.requestId ?? action.scenario?.initialRequest.requestId ?? null,
    liveStreamUrls: action.liveStreamUrls ?? null,
    scenario: action.scenario,
    normalized: createNormalizedEventBuffer({
      runId: action.runId,
      ...(action.afterSequence === undefined ? {} : { afterSequence: action.afterSequence.agent })
    }),
    raw: createRawToolEventBuffer({
      runId: action.runId,
      ...(action.afterSequence === undefined ? {} : { afterSequence: action.afterSequence.raw })
    }),
    result: null,
    failureMessage: null,
    streamIssues: []
  }
}

function receiveAgentEvent(state: RunState, value: unknown): RunState {
  const normalized = appendNormalizedEvent(state.normalized, value)
  const completion = normalized.items.find(
    (item) =>
      item.kind === 'known' &&
      item.event.type === 'request.completed' &&
      item.sequence <= normalized.resumeAfterSequence
  )
  const result =
    completion?.kind === 'known' && completion.event.type === 'request.completed'
      ? completion.event.data.result
      : null

  return {
    ...state,
    phase: result === null ? state.phase : 'complete',
    connectionStatus: result === null ? state.connectionStatus : 'closed',
    normalized,
    result: result ?? state.result
  }
}

export interface CandidateAttemptView {
  readonly candidateId: string
  readonly attempt: number
  readonly outcome: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'timed_out'
}

export interface TaskRunView {
  readonly taskId: string
  readonly title: string
  readonly description: string
  readonly durationMinutes: number
  readonly safetyLevel: string | null
  readonly safetyGuidance: string | null
  readonly safetyReasonCodes: readonly string[]
  readonly sufficiencyStatus: string | null
  readonly sufficiencyReasonCodes: readonly string[]
  readonly candidates: readonly Candidate[]
  readonly attempts: readonly CandidateAttemptView[]
  readonly status: string
  readonly matchedCandidateId: string | null
  readonly blockGuidance: string | null
  readonly bundle: TaskBundleView | null
  readonly assignment: TaskAssignmentView | null
}

export interface TaskBundleView {
  readonly bundleId: string
  readonly companionTaskIds: readonly string[]
  readonly totalActivityDurationMinutes: number
  readonly waitingMinutes: number
}

export interface TaskAssignmentView {
  readonly assignmentId: string
  readonly candidateId: string
  readonly candidateName: string | null
  readonly startAt: string
  readonly endAt: string
}

interface MutableTaskRunView {
  taskId: string
  title: string
  description: string
  durationMinutes: number
  safetyLevel: string | null
  safetyGuidance: string | null
  safetyReasonCodes: string[]
  sufficiencyStatus: string | null
  sufficiencyReasonCodes: string[]
  candidates: Candidate[]
  attempts: CandidateAttemptView[]
  status: string
  matchedCandidateId: string | null
  blockGuidance: string | null
  bundle: TaskBundleView | null
  assignment: TaskAssignmentView | null
}

export function deriveTaskViews(buffer: NormalizedEventBuffer): readonly TaskRunView[] {
  const tasks = new Map<string, MutableTaskRunView>()
  for (const item of buffer.items) {
    if (item.kind !== 'known') continue
    applyAgentEvent(tasks, item.event)
  }
  return [...tasks.values()].map((task) => resolveAssignedName(task, collectCandidateNames(tasks)))
}

function collectCandidateNames(tasks: Map<string, MutableTaskRunView>): Map<string, string> {
  const names = new Map<string, string>()
  for (const task of tasks.values()) {
    for (const candidate of task.candidates) names.set(candidate.candidateId, candidate.displayName)
  }
  return names
}

function resolveAssignedName(
  task: MutableTaskRunView,
  names: Map<string, string>
): MutableTaskRunView {
  if (task.assignment === null) return task
  return {
    ...task,
    assignment: {
      ...task.assignment,
      candidateName: names.get(task.assignment.candidateId) ?? null
    }
  }
}

function applyAgentEvent(tasks: Map<string, MutableTaskRunView>, event: AgentEvent) {
  switch (event.type) {
    case 'task.created':
      tasks.set(event.data.task.taskId, createTaskView(event.data.task))
      break
    case 'safety.checked': {
      const task = tasks.get(event.data.decision.taskId)
      if (task !== undefined) {
        task.safetyLevel = event.data.decision.level
        task.safetyGuidance = event.data.decision.guidance ?? null
        task.safetyReasonCodes = [...event.data.decision.reasonCodes]
        task.status = event.data.decision.action === 'block' ? '안전 제외' : '안전 확인'
      }
      break
    }
    case 'sufficiency.checked': {
      const task = tasks.get(event.data.decision.taskId)
      if (task !== undefined) {
        task.sufficiencyStatus = event.data.decision.status
        task.sufficiencyReasonCodes = [...event.data.decision.reasonCodes]
        task.status = event.data.decision.action === 'hold' ? '정보 보류' : '후보 탐색'
      }
      break
    }
    case 'bundles.planned':
      for (const bundle of event.data.bundles) {
        for (const taskId of bundle.taskIds) {
          const task = tasks.get(taskId)
          if (task === undefined) continue
          task.bundle = {
            bundleId: bundle.bundleId,
            companionTaskIds: bundle.taskIds.filter((id) => id !== taskId),
            totalActivityDurationMinutes: bundle.totalActivityDurationMinutes,
            waitingMinutes: bundle.waitingMinutes
          }
        }
      }
      break
    case 'assignments.planned':
      for (const assignment of event.data.assignments) {
        for (const taskId of assignment.taskIds) {
          const task = tasks.get(taskId)
          if (task === undefined) continue
          task.assignment = {
            assignmentId: assignment.assignmentId,
            candidateId: assignment.candidateId,
            candidateName: null,
            startAt: assignment.scheduledWindow.startAt,
            endAt: assignment.scheduledWindow.endAt
          }
          task.status = '이웃 배정'
        }
      }
      break
    case 'candidates.ranked': {
      const task = event.taskId === undefined ? undefined : tasks.get(event.taskId)
      if (task !== undefined) {
        task.candidates = [...event.data.candidates]
        task.status = '후보 정렬 완료'
      }
      break
    }
    case 'outreach.sent':
      if (event.taskId !== undefined) {
        appendAttempt(tasks, event.taskId, {
          candidateId: event.data.candidateId,
          attempt: event.data.attempt,
          outcome: 'pending'
        })
      }
      break
    case 'neighbor.replied':
      if (event.taskId !== undefined) {
        updateAttempt(tasks, event.taskId, event.data.attempt, event.data.response)
      }
      break
    case 'outreach.timed_out':
      if (event.taskId !== undefined) {
        updateAttempt(tasks, event.taskId, event.data.attempt, 'timed_out')
      }
      break
    case 'match.confirmed': {
      const task = event.taskId === undefined ? undefined : tasks.get(event.taskId)
      if (task !== undefined) {
        task.status = '매칭 완료'
        task.matchedCandidateId = event.data.candidateId
      }
      break
    }
    case 'task.blocked': {
      const task = event.taskId === undefined ? undefined : tasks.get(event.taskId)
      if (task !== undefined) {
        task.status = '안전 제외'
        task.blockGuidance = event.data.guidance
        task.safetyReasonCodes = [...event.data.reasonCodes]
      }
      break
    }
    case 'task.held': {
      const task = event.taskId === undefined ? undefined : tasks.get(event.taskId)
      if (task !== undefined) {
        task.status = '정보 보류'
        task.blockGuidance = event.data.guidance
        task.sufficiencyReasonCodes = [...event.data.reasonCodes]
      }
      break
    }
    case 'request.completed':
      applyFinalTaskResults(tasks, event.data.result)
      break
    default:
      break
  }
}

function createTaskView(task: {
  taskId: string
  title: string
  description: string
  estimatedDurationMinutes: number
}): MutableTaskRunView {
  return {
    taskId: task.taskId,
    title: task.title,
    description: task.description,
    durationMinutes: task.estimatedDurationMinutes,
    safetyLevel: null,
    safetyGuidance: null,
    safetyReasonCodes: [],
    sufficiencyStatus: null,
    sufficiencyReasonCodes: [],
    candidates: [],
    attempts: [],
    status: '작업 생성',
    matchedCandidateId: null,
    blockGuidance: null,
    bundle: null,
    assignment: null
  }
}

function appendAttempt(
  tasks: Map<string, MutableTaskRunView>,
  taskId: string,
  attempt: CandidateAttemptView
) {
  const task = tasks.get(taskId)
  if (task === undefined) return
  task.attempts = [...task.attempts, attempt]
  task.status = `${attempt.attempt}번째 후보 응답 대기`
}

function updateAttempt(
  tasks: Map<string, MutableTaskRunView>,
  taskId: string,
  attempt: number,
  outcome: CandidateAttemptView['outcome']
) {
  const task = tasks.get(taskId)
  if (task === undefined) return
  task.attempts = task.attempts.map((item) =>
    item.attempt === attempt ? { ...item, outcome } : item
  )
  task.status = attemptStatus(outcome)
}

function attemptStatus(outcome: CandidateAttemptView['outcome']): string {
  return {
    pending: '응답 대기',
    accepted: '후보 수락',
    rejected: '후보 거절',
    cancelled: '후보 취소',
    timed_out: '10분 무응답'
  }[outcome]
}

function applyFinalTaskResults(tasks: Map<string, MutableTaskRunView>, result: FinalResult) {
  for (const taskResult of result.taskResults) {
    const task = tasks.get(taskResult.taskId)
    if (task === undefined) continue
    task.status = {
      matched: '매칭 완료',
      safety_excluded: '안전 제외',
      unmatched: '매칭 없음',
      held: '정보 보류',
      failed: '실행 실패'
    }[taskResult.status]
    task.matchedCandidateId = taskResult.matchedCandidateId ?? null
  }
}

