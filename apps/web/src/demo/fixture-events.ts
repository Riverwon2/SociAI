import {
  AgentEventSchema,
  type AgentEvent,
  type DemoScenarioFixture,
  type FinalResult,
  type InitialRequest,
  type Task
} from '@30-minute-exchange/contracts'

export function buildFixtureEvents(
  fixture: DemoScenarioFixture,
  request: InitialRequest = fixture.initialRequest
): readonly AgentEvent[] {
  const context = createBuildContext(fixture, request)
  return fixture.expectedEventTypes.map((type, index) => buildEvent(type, index + 1, context))
}

interface BuildContext {
  readonly fixture: DemoScenarioFixture
  readonly request: InitialRequest
  taskIndex: number
  safetyIndex: number
  sufficiencyIndex: number
  candidateIndex: number
  outreachIndex: number
  responseIndex: number
  matchIndex: number
  revision: number
  lastOutcome: 'rejected' | 'timed_out' | null
}

function createBuildContext(fixture: DemoScenarioFixture, request: InitialRequest): BuildContext {
  return {
    fixture,
    request,
    taskIndex: 0,
    safetyIndex: 0,
    sufficiencyIndex: 0,
    candidateIndex: 0,
    outreachIndex: 0,
    responseIndex: 0,
    matchIndex: 0,
    revision: 1,
    lastOutcome: null
  }
}

function buildEvent(type: AgentEvent['type'], sequence: number, context: BuildContext): AgentEvent {
  const { fixture } = context
  const envelope = {
    schemaVersion: 2 as const,
    eventId: `fixture_${fixture.scenarioId}_${sequence}`,
    runId: fixture.expectedFinalResult.runId,
    requestId: context.request.requestId,
    sequence,
    occurredAt: eventTime(context.request.timeWindow.startAt, sequence),
    type,
    message: eventMessage(type),
    isSimulation: true
  }

  return AgentEventSchema.parse({ ...envelope, ...eventPayload(type, context) })
}

function eventPayload(type: AgentEvent['type'], context: BuildContext): Record<string, unknown> {
  switch (type) {
    case 'request.created':
      return { data: { request: context.request } }
    case 'plan.created':
      return {
        data: {
          revision: 1,
          taskIds: context.fixture.tasks.map(({ taskId }) => taskId),
          summary: '요청을 안전한 작업으로 나누고 적합한 이웃을 순서대로 찾습니다.',
          userInputRequired: false
        }
      }
    case 'task.created':
      return taskCreatedPayload(context)
    case 'safety.checked':
      return safetyPayload(context)
    case 'sufficiency.checked':
      return sufficiencyPayload(context)
    case 'task.held':
      return heldPayload(context)
    case 'clarification.invited':
      return clarificationInvitedPayload(context)
    case 'clarification.responded':
      return clarificationRespondedPayload(context)
    case 'bundles.planned':
      return bundlesPayload(context)
    case 'assignments.planned':
      return assignmentsPayload(context)
    case 'candidates.ranked':
      return candidatesPayload(context)
    case 'bundle.candidates.ranked':
      throw new Error('bundle.candidates.ranked is emitted by a live run, not by a replay fixture')
    case 'outreach.sent':
      return outreachPayload(context)
    case 'neighbor.replied':
      return replyPayload(context)
    case 'outreach.timed_out':
      return timeoutPayload(context)
    case 'plan.updated':
      return planUpdatedPayload(context)
    case 'match.confirmed':
      return matchPayload(context)
    case 'task.blocked':
      return blockedPayload(context)
    case 'tool.failed':
      return toolFailedPayload()
    case 'request.completed':
      return { data: { result: replayResult(context.fixture, context.request.requestId) } }
  }
}

function taskCreatedPayload(context: BuildContext) {
  const task = requireItem(context.fixture.tasks, context.taskIndex, 'task')
  context.taskIndex += 1
  return { taskId: task.taskId, data: { task: withRequestId(task, context.request.requestId) } }
}

function safetyPayload(context: BuildContext) {
  const task = requireItem(context.fixture.tasks, context.safetyIndex, 'safety task')
  context.safetyIndex += 1
  const blocked = taskResultStatus(context.fixture, task) === 'safety_excluded'
  return {
    taskId: task.taskId,
    data: {
      decision: {
        schemaVersion: 2,
        runId: task.runId,
        requestId: context.request.requestId,
        taskId: task.taskId,
        level: blocked ? 'high' : 'low',
        action: blocked ? 'block' : 'proceed',
        reasonCodes: [blocked ? 'medication_assistance' : 'ordinary_life_support'],
        conditions: [],
        guidance: blocked
          ? '처방약 복용 보조는 일반 이웃 매칭에서 제외합니다.'
          : '일반적인 비의료 생활지원으로 진행할 수 있습니다.'
      }
    }
  }
}

function sufficiencyPayload(context: BuildContext) {
  const tasks = actionableTasks(context.fixture)
  const task = requireItem(tasks, context.sufficiencyIndex, 'sufficiency task')
  context.sufficiencyIndex += 1
  const isHeld = taskResultStatus(context.fixture, task) === 'held'
  const missingInformation =
    task.missingInformation.length > 0
      ? task.missingInformation
      : [{ code: 'details', message: '필수 정보가 부족합니다.' }]
  return {
    taskId: task.taskId,
    data: {
      decision: {
        schemaVersion: 2,
        runId: task.runId,
        requestId: context.request.requestId,
        taskId: task.taskId,
        status: isHeld ? 'insufficient' : 'sufficient',
        action: isHeld ? 'hold' : 'proceed',
        reasonCodes: [isHeld ? 'required_information_missing' : 'required_information_present'],
        missingInformation: isHeld ? missingInformation : []
      }
    }
  }
}

function heldPayload(context: BuildContext) {
  const task =
    context.fixture.tasks.find(
      (candidate) => taskResultStatus(context.fixture, candidate) === 'held'
    ) ?? requireItem(actionableTasks(context.fixture), 0, 'held task')
  return {
    taskId: task.taskId,
    data: {
      reasonCodes: ['required_information_missing'],
      missingInformation:
        task.missingInformation.length > 0
          ? task.missingInformation
          : [{ code: 'details', message: '필수 정보가 부족합니다.' }],
      guidance: '추가 질문 없이 해당 작업만 보류합니다.'
    }
  }
}

/** A clarification invite belongs to a held task and the neighbour asked about it. */
function clarificationPair(context: BuildContext) {
  const task = requireHeldTask(context.fixture)
  const candidate = context.fixture.candidates.find(({ taskId }) => taskId === task.taskId)
  if (candidate === undefined) {
    throw new Error('Fixture is missing a candidate for the clarification invite')
  }
  return { candidate, task }
}

function requireHeldTask(fixture: DemoScenarioFixture): Task {
  const task = fixture.tasks.find((candidate) => taskResultStatus(fixture, candidate) === 'held')
  if (task === undefined) throw new Error('Fixture is missing a held task')
  return task
}

function clarificationInvitedPayload(context: BuildContext) {
  const { candidate, task } = clarificationPair(context)
  return {
    taskId: task.taskId,
    data: {
      toolCallId: `clarification_${task.taskId}`,
      candidateId: candidate.candidateId
    }
  }
}

function clarificationRespondedPayload(context: BuildContext) {
  const { candidate, task } = clarificationPair(context)
  return {
    taskId: task.taskId,
    data: {
      candidateId: candidate.candidateId,
      outcome: 'conversation_agreed',
      taskStatus: 'held',
      requesterMessage: `${candidate.displayName}: 정보 확인 대화에 동의했습니다.`,
      isSimulation: true
    }
  }
}

function bundlesPayload(context: BuildContext) {
  const bundles = requireFixtureRecords(context.fixture.expectedBundles, 'expectedBundles')
  return {
    data: {
      bundles: bundles.map((bundle) => ({ ...bundle, requestId: context.request.requestId })),
      splitReasonCodes: [...new Set(bundles.flatMap(({ reasonCodes }) => reasonCodes))]
    }
  }
}

function assignmentsPayload(context: BuildContext) {
  const assignments = requireFixtureRecords(
    context.fixture.expectedAssignments,
    'expectedAssignments'
  )
  return {
    data: {
      assignments: assignments.map((assignment) => ({
        ...assignment,
        requestId: context.request.requestId
      }))
    }
  }
}

function candidatesPayload(context: BuildContext) {
  const task = requireItem(
    actionableTasks(context.fixture),
    context.candidateIndex,
    'candidate task'
  )
  context.candidateIndex += 1
  const candidates = context.fixture.candidates
    .filter(({ taskId }) => taskId === task.taskId)
    .map((candidate) => ({ ...candidate, requestId: context.request.requestId }))
  return {
    taskId: task.taskId,
    data: { candidates, scoringPolicyVersion: 'availability-distance-experience-reliability-v1' }
  }
}

function outreachPayload(context: BuildContext) {
  const response = requireItem(
    context.fixture.responseSequence,
    context.outreachIndex,
    'outreach response'
  )
  context.outreachIndex += 1
  return {
    taskId: response.taskId,
    data: {
      candidateId: response.candidateId,
      attempt: response.attempt,
      responseDeadlineAt: eventTime(context.request.timeWindow.startAt, response.attempt * 600),
      transport: 'simulation'
    }
  }
}

function replyPayload(context: BuildContext) {
  const response = requireItem(
    context.fixture.responseSequence,
    context.responseIndex,
    'neighbor response'
  )
  context.responseIndex += 1
  const reply = response.outcome === 'accepted' ? 'accepted' : 'rejected'
  context.lastOutcome = reply === 'rejected' ? 'rejected' : null
  return {
    taskId: response.taskId,
    data: {
      candidateId: response.candidateId,
      attempt: response.attempt,
      response: reply,
      respondedAt: eventTime(context.request.timeWindow.startAt, response.attempt * 610)
    }
  }
}

function timeoutPayload(context: BuildContext) {
  const response = requireItem(
    context.fixture.responseSequence,
    context.responseIndex,
    'timeout response'
  )
  context.responseIndex += 1
  context.lastOutcome = 'timed_out'
  return {
    taskId: response.taskId,
    data: { candidateId: response.candidateId, attempt: response.attempt, waitedMinutes: 10 }
  }
}

function planUpdatedPayload(context: BuildContext) {
  context.revision += 1
  if (context.lastOutcome === 'rejected' || context.lastOutcome === 'timed_out') {
    const timeout = context.lastOutcome === 'timed_out'
    const response = context.fixture.responseSequence[Math.max(0, context.responseIndex - 1)]
    context.lastOutcome = null
    return {
      taskId: response?.taskId,
      data: {
        revision: context.revision,
        trigger: timeout ? 'outreach_timeout' : 'candidate_rejected',
        observation: timeout
          ? '후보가 가상 10분 동안 응답하지 않았습니다.'
          : '후보가 요청을 거절했습니다.',
        previousAction: '현재 후보에게 도움을 요청했습니다.',
        nextAction: '다음 순위의 후보에게 도움을 요청합니다.',
        policyApplied: 'next_ranked_candidate',
        userInputRequired: false
      }
    }
  }

  const blocked = blockedTasks(context.fixture)[0]
  return {
    taskId: blocked?.taskId,
    data: {
      revision: context.revision,
      trigger: 'safety_block',
      observation: '의료행위 가능성이 있는 작업을 안전 정책으로 제외했습니다.',
      previousAction: '모든 작업의 안전성을 각각 확인했습니다.',
      nextAction: '안전한 문서 전달 작업만 계속 진행합니다.',
      policyApplied: 'preserve_safe_success',
      userInputRequired: false
    }
  }
}

function matchPayload(context: BuildContext) {
  const accepted = context.fixture.responseSequence.filter(({ outcome }) => outcome === 'accepted')[
    context.matchIndex
  ]
  if (accepted === undefined) throw new Error('Fixture requires an accepted response for match')
  context.matchIndex += 1
  const task = requireTask(context.fixture.tasks, accepted.taskId)
  return {
    taskId: task.taskId,
    data: {
      matchId: `match_${accepted.candidateId}`,
      candidateId: accepted.candidateId,
      scheduledWindow: task.timeWindow,
      durationMinutes: task.estimatedDurationMinutes,
      isSimulation: true
    }
  }
}

function blockedPayload(context: BuildContext) {
  const task = requireItem(blockedTasks(context.fixture), 0, 'blocked task')
  return {
    taskId: task.taskId,
    data: {
      level: 'high',
      reasonCodes: ['medication_assistance'],
      guidance: '처방약 복용 보조는 일반 이웃 매칭에서 제외되었습니다.'
    }
  }
}

function toolFailedPayload() {
  return {
    data: {
      toolName: 'fixture_tool',
      toolCallId: 'fixture_tool_call',
      errorCode: 'fixture_failure',
      retryable: false,
      attempt: 1,
      errorMessage: '도구 실행이 실패했습니다.'
    }
  }
}

function replayResult(fixture: DemoScenarioFixture, requestId: string): FinalResult {
  return {
    ...fixture.expectedFinalResult,
    requestId,
    taskResults: fixture.expectedFinalResult.taskResults.map((result) => ({ ...result })),
    executionBoundary: {
      ...fixture.expectedFinalResult.executionBoundary,
      openaiInterpretation: 'replay'
    }
  }
}

function actionableTasks(fixture: DemoScenarioFixture): readonly Task[] {
  return fixture.tasks.filter((task) => taskResultStatus(fixture, task) !== 'safety_excluded')
}

function blockedTasks(fixture: DemoScenarioFixture): readonly Task[] {
  return fixture.tasks.filter((task) => taskResultStatus(fixture, task) === 'safety_excluded')
}

function taskResultStatus(fixture: DemoScenarioFixture, task: Task) {
  return fixture.expectedFinalResult.taskResults.find(({ taskId }) => taskId === task.taskId)
    ?.status
}

function withRequestId(task: Task, requestId: string): Task {
  return { ...task, requestId }
}

function requireTask(tasks: readonly Task[], taskId: string): Task {
  const task = tasks.find((candidate) => candidate.taskId === taskId)
  if (task === undefined) throw new Error(`Fixture references missing task: ${taskId}`)
  return task
}

function requireFixtureRecords<T>(records: readonly T[] | undefined, label: string): readonly T[] {
  if (records === undefined || records.length === 0) {
    throw new Error(`Fixture is missing ${label} for a planning event`)
  }
  return records
}

function requireItem<T>(items: readonly T[], index: number, label: string): T {
  const item = items[index]
  if (item === undefined) throw new Error(`Fixture is missing ${label} at index ${index}`)
  return item
}

function eventTime(startAt: string, offsetSeconds: number): string {
  return new Date(Date.parse(startAt) + offsetSeconds * 1_000).toISOString()
}

function eventMessage(type: AgentEvent['type']): string {
  return (
    {
      'request.created': '요청을 접수했습니다.',
      'plan.created': '실행 계획을 만들었습니다.',
      'task.created': '도움 요청을 작은 작업으로 나눴습니다.',
      'safety.checked': '작업별 안전성을 확인했습니다.',
      'sufficiency.checked': '진행에 필요한 정보가 충분한지 확인했습니다.',
      'task.held': '정보가 부족한 작업을 보류했습니다.',
      'clarification.invited': '부족한 정보를 확인할 대화를 이웃에게 요청했습니다.',
      'clarification.responded': '이웃이 확인 대화 요청에 응답했습니다.',
      'bundles.planned': '한 이웃이 함께 처리할 수 있는 작업끼리 묶었습니다.',
      'assignments.planned': '묶음별로 도와줄 이웃을 배정했습니다.',
      'candidates.ranked': '조건에 맞는 이웃 후보를 정렬했습니다.',
      'bundle.candidates.ranked': '묶음을 맡을 수 있는 이웃 후보를 정렬했습니다.',
      'outreach.sent': '가장 적합한 이웃에게 도움을 요청했습니다.',
      'neighbor.replied': '이웃의 응답을 확인했습니다.',
      'outreach.timed_out': '가상 10분 동안 응답이 없어 다음 후보를 찾습니다.',
      'plan.updated': '관찰한 결과에 맞춰 다음 행동을 바꿨습니다.',
      'match.confirmed': '자발적으로 수락한 이웃과 매칭을 확정했습니다.',
      'task.blocked': '안전 정책에 따라 해당 작업만 제외했습니다.',
      'tool.failed': '도구 실행 오류를 안전하게 처리했습니다.',
      'request.completed': '요청 처리를 마쳤습니다.'
    } satisfies Record<AgentEvent['type'], string>
  )[type]
}
