import {
  AgentEventSchema,
  InitialRequestSchema,
  RawToolEventSchema,
  RunAcceptedResponseSchema,
  SCHEMA_VERSION,
  type AgentEvent,
  type InitialRequest,
  type RawToolEvent,
  type RunAcceptedResponse,
  type Task
} from '@30-minute-exchange/contracts'

import {
  decomposeFixedRequest,
  type TaskPlanner
} from '../orchestration/decompose-fixed-request.js'
import {
  runBundleWorkflow,
  type BundleWorkflowTools
} from '../orchestration/run-bundle-workflow.js'

type EventListener<TEvent> = (event: TEvent) => void

type RunRecord = {
  agentEvents: AgentEvent[]
  rawToolEvents: RawToolEvent[]
  agentListeners: Set<EventListener<AgentEvent>>
  rawListeners: Set<EventListener<RawToolEvent>>
  completion: Promise<void>
  resolveCompletion: () => void
}

export type LiveRunSubscription = Readonly<{
  close: () => void
}>

export type LiveRunService = Readonly<{
  start: (input: unknown) => RunAcceptedResponse
  subscribeAgentEvents: (
    runId: string,
    afterSequence: number,
    listener: EventListener<AgentEvent>
  ) => LiveRunSubscription
  subscribeRawToolEvents: (
    runId: string,
    afterSequence: number,
    listener: EventListener<RawToolEvent>
  ) => LiveRunSubscription
  appendRawToolEvent: (runId: string, event: unknown) => void
  waitForCompletion: (runId: string) => Promise<void>
}>

export function createLiveRunService({
  planner,
  createCandidateProfiles,
  workflowTools,
  createRunId = defaultCreateRunId,
  seed = 'retry-path-v1',
  occurredAt
}: Readonly<{
  planner: TaskPlanner
  createCandidateProfiles: (tasks: readonly Task[]) => readonly unknown[]
  workflowTools?: Partial<BundleWorkflowTools>
  createRunId?: (request: InitialRequest) => string
  seed?: string
  occurredAt?: string
}>): LiveRunService {
  const records = new Map<string, RunRecord>()

  const start = (input: unknown): RunAcceptedResponse => {
    const request = InitialRequestSchema.parse(input)
    const runId = createRunId(request)
    if (records.has(runId)) throw new Error(`A run already exists for ${runId}`)

    const record = createRunRecord()
    records.set(runId, record)
    void executeRun({
      record,
      request,
      runId,
      planner,
      createCandidateProfiles,
      ...(workflowTools === undefined ? {} : { workflowTools }),
      seed,
      ...(occurredAt === undefined ? {} : { occurredAt })
    }).catch(() => undefined)

    return RunAcceptedResponseSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      runId,
      requestId: request.requestId,
      status: 'accepted',
      agentEventsUrl: `/api/runs/${encodeURIComponent(runId)}/events`,
      rawToolEventsUrl: `/api/runs/${encodeURIComponent(runId)}/raw-events`
    })
  }

  return {
    start,
    subscribeAgentEvents: (runId, afterSequence, listener) =>
      subscribe(
        getRecord(records, runId).agentEvents,
        getRecord(records, runId).agentListeners,
        afterSequence,
        listener
      ),
    subscribeRawToolEvents: (runId, afterSequence, listener) =>
      subscribe(
        getRecord(records, runId).rawToolEvents,
        getRecord(records, runId).rawListeners,
        afterSequence,
        listener
      ),
    appendRawToolEvent: (runId, event) => publishRawToolEvent(getRecord(records, runId), event),
    waitForCompletion: (runId) => getRecord(records, runId).completion
  }
}

async function executeRun({
  record,
  request,
  runId,
  planner,
  createCandidateProfiles,
  workflowTools,
  seed,
  occurredAt
}: Readonly<{
  record: RunRecord
  request: InitialRequest
  runId: string
  planner: TaskPlanner
  createCandidateProfiles: (tasks: readonly Task[]) => readonly unknown[]
  workflowTools?: Partial<BundleWorkflowTools>
  seed: string
  occurredAt?: string
}>): Promise<void> {
  try {
    const decomposition = await decomposeFixedRequest({
      planner,
      initialRequest: request,
      runId,
      ...(occurredAt === undefined ? {} : { occurredAt })
    })
    for (const event of decomposition.events) publishAgentEvent(record, event)

    runBundleWorkflow({
      initialRequest: request,
      tasks: decomposition.tasks,
      initialEvents: decomposition.events,
      candidateProfiles: createCandidateProfiles(decomposition.tasks),
      seed,
      ...(occurredAt === undefined ? {} : { occurredAt }),
      onEvent: (event) => publishAgentEvent(record, event),
      ...(workflowTools === undefined ? {} : { tools: workflowTools })
    })
  } finally {
    record.resolveCompletion()
  }
}

function createRunRecord(): RunRecord {
  let resolveCompletion: (() => void) | undefined
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })
  if (resolveCompletion === undefined) throw new Error('Run completion was not initialized')

  return {
    agentEvents: [],
    rawToolEvents: [],
    agentListeners: new Set(),
    rawListeners: new Set(),
    completion,
    resolveCompletion
  }
}

function publishAgentEvent(record: RunRecord, value: unknown): void {
  const event = AgentEventSchema.parse(value)
  record.agentEvents.push(event)
  for (const listener of record.agentListeners) listener(event)
}

export function publishRawToolEvent(record: RunRecord, value: unknown): void {
  const event = RawToolEventSchema.parse(value)
  record.rawToolEvents.push(event)
  for (const listener of record.rawListeners) listener(event)
}

function subscribe<TEvent extends { readonly sequence: number }>(
  events: readonly TEvent[],
  listeners: Set<EventListener<TEvent>>,
  afterSequence: number,
  listener: EventListener<TEvent>
): LiveRunSubscription {
  const minimumSequence = Number.isInteger(afterSequence) && afterSequence >= 0 ? afterSequence : 0
  for (const event of events) {
    if (event.sequence > minimumSequence) listener(event)
  }
  listeners.add(listener)
  return {
    close: () => listeners.delete(listener)
  }
}

function getRecord(records: ReadonlyMap<string, RunRecord>, runId: string): RunRecord {
  const record = records.get(runId)
  if (record === undefined) throw new Error(`Unknown run: ${runId}`)
  return record
}

function defaultCreateRunId(request: InitialRequest): string {
  return `run-${request.requestId}-${Date.now()}`
}
