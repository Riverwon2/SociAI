import {
  AgentEventSchema,
  InitialRequestSchema,
  SCHEMA_VERSION,
  TaskSchema,
  type AgentEvent,
  type InitialRequest,
  type Task
} from '@30-minute-exchange/contracts'

import { FIXED_RUN_ID, fixedInitialRequest } from '../fixtures/fixed-initial-request.js'
import { TaskPlanOutputSchema } from '../openai/task-plan-schema.js'
import type { OpenAIResponsesStreamEvent } from '../openai/official-openai-client.js'
import { WorkflowHookStage, type WorkflowHookEmitter } from './workflow-hooks.js'

export type TaskPlanner = Readonly<{
  decompose: (
    input: Readonly<{
      initialRequest: InitialRequest
      runId: string
      onRawEvent?: (event: OpenAIResponsesStreamEvent) => void
    }>
  ) => Promise<unknown>
}>

export type DecomposedPlan = Readonly<{
  requestId: string
  tasks: Task[]
  summary: string
  events: AgentEvent[]
}>

export async function decomposeFixedRequest({
  planner,
  initialRequest = fixedInitialRequest,
  runId = FIXED_RUN_ID,
  occurredAt = new Date().toISOString(),
  hooks,
  onRawEvent
}: Readonly<{
  planner: TaskPlanner
  initialRequest?: unknown
  runId?: string
  occurredAt?: string
  hooks?: WorkflowHookEmitter
  onRawEvent?: (event: OpenAIResponsesStreamEvent) => void
}>): Promise<DecomposedPlan> {
  hooks?.emit(WorkflowHookStage.inputValidation, 'before', { runId })
  const request = parseInitialRequest(initialRequest)
  hooks?.emit(WorkflowHookStage.inputValidation, 'after', {
    requestId: request.requestId,
    timeWindow: request.timeWindow,
    maxActivityDurationMinutes: request.maxActivityDurationMinutes
  })
  hooks?.emit(WorkflowHookStage.taskDecomposition, 'before', {
    requestId: request.requestId,
    runId,
    provider: 'openai_structured_output'
  })
  let plannerOutput: unknown
  try {
    plannerOutput = await planner.decompose({
      initialRequest: request,
      runId,
      ...(onRawEvent === undefined ? {} : { onRawEvent })
    })
  } catch (error) {
    hooks?.emit(WorkflowHookStage.taskDecomposition, 'error', {
      requestId: request.requestId,
      error: error instanceof Error ? error.message : 'OpenAI task decomposition failed.'
    })
    throw error
  }
  const parsedPlan = parsePlannerOutput(plannerOutput)
  const tasks = parsedPlan.tasks.map((task) => TaskSchema.parse(task))
  validateTaskContext(tasks, { requestId: request.requestId, runId })
  const summary = `실행 계획 요약(매칭 확정 전): ${parsedPlan.summary}`

  hooks?.emit(WorkflowHookStage.taskDecomposition, 'after', {
    requestId: request.requestId,
    taskIds: tasks.map((task) => task.taskId),
    taskCount: tasks.length,
    summary
  })

  return {
    requestId: request.requestId,
    tasks,
    summary,
    events: createInitialEvents({ request, runId, tasks, summary, occurredAt })
  }
}

function parseInitialRequest(value: unknown): InitialRequest {
  const result = InitialRequestSchema.safeParse(value)

  if (!result.success) {
    throw new Error('InitialRequest validation failed before OpenAI planning')
  }

  return result.data
}

function parsePlannerOutput(value: unknown) {
  const result = TaskPlanOutputSchema.safeParse(value)

  if (!result.success) {
    throw new Error('OpenAI plan output failed contract validation')
  }

  return result.data
}

function validateTaskContext(
  tasks: Task[],
  context: Readonly<{ requestId: string; runId: string }>
): void {
  for (const task of tasks) {
    if (task.requestId !== context.requestId || task.runId !== context.runId) {
      throw new Error('OpenAI plan task must match the active request and run')
    }

    if (task.status !== 'created') {
      throw new Error('OpenAI plan task must use status created')
    }
  }
}

function createInitialEvents({
  request,
  runId,
  tasks,
  summary,
  occurredAt
}: Readonly<{
  request: InitialRequest
  runId: string
  tasks: Task[]
  summary: string
  occurredAt: string
}>): AgentEvent[] {
  const requestEvent = AgentEventSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    eventId: `${runId}-event-1`,
    runId,
    requestId: request.requestId,
    sequence: 1,
    occurredAt,
    message: '요청을 검증하고 계획 수립을 시작했습니다.',
    isSimulation: false,
    type: 'request.created',
    data: { request }
  })
  const planEvent = AgentEventSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    eventId: `${runId}-event-2`,
    runId,
    requestId: request.requestId,
    sequence: 2,
    occurredAt,
    message: summary,
    isSimulation: false,
    type: 'plan.created',
    data: {
      revision: 1,
      taskIds: tasks.map((task) => task.taskId),
      summary,
      userInputRequired: false
    }
  })
  const taskEvents = tasks.map((task, index) =>
    AgentEventSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      eventId: `${runId}-event-${index + 3}`,
      runId,
      requestId: request.requestId,
      taskId: task.taskId,
      sequence: index + 3,
      occurredAt,
      message: `${task.title} 작업을 계획에 추가했습니다.`,
      isSimulation: false,
      type: 'task.created',
      data: { task }
    })
  )

  return [requestEvent, planEvent, ...taskEvents]
}
