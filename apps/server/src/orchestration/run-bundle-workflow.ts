import {
  AgentEventSchema,
  CandidateProfileSchema,
  FinalResultSchema,
  InitialRequestSchema,
  PlannedAssignmentSchema,
  SCHEMA_VERSION,
  TaskSchema,
  type AgentEvent,
  type Assignment,
  type CandidateProfile,
  type FinalResult,
  type PlannedAssignment,
  type Task,
  type TaskBundle,
  type TaskResult
} from '@30-minute-exchange/contracts'
import {
  buildTaskBundles,
  checkSafety,
  checkSufficiency,
  findCandidatesForBundle,
  MAX_CANDIDATE_ATTEMPTS
} from '@30-minute-exchange/decisions'
import {
  DEFAULT_OUTREACH_TIMEOUT_SECONDS,
  advanceVirtualTimeSeconds,
  sendBundleOutreach
} from '@30-minute-exchange/simulator'

import { WorkflowHookStage, type WorkflowHookEmitter } from './workflow-hooks.js'

export type BundleWorkflowTools = Readonly<{
  buildTaskBundles: typeof buildTaskBundles
  checkSafety: typeof checkSafety
  checkSufficiency: typeof checkSufficiency
  findCandidatesForBundle: typeof findCandidatesForBundle
  sendBundleOutreach: typeof sendBundleOutreach
}>

const defaultTools: BundleWorkflowTools = {
  buildTaskBundles,
  checkSafety,
  checkSufficiency,
  findCandidatesForBundle,
  sendBundleOutreach
}

export type BundleWorkflowResult = Readonly<{
  tasks: Task[]
  bundles: TaskBundle[]
  assignmentResults: Assignment[]
  events: AgentEvent[]
  finalResult: FinalResult
}>

type BundleState = {
  bundle: TaskBundle
  attemptedCandidateIds: Set<string>
  attempt: number
}

type PendingOutreach = Readonly<{
  state: BundleState
  assignment: PlannedAssignment
}>

/**
 * Runs deterministic post-decomposition workflow steps. OpenAI is deliberately
 * not used for policy, scheduling, ranking, retry, or match confirmation.
 */
export function runBundleWorkflow({
  initialRequest,
  tasks: inputTasks,
  initialEvents,
  candidateProfiles: inputCandidateProfiles,
  seed,
  occurredAt = new Date().toISOString(),
  hooks,
  onEvent,
  tools: toolOverrides = {}
}: Readonly<{
  initialRequest: unknown
  tasks: readonly unknown[]
  initialEvents: readonly unknown[]
  candidateProfiles: readonly unknown[]
  seed: string
  occurredAt?: string
  hooks?: WorkflowHookEmitter
  onEvent?: (event: AgentEvent) => void
  tools?: Partial<BundleWorkflowTools>
}>): BundleWorkflowResult {
  const tools: BundleWorkflowTools = { ...defaultTools, ...toolOverrides }
  const request = InitialRequestSchema.parse(initialRequest)
  const tasks = inputTasks.map((task) => TaskSchema.parse(task))
  const candidateProfiles = inputCandidateProfiles.map((candidate) =>
    CandidateProfileSchema.parse(candidate)
  )
  const events = initialEvents.map((event) => AgentEventSchema.parse(event))
  const runId = getRunId(tasks, events)
  validateInitialEventSequence(events, { runId, requestId: request.requestId })

  const eventLog = createEventLog({
    events,
    runId,
    requestId: request.requestId,
    occurredAt,
    ...(onEvent === undefined ? {} : { onEvent })
  })
  const taskResults = new Map<string, TaskResult>()
  const readyTasks: Task[] = []

  for (const task of tasks) {
    hooks?.emit(WorkflowHookStage.safetyCheck, 'before', { taskId: task.taskId })
    const safety = tools.checkSafety({
      schemaVersion: SCHEMA_VERSION,
      runId,
      requestId: request.requestId,
      taskId: task.taskId,
      toolCallId: `call-safety-${task.taskId}`,
      task
    })
    if (!safety.ok) {
      hooks?.emit(WorkflowHookStage.safetyCheck, 'error', {
        taskId: task.taskId,
        errorCode: safety.error.code
      })
      throw new Error(`Safety tool failed for ${task.taskId}: ${safety.error.code}`)
    }

    hooks?.emit(WorkflowHookStage.safetyCheck, 'after', {
      taskId: task.taskId,
      level: safety.data.level,
      action: safety.data.action
    })

    eventLog.append(task.taskId, 'safety.checked', { decision: safety.data }, false)

    if (safety.data.action === 'block' || safety.data.action === 'emergency_guidance') {
      taskResults.set(task.taskId, {
        taskId: task.taskId,
        status: 'safety_excluded',
        reasonCodes: [...safety.data.reasonCodes],
        userMessage: safety.data.guidance ?? 'This task cannot be matched with a neighbor.'
      })
      eventLog.append(
        task.taskId,
        'task.blocked',
        {
          level: safety.data.level,
          reasonCodes: [...safety.data.reasonCodes],
          guidance: safety.data.guidance ?? 'This task cannot be matched with a neighbor.'
        },
        false
      )
      continue
    }

    if (safety.data.action === 'verify_conditions') {
      holdTask({
        eventLog,
        task,
        taskResults,
        reasonCodes: [...safety.data.reasonCodes, 'safety_conditions_unverified'],
        guidance: 'Required safety conditions could not be verified automatically.'
      })
      continue
    }

    hooks?.emit(WorkflowHookStage.sufficiencyCheck, 'before', { taskId: task.taskId })
    const sufficiency = tools.checkSufficiency({
      schemaVersion: SCHEMA_VERSION,
      runId,
      requestId: request.requestId,
      taskId: task.taskId,
      toolCallId: `call-sufficiency-${task.taskId}`,
      task,
      availableFacts: []
    })
    if (!sufficiency.ok) {
      hooks?.emit(WorkflowHookStage.sufficiencyCheck, 'error', {
        taskId: task.taskId,
        errorCode: sufficiency.error.code
      })
      throw new Error(`Sufficiency tool failed for ${task.taskId}: ${sufficiency.error.code}`)
    }

    hooks?.emit(WorkflowHookStage.sufficiencyCheck, 'after', {
      taskId: task.taskId,
      status: sufficiency.data.status,
      action: sufficiency.data.action
    })

    eventLog.append(task.taskId, 'sufficiency.checked', { decision: sufficiency.data }, false)
    if (sufficiency.data.action === 'hold') {
      holdTask({
        eventLog,
        task,
        taskResults,
        reasonCodes: [...sufficiency.data.reasonCodes],
        guidance: sufficiency.data.guidance ?? 'Required information is unavailable.',
        missingInformation: sufficiency.data.missingInformation
      })
      continue
    }

    readyTasks.push(TaskSchema.parse({ ...task, status: 'ready', missingInformation: [] }))
  }

  const assignmentResults: Assignment[] = []
  const bundles: TaskBundle[] = []
  if (readyTasks.length > 0) {
    hooks?.emit(WorkflowHookStage.bundlePlanning, 'before', {
      readyTaskIds: readyTasks.map((task) => task.taskId)
    })
    const bundlePlan = tools.buildTaskBundles({
      schemaVersion: SCHEMA_VERSION,
      runId,
      requestId: request.requestId,
      toolCallId: 'call-build-task-bundles',
      tasks: readyTasks
    })
    if (!bundlePlan.ok) {
      hooks?.emit(WorkflowHookStage.bundlePlanning, 'error', {
        errorCode: bundlePlan.error.code
      })
      throw new Error(`Bundle scheduler failed: ${bundlePlan.error.code}`)
    }

    hooks?.emit(WorkflowHookStage.bundlePlanning, 'after', {
      bundleIds: bundlePlan.data.bundles.map((bundle) => bundle.bundleId),
      heldTaskIds: bundlePlan.data.heldTaskIds
    })

    bundles.push(...bundlePlan.data.bundles)
    for (const taskId of bundlePlan.data.heldTaskIds) {
      const task = readyTasks.find((candidate) => candidate.taskId === taskId)
      if (task !== undefined) {
        holdTask({
          eventLog,
          task,
          taskResults,
          reasonCodes: ['task_schedule_metadata_missing'],
          guidance: 'The task schedule could not be determined safely.',
          missingInformation: [
            {
              code: 'task_schedule_metadata',
              message: 'The task needs a usable time and duration.'
            }
          ]
        })
      }
    }

    if (bundles.length > 0) {
      eventLog.append(
        undefined,
        'bundles.planned',
        { bundles, splitReasonCodes: [...bundlePlan.data.splitReasonCodes] },
        true
      )
      runCandidateOutreach({
        bundles,
        runId,
        requestId: request.requestId,
        candidateProfiles,
        seed,
        eventLog,
        taskResults,
        assignmentResults,
        tools,
        ...(hooks === undefined ? {} : { hooks })
      })
    }
  }

  const finalResult = createFinalResult({
    runId,
    requestId: request.requestId,
    tasks,
    taskResults,
    assignmentResults,
    completedAt: occurredAt
  })
  hooks?.emit(WorkflowHookStage.finalOutput, 'after', {
    status: finalResult.status,
    taskResultCount: finalResult.taskResults.length,
    assignmentResultCount: assignmentResults.length
  })
  eventLog.append(undefined, 'request.completed', { result: finalResult }, true)

  return {
    tasks,
    bundles,
    assignmentResults,
    events: eventLog.events,
    finalResult
  }
}

function runCandidateOutreach({
  bundles,
  runId,
  requestId,
  candidateProfiles,
  seed,
  eventLog,
  taskResults,
  assignmentResults,
  tools,
  hooks
}: Readonly<{
  bundles: readonly TaskBundle[]
  runId: string
  requestId: string
  candidateProfiles: readonly CandidateProfile[]
  seed: string
  eventLog: ReturnType<typeof createEventLog>
  taskResults: Map<string, TaskResult>
  assignmentResults: Assignment[]
  tools: BundleWorkflowTools
  hooks?: WorkflowHookEmitter
}>): void {
  const pending = bundles.map<BundleState>((bundle) => ({
    bundle,
    attemptedCandidateIds: new Set(),
    attempt: 0
  }))
  const reservations: PlannedAssignment[] = []

  while (pending.length > 0) {
    const round: PendingOutreach[] = []

    for (const state of [...pending]) {
      hooks?.emit(WorkflowHookStage.candidateSearch, 'before', {
        bundleId: state.bundle.bundleId,
        attempt: state.attempt + 1
      })
      const candidateResult = tools.findCandidatesForBundle({
        schemaVersion: SCHEMA_VERSION,
        runId,
        requestId,
        toolCallId: `call-find-candidates-${state.bundle.bundleId}-${state.attempt + 1}`,
        bundle: state.bundle,
        candidateProfiles: [...candidateProfiles],
        plannedAssignments: reservations
      })
      if (!candidateResult.ok) {
        hooks?.emit(WorkflowHookStage.candidateSearch, 'error', {
          bundleId: state.bundle.bundleId,
          attempt: state.attempt + 1,
          errorCode: candidateResult.error.code
        })
        appendToolFailure({
          eventLog,
          toolName: 'find_candidates_for_bundle',
          toolCallId: candidateResult.toolCallId,
          error: candidateResult.error,
          attempt: state.attempt + 1
        })
        markBundleUnmatched({
          state,
          taskResults,
          eventLog,
          reasonCode: candidateResult.error.code,
          observation: 'Candidate search failed.',
          isToolFailure: true
        })
        removePending(pending, state)
        continue
      }

      hooks?.emit(WorkflowHookStage.candidateSearch, 'after', {
        bundleId: state.bundle.bundleId,
        candidateIds: candidateResult.data.candidates.map((candidate) => candidate.candidateId),
        excludedCount: candidateResult.data.excludedCount
      })

      eventLog.append(
        undefined,
        'bundle.candidates.ranked',
        {
          bundleId: state.bundle.bundleId,
          candidates: candidateResult.data.candidates,
          scoringPolicyVersion: candidateResult.data.rankingPolicyVersion
        },
        true
      )

      const nextCandidate = candidateResult.data.candidates.find(
        ({ candidateId }) => !state.attemptedCandidateIds.has(candidateId)
      )
      if (nextCandidate === undefined) {
        markBundleUnmatched({
          state,
          taskResults,
          eventLog,
          reasonCode: 'eligible_candidates_exhausted',
          observation: 'No eligible candidate remains for this bundle.'
        })
        removePending(pending, state)
        continue
      }

      state.attempt += 1
      state.attemptedCandidateIds.add(nextCandidate.candidateId)
      const assignment = PlannedAssignmentSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        runId,
        requestId,
        assignmentId: `assignment-${state.bundle.bundleId}-${state.attempt}`,
        bundleId: state.bundle.bundleId,
        candidateId: nextCandidate.candidateId,
        taskIds: [...state.bundle.taskIds],
        scheduledWindow: state.bundle.scheduledWindow,
        attempt: state.attempt,
        status: 'planned',
        isSimulation: true
      })
      reservations.push(assignment)
      eventLog.append(undefined, 'assignments.planned', { assignments: [assignment] }, true)
      for (const taskId of assignment.taskIds) {
        eventLog.append(
          taskId,
          'outreach.sent',
          {
            assignmentId: assignment.assignmentId,
            candidateId: assignment.candidateId,
            attempt: assignment.attempt,
            responseDeadlineAt: advanceVirtualTimeSeconds(
              assignment.scheduledWindow.startAt,
              DEFAULT_OUTREACH_TIMEOUT_SECONDS
            ),
            transport: 'simulation'
          },
          true
        )
      }
      round.push({ state, assignment })
    }

    for (const outreach of round) {
      hooks?.emit(WorkflowHookStage.outreach, 'before', {
        bundleId: outreach.state.bundle.bundleId,
        assignmentId: outreach.assignment.assignmentId,
        candidateId: outreach.assignment.candidateId,
        attempt: outreach.assignment.attempt,
        timeoutSeconds: DEFAULT_OUTREACH_TIMEOUT_SECONDS
      })
      const outreachResult = tools.sendBundleOutreach({
        schemaVersion: SCHEMA_VERSION,
        runId,
        requestId,
        toolCallId: `call-send-outreach-${outreach.assignment.assignmentId}`,
        assignment: outreach.assignment,
        bundle: outreach.state.bundle,
        timeoutSeconds: DEFAULT_OUTREACH_TIMEOUT_SECONDS,
        seed
      })
      if (!outreachResult.ok) {
        hooks?.emit(WorkflowHookStage.outreach, 'error', {
          bundleId: outreach.state.bundle.bundleId,
          assignmentId: outreach.assignment.assignmentId,
          errorCode: outreachResult.error.code
        })
        appendToolFailure({
          eventLog,
          toolName: 'send_bundle_outreach',
          toolCallId: outreachResult.toolCallId,
          error: outreachResult.error,
          attempt: outreach.assignment.attempt
        })
        removeReservation(reservations, outreach.assignment.assignmentId)
        markBundleUnmatched({
          state: outreach.state,
          taskResults,
          eventLog,
          reasonCode: outreachResult.error.code,
          observation: 'Outreach delivery failed.',
          isToolFailure: true
        })
        removePending(pending, outreach.state)
        continue
      }

      const outcome = outreachResult.data.outcome
      hooks?.emit(WorkflowHookStage.outreach, 'after', {
        bundleId: outreach.state.bundle.bundleId,
        assignmentId: outreach.assignment.assignmentId,
        candidateId: outreach.assignment.candidateId,
        outcome,
        virtualElapsedSeconds: outreachResult.data.virtualElapsedSeconds
      })
      assignmentResults.push({ ...outreach.assignment, status: outcome })
      if (outcome === 'accepted') {
        hooks?.emit(WorkflowHookStage.matchConfirmation, 'before', {
          bundleId: outreach.state.bundle.bundleId,
          assignmentId: outreach.assignment.assignmentId,
          candidateId: outreach.assignment.candidateId
        })
        confirmBundleMatch({
          state: outreach.state,
          assignment: outreach.assignment,
          taskResults,
          eventLog
        })
        hooks?.emit(WorkflowHookStage.matchConfirmation, 'after', {
          bundleId: outreach.state.bundle.bundleId,
          assignmentId: outreach.assignment.assignmentId,
          status: 'confirmed'
        })
        removePending(pending, outreach.state)
        continue
      }

      removeReservation(reservations, outreach.assignment.assignmentId)
      for (const taskId of outreach.assignment.taskIds) {
        if (outcome === 'timed_out') {
          eventLog.append(
            taskId,
            'outreach.timed_out',
            {
              assignmentId: outreach.assignment.assignmentId,
              candidateId: outreach.assignment.candidateId,
              attempt: outreach.assignment.attempt,
              waitedSeconds: DEFAULT_OUTREACH_TIMEOUT_SECONDS
            },
            true
          )
        } else {
          eventLog.append(
            taskId,
            'neighbor.replied',
            {
              assignmentId: outreach.assignment.assignmentId,
              candidateId: outreach.assignment.candidateId,
              attempt: outreach.assignment.attempt,
              response: outcome,
              respondedAt:
                outreachResult.data.respondedAt ?? outreach.assignment.scheduledWindow.startAt
            },
            true
          )
        }
      }

      if (outreach.state.attempt >= MAX_CANDIDATE_ATTEMPTS) {
        markBundleUnmatched({
          state: outreach.state,
          taskResults,
          eventLog,
          reasonCode: 'candidate_attempt_limit_reached',
          observation: 'The initial candidate and one retry did not accept this bundle.'
        })
        removePending(pending, outreach.state)
      } else {
        appendPlanUpdate({
          eventLog,
          taskIds: outreach.assignment.taskIds,
          trigger: outcome === 'timed_out' ? 'outreach_timeout' : 'candidate_rejected',
          observation: `Candidate ${outreach.assignment.candidateId} ${outcome}.`,
          previousAction: 'Wait for the assigned candidate response.',
          nextAction: 'Offer the bundle to the next ranked candidate.',
          policyApplied: 'next_ranked_candidate'
        })
      }
    }
  }
}

function confirmBundleMatch({
  state,
  assignment,
  taskResults,
  eventLog
}: Readonly<{
  state: BundleState
  assignment: PlannedAssignment
  taskResults: Map<string, TaskResult>
  eventLog: ReturnType<typeof createEventLog>
}>): void {
  for (const taskId of assignment.taskIds) {
    taskResults.set(taskId, {
      taskId,
      status: 'matched',
      matchedCandidateId: assignment.candidateId,
      assignmentId: assignment.assignmentId,
      reasonCodes: ['candidate_accepted_bundle_assignment'],
      userMessage: 'A neighbor accepted the planned help.'
    })
    eventLog.append(
      taskId,
      'neighbor.replied',
      {
        assignmentId: assignment.assignmentId,
        candidateId: assignment.candidateId,
        attempt: assignment.attempt,
        response: 'accepted',
        respondedAt: assignment.scheduledWindow.startAt
      },
      true
    )
    eventLog.append(
      taskId,
      'match.confirmed',
      {
        matchId: `match-${state.bundle.bundleId}`,
        assignmentId: assignment.assignmentId,
        candidateId: assignment.candidateId,
        scheduledWindow: assignment.scheduledWindow,
        durationMinutes: state.bundle.totalActivityDurationMinutes,
        isSimulation: true
      },
      true
    )
  }
}

function markBundleUnmatched({
  state,
  taskResults,
  eventLog,
  reasonCode,
  observation,
  isToolFailure = false
}: Readonly<{
  state: BundleState
  taskResults: Map<string, TaskResult>
  eventLog: ReturnType<typeof createEventLog>
  reasonCode: string
  observation: string
  isToolFailure?: boolean
}>): void {
  for (const taskId of state.bundle.taskIds) {
    taskResults.set(taskId, {
      taskId,
      status: 'unmatched',
      reasonCodes: [reasonCode],
      userMessage: 'No eligible neighbor accepted this bundle in the configured attempts.'
    })
  }
  appendPlanUpdate({
    eventLog,
    taskIds: state.bundle.taskIds,
    trigger: isToolFailure ? 'tool_failure' : 'candidates_exhausted',
    observation,
    previousAction: 'Find or contact an eligible candidate.',
    nextAction: 'Complete this bundle as unmatched while other bundles continue.',
    policyApplied: isToolFailure ? 'bounded_tool_failure' : 'preserve_safe_success'
  })
}

function holdTask({
  eventLog,
  task,
  taskResults,
  reasonCodes,
  guidance,
  missingInformation = [
    {
      code: 'safety_condition_verification',
      message: 'A required safety condition could not be verified.'
    }
  ]
}: Readonly<{
  eventLog: ReturnType<typeof createEventLog>
  task: Task
  taskResults: Map<string, TaskResult>
  reasonCodes: readonly string[]
  guidance: string
  missingInformation?: readonly { code: string; message: string }[]
}>): void {
  taskResults.set(task.taskId, {
    taskId: task.taskId,
    status: 'held',
    reasonCodes: [...reasonCodes],
    userMessage: guidance
  })
  eventLog.append(
    task.taskId,
    'task.held',
    { reasonCodes: [...reasonCodes], missingInformation: [...missingInformation], guidance },
    false
  )
}

function appendPlanUpdate({
  eventLog,
  taskIds,
  trigger,
  observation,
  previousAction,
  nextAction,
  policyApplied
}: Readonly<{
  eventLog: ReturnType<typeof createEventLog>
  taskIds: readonly string[]
  trigger: 'candidate_rejected' | 'outreach_timeout' | 'candidates_exhausted' | 'tool_failure'
  observation: string
  previousAction: string
  nextAction: string
  policyApplied: 'next_ranked_candidate' | 'preserve_safe_success' | 'bounded_tool_failure'
}>): void {
  const revision = eventLog.nextRevision()
  for (const taskId of taskIds) {
    eventLog.append(
      taskId,
      'plan.updated',
      {
        revision,
        trigger,
        observation,
        previousAction,
        nextAction,
        policyApplied,
        userInputRequired: false
      },
      true
    )
  }
}

function appendToolFailure({
  eventLog,
  toolName,
  toolCallId,
  error,
  attempt
}: Readonly<{
  eventLog: ReturnType<typeof createEventLog>
  toolName: string
  toolCallId: string
  error: Readonly<{ code: string; message: string; retryable: boolean }>
  attempt: number
}>): void {
  eventLog.append(
    undefined,
    'tool.failed',
    {
      toolName,
      toolCallId,
      errorCode: error.code,
      retryable: error.retryable,
      attempt,
      errorMessage: error.message
    },
    true
  )
}

function createFinalResult({
  runId,
  requestId,
  tasks,
  taskResults,
  assignmentResults,
  completedAt
}: Readonly<{
  runId: string
  requestId: string
  tasks: readonly Task[]
  taskResults: ReadonlyMap<string, TaskResult>
  assignmentResults: readonly Assignment[]
  completedAt: string
}>): FinalResult {
  const resolvedTaskResults = tasks.map(
    (task) =>
      taskResults.get(task.taskId) ?? {
        taskId: task.taskId,
        status: 'unmatched' as const,
        reasonCodes: ['task_not_scheduled'],
        userMessage: 'This task could not be scheduled.'
      }
  )
  const matchedCount = resolvedTaskResults.filter(({ status }) => status === 'matched').length
  const safetyExcludedCount = resolvedTaskResults.filter(
    ({ status }) => status === 'safety_excluded'
  ).length
  const status =
    matchedCount === resolvedTaskResults.length
      ? 'fully_matched'
      : matchedCount > 0
        ? 'partially_matched'
        : safetyExcludedCount === resolvedTaskResults.length
          ? 'safety_excluded'
          : 'unmatched'

  return FinalResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    runId,
    requestId,
    status,
    taskResults: resolvedTaskResults,
    assignmentResults: [...assignmentResults],
    userMessage:
      status === 'fully_matched'
        ? 'All planned tasks have an accepting neighbor.'
        : 'This is the current execution outcome; unmatched or held tasks remain separate from completed ones.',
    completedAt,
    simulatedComponents: ['outreach', 'neighbor_response'],
    executionBoundary: {
      openaiInterpretation: 'live',
      safetyPolicy: 'deterministic',
      candidateRanking: 'deterministic',
      outreach: 'simulation',
      neighborResponse: 'simulation',
      matchConfirmation: 'simulation'
    }
  })
}

function createEventLog({
  events,
  runId,
  requestId,
  occurredAt,
  onEvent
}: Readonly<{
  events: AgentEvent[]
  runId: string
  requestId: string
  occurredAt: string
  onEvent?: (event: AgentEvent) => void
}>) {
  let revision = 1
  const append = (
    taskId: string | undefined,
    type: string,
    data: unknown,
    isSimulation: boolean
  ): void => {
    const sequence = events.length + 1
    const event = AgentEventSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      eventId: `${runId}-event-${sequence}`,
      runId,
      requestId,
      ...(taskId === undefined ? {} : { taskId }),
      sequence,
      occurredAt,
      message: `Workflow event: ${type}`,
      isSimulation,
      type,
      data
    })
    events.push(event)
    onEvent?.(event)
  }

  return {
    events,
    append,
    nextRevision: () => {
      revision += 1
      return revision
    }
  }
}

function getRunId(tasks: readonly Task[], events: readonly AgentEvent[]): string {
  const runId = tasks[0]?.runId ?? events[0]?.runId
  if (runId === undefined || tasks.some((task) => task.runId !== runId)) {
    throw new Error('Tasks must share a runId before bundle workflow execution')
  }
  return runId
}

function validateInitialEventSequence(
  events: readonly AgentEvent[],
  context: Readonly<{ runId: string; requestId: string }>
): void {
  if (events.length === 0) throw new Error('Initial decomposition events are required')
  for (const [index, event] of events.entries()) {
    if (
      event.runId !== context.runId ||
      event.requestId !== context.requestId ||
      event.sequence !== index + 1
    ) {
      throw new Error('Initial events must have matching context and contiguous sequences')
    }
  }
}

function removePending(pending: BundleState[], state: BundleState): void {
  const index = pending.indexOf(state)
  if (index >= 0) pending.splice(index, 1)
}

function removeReservation(reservations: PlannedAssignment[], assignmentId: string): void {
  const index = reservations.findIndex((assignment) => assignment.assignmentId === assignmentId)
  if (index >= 0) reservations.splice(index, 1)
}
