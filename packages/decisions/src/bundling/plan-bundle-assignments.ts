import {
  AssignmentSchema,
  BuildTaskBundlesCallSchema,
  BuildTaskBundlesResultSchema,
  MAX_BUNDLE_ACTIVITY_DURATION_MINUTES,
  MAX_BUNDLE_WAITING_MINUTES,
  TaskBundleSchema,
  type Assignment,
  type BuildTaskBundlesCall,
  type BuildTaskBundlesResult,
  type CandidateProfile,
  type Task,
  type TaskBundle,
  type TimeWindow
} from '@30-minute-exchange/contracts'

const MINUTE_MS = 60_000

type ScheduledTask = Readonly<{
  task: Task
  startAt: number
  endAt: number
}>

type Schedule = Readonly<{
  scheduledTasks: readonly ScheduledTask[]
  totalActivityDurationMinutes: number
  waitingMinutes: number
  scheduledWindow: TimeWindow
}>

export type BundleAssignmentPlan = Readonly<{
  bundles: readonly TaskBundle[]
  assignments: readonly Assignment[]
  unassignedTaskIds: readonly string[]
  splitReasonCodes: readonly string[]
}>

/**
 * Creates schedule-feasible bundles from safety- and sufficiency-cleared tasks.
 * Candidate selection intentionally belongs to the following orchestration step.
 */
export function buildTaskBundles(input: BuildTaskBundlesCall): BuildTaskBundlesResult {
  const call = BuildTaskBundlesCallSchema.parse(input)
  const plan = planReadyTaskBundles(call.tasks)

  return BuildTaskBundlesResultSchema.parse({
    schemaVersion: call.schemaVersion,
    runId: call.runId,
    requestId: call.requestId,
    toolCallId: call.toolCallId,
    ok: true,
    data: {
      processedTaskIds: call.tasks.map((task) => task.taskId),
      bundles: plan.bundles,
      heldTaskIds: plan.heldTaskIds,
      splitReasonCodes: plan.splitReasonCodes
    }
  })
}

export function planBundleAssignments({
  tasks,
  candidateProfiles
}: Readonly<{
  tasks: readonly Task[]
  candidateProfiles: readonly CandidateProfile[]
}>): BundleAssignmentPlan {
  const sortedTasks = [...tasks].sort(compareTasks)
  const context = getSharedContext(sortedTasks)
  if (context === null) {
    throw new Error('Tasks must share runId and requestId before bundle planning')
  }

  const readyTasks = sortedTasks.filter((task) => task.status === 'ready')
  const tasksNotReady = sortedTasks.filter((task) => task.status !== 'ready')
  const tasksWithSchedulingMetadata = readyTasks.filter(hasSchedulingMetadata)
  const tasksMissingSchedulingMetadata = readyTasks.filter((task) => !hasSchedulingMetadata(task))
  const initial = createBundles(tasksWithSchedulingMetadata, context)
  const resolved = resolveAssignments({
    bundles: initial.bundles,
    tasksById: new Map(sortedTasks.map((task) => [task.taskId, task])),
    candidateProfiles,
    initialAssignments: [],
    context
  })

  return {
    bundles: resolved.bundles,
    assignments: resolved.assignments,
    unassignedTaskIds: unique([
      ...tasksMissingSchedulingMetadata.map((task) => task.taskId),
      ...tasksNotReady.map((task) => task.taskId),
      ...initial.unassignedTaskIds,
      ...resolved.unassignedTaskIds
    ]),
    splitReasonCodes: unique([
      ...(tasksMissingSchedulingMetadata.length > 0 ? ['task_schedule_metadata_missing'] : []),
      ...(tasksNotReady.length > 0 ? ['task_not_ready_for_assignment'] : []),
      ...initial.splitReasonCodes,
      ...resolved.splitReasonCodes
    ])
  }
}

function createBundles(
  tasks: readonly Task[],
  context: Readonly<{ runId: string; requestId: string }>
): Readonly<{
  bundles: readonly TaskBundle[]
  unassignedTaskIds: readonly string[]
  splitReasonCodes: readonly string[]
}> {
  const remaining = [...tasks]
  const bundles: TaskBundle[] = []
  const unassignedTaskIds: string[] = []
  const splitReasonCodes: string[] = []

  while (remaining.length > 0) {
    const firstTask = remaining.shift()
    if (firstTask === undefined) break

    let groupedTasks = [firstTask]
    let candidateIndex = 0
    while (candidateIndex < remaining.length) {
      const candidateTask = remaining[candidateIndex]
      if (candidateTask === undefined) break
      const attempted = scheduleTasks([...groupedTasks, candidateTask])

      if (attempted !== null) {
        groupedTasks = [...groupedTasks, candidateTask]
        remaining.splice(candidateIndex, 1)
        continue
      }

      splitReasonCodes.push(determineSplitReason([...groupedTasks, candidateTask]))
      candidateIndex += 1
    }

    const schedule = scheduleTasks(groupedTasks)
    if (schedule === null) {
      splitReasonCodes.push('task_window_cannot_fit_estimated_duration')
      unassignedTaskIds.push(...groupedTasks.map((task) => task.taskId))
      continue
    }

    bundles.push(createBundle(groupedTasks, schedule, context))
  }

  return { bundles, unassignedTaskIds, splitReasonCodes }
}

function planReadyTaskBundles(tasks: readonly Task[]): Readonly<{
  bundles: readonly TaskBundle[]
  heldTaskIds: readonly string[]
  splitReasonCodes: readonly string[]
}> {
  if (tasks.some((task) => task.status !== 'ready')) {
    throw new RangeError('Only ready tasks may enter deterministic task bundling')
  }

  const sortedTasks = [...tasks].sort(compareTasks)
  const context = getSharedContext(sortedTasks)
  if (context === null) {
    throw new Error('Tasks must share runId and requestId before bundle planning')
  }

  const tasksWithSchedulingMetadata = sortedTasks.filter(hasSchedulingMetadata)
  const tasksMissingSchedulingMetadata = sortedTasks.filter((task) => !hasSchedulingMetadata(task))
  const planned = createBundles(tasksWithSchedulingMetadata, context)

  return {
    bundles: planned.bundles,
    heldTaskIds: unique([
      ...tasksMissingSchedulingMetadata.map((task) => task.taskId),
      ...planned.unassignedTaskIds
    ]),
    splitReasonCodes: unique([
      ...(tasksMissingSchedulingMetadata.length > 0 ? ['task_schedule_metadata_missing'] : []),
      ...planned.splitReasonCodes
    ])
  }
}

function resolveAssignments({
  bundles,
  tasksById,
  candidateProfiles,
  initialAssignments,
  context
}: Readonly<{
  bundles: readonly TaskBundle[]
  tasksById: ReadonlyMap<string, Task>
  candidateProfiles: readonly CandidateProfile[]
  initialAssignments: readonly Assignment[]
  context: Readonly<{ runId: string; requestId: string }>
}>): BundleAssignmentPlan {
  const resolvedBundles: TaskBundle[] = []
  const assignments = [...initialAssignments]
  const unassignedTaskIds: string[] = []
  const splitReasonCodes: string[] = []

  for (const bundle of bundles) {
    const candidate = selectCandidate(bundle, tasksById, candidateProfiles, assignments)

    if (candidate !== null) {
      const scheduledBundle = TaskBundleSchema.parse({
        ...bundle,
        scheduledWindow: candidate.schedule.scheduledWindow,
        waitingMinutes: candidate.schedule.waitingMinutes
      })
      const assignment = AssignmentSchema.parse({
        schemaVersion: scheduledBundle.schemaVersion,
        runId: scheduledBundle.runId,
        requestId: scheduledBundle.requestId,
        assignmentId: `assignment_${assignments.length + 1}`,
        bundleId: scheduledBundle.bundleId,
        candidateId: candidate.profile.candidateId,
        taskIds: [...scheduledBundle.taskIds],
        scheduledWindow: scheduledBundle.scheduledWindow,
        isSimulation: candidate.profile.isSimulation
      })
      resolvedBundles.push(scheduledBundle)
      assignments.push(assignment)
      continue
    }

    if (bundle.taskIds.length > 1) {
      const individualBundles = bundle.taskIds.flatMap((taskId) => {
        const task = tasksById.get(taskId)
        if (task === undefined) return []
        const schedule = scheduleTasks([task])
        if (schedule === null) return []
        return [createBundle([task], schedule, context)]
      })
      const split = resolveAssignments({
        bundles: individualBundles,
        tasksById,
        candidateProfiles,
        initialAssignments: assignments,
        context
      })
      resolvedBundles.push(...split.bundles)
      assignments.splice(0, assignments.length, ...split.assignments)
      unassignedTaskIds.push(...split.unassignedTaskIds)
      splitReasonCodes.push('no_single_candidate_for_bundle', ...split.splitReasonCodes)
      continue
    }

    resolvedBundles.push(bundle)
    unassignedTaskIds.push(...bundle.taskIds)
  }

  return {
    bundles: resolvedBundles,
    assignments,
    unassignedTaskIds: unique(unassignedTaskIds),
    splitReasonCodes: unique(splitReasonCodes)
  }
}

function createBundle(
  tasks: readonly Task[],
  schedule: Schedule,
  context: Readonly<{ runId: string; requestId: string }>
): TaskBundle {
  return TaskBundleSchema.parse({
    schemaVersion: tasks[0]?.schemaVersion,
    runId: context.runId,
    requestId: context.requestId,
    bundleId: `bundle_${createBundleKey(tasks.map((task) => task.taskId))}`,
    taskIds: tasks.map((task) => task.taskId),
    scheduledWindow: schedule.scheduledWindow,
    totalActivityDurationMinutes: schedule.totalActivityDurationMinutes,
    waitingMinutes: schedule.waitingMinutes,
    requiredExperience: unique(tasks.flatMap((task) => task.requiredExperience)),
    reasonCodes:
      tasks.length === 1
        ? ['single_task_bundle']
        : ['within_helper_duration_limit', 'within_waiting_time_limit']
  })
}

function scheduleTasks(tasks: readonly Task[], minimumStartAt?: number): Schedule | null {
  const sortedTasks = [...tasks].sort(compareTasks)
  const scheduledTasks: ScheduledTask[] = []
  let previousEndAt: number | null = null
  let totalActivityDurationMinutes = 0
  let waitingMinutes = 0

  for (const task of sortedTasks) {
    const windowStartAt = Date.parse(task.timeWindow.startAt)
    const windowEndAt = Date.parse(task.timeWindow.endAt)
    const durationMs = task.estimatedDurationMinutes * MINUTE_MS
    const isFlexible = task.timeCertainty === 'flexible'
    const startAt: number = isFlexible
      ? Math.max(windowStartAt, previousEndAt ?? windowStartAt, minimumStartAt ?? windowStartAt)
      : windowStartAt
    const endAt: number = startAt + durationMs

    if (previousEndAt !== null && startAt < previousEndAt) return null
    if (endAt > windowEndAt) return null

    if (previousEndAt !== null) {
      waitingMinutes += Math.round((startAt - previousEndAt) / MINUTE_MS)
    }
    totalActivityDurationMinutes += task.estimatedDurationMinutes
    scheduledTasks.push({ task, startAt, endAt })
    previousEndAt = endAt
  }

  const first = scheduledTasks[0]
  const last = scheduledTasks.at(-1)
  if (first === undefined || last === undefined) return null
  if (totalActivityDurationMinutes > MAX_BUNDLE_ACTIVITY_DURATION_MINUTES) return null
  if (waitingMinutes > MAX_BUNDLE_WAITING_MINUTES) return null

  return {
    scheduledTasks,
    totalActivityDurationMinutes,
    waitingMinutes,
    scheduledWindow: {
      startAt: new Date(first.startAt).toISOString(),
      endAt: new Date(last.endAt).toISOString()
    }
  }
}

function determineSplitReason(tasks: readonly Task[]): string {
  const totalDuration = tasks.reduce((total, task) => total + task.estimatedDurationMinutes, 0)
  if (totalDuration > MAX_BUNDLE_ACTIVITY_DURATION_MINUTES) {
    return 'helper_duration_exceeds_thirty_minutes'
  }

  const sortedTasks = [...tasks].sort(compareTasks)
  const previous = sortedTasks.at(-2)
  const next = sortedTasks.at(-1)
  if (previous !== undefined && next !== undefined) {
    const previousEndAt =
      Date.parse(previous.timeWindow.startAt) + previous.estimatedDurationMinutes * MINUTE_MS
    const nextStartAt = Date.parse(next.timeWindow.startAt)
    if (nextStartAt - previousEndAt > MAX_BUNDLE_WAITING_MINUTES * MINUTE_MS) {
      return 'waiting_time_exceeds_twenty_minutes'
    }
  }

  return 'task_windows_do_not_align'
}

function selectCandidate(
  bundle: TaskBundle,
  tasksById: ReadonlyMap<string, Task>,
  candidateProfiles: readonly CandidateProfile[],
  assignments: readonly Assignment[]
): Readonly<{ profile: CandidateProfile; schedule: Schedule }> | null {
  const tasks = bundle.taskIds.flatMap((taskId) => {
    const task = tasksById.get(taskId)
    return task === undefined ? [] : [task]
  })
  if (tasks.length !== bundle.taskIds.length) return null

  const eligible = candidateProfiles.flatMap((candidate) => {
    const hasExperience = bundle.requiredExperience.every((requirement) =>
      candidate.experienceTags.includes(requirement)
    )
    if (!hasExperience) return []

    const existingCommitments = [
      ...(candidate.scheduledCommitments ?? []),
      ...assignments
        .filter((assignment) => assignment.candidateId === candidate.candidateId)
        .map((assignment) => assignment.scheduledWindow)
    ]

    return candidate.availabilityWindows.flatMap((availabilityWindow) => {
      const schedule = scheduleTasks(tasks, Date.parse(availabilityWindow.startAt))
      if (schedule === null || !containsWindow(availabilityWindow, schedule.scheduledWindow))
        return []
      if (
        existingCommitments.some((commitment) =>
          windowsOverlap(commitment, schedule.scheduledWindow)
        )
      ) {
        return []
      }
      return [{ profile: candidate, schedule }]
    })
  })

  return (
    [...eligible].sort(
      (left, right) =>
        right.profile.reliabilityRate - left.profile.reliabilityRate ||
        left.profile.candidateId.localeCompare(right.profile.candidateId)
    )[0] ?? null
  )
}

function containsWindow(outer: TimeWindow, inner: TimeWindow): boolean {
  return (
    Date.parse(outer.startAt) <= Date.parse(inner.startAt) &&
    Date.parse(outer.endAt) >= Date.parse(inner.endAt)
  )
}

function windowsOverlap(left: TimeWindow, right: TimeWindow): boolean {
  return (
    Date.parse(left.startAt) < Date.parse(right.endAt) &&
    Date.parse(right.startAt) < Date.parse(left.endAt)
  )
}

function compareTasks(left: Task, right: Task): number {
  return (
    Date.parse(left.timeWindow.startAt) - Date.parse(right.timeWindow.startAt) ||
    left.taskId.localeCompare(right.taskId)
  )
}

function getSharedContext(
  tasks: readonly Task[]
): Readonly<{ runId: string; requestId: string }> | null {
  const first = tasks[0]
  if (first === undefined) return null
  const isShared = tasks.every(
    (task) => task.runId === first.runId && task.requestId === first.requestId
  )
  return isShared ? { runId: first.runId, requestId: first.requestId } : null
}

function hasSchedulingMetadata(task: Task): boolean {
  return (
    task.durationSource !== undefined &&
    task.timeSource !== undefined &&
    task.timeCertainty !== undefined
  )
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function createBundleKey(taskIds: readonly string[]): string {
  let hash = 2_166_136_261
  for (const taskId of taskIds) {
    for (const character of taskId) {
      hash ^= character.charCodeAt(0)
      hash = Math.imul(hash, 16_777_619)
    }
  }
  return (hash >>> 0).toString(36)
}
