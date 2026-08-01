import {
  AssignmentSchema,
  MAX_BUNDLE_ACTIVITY_DURATION_MINUTES,
  MAX_BUNDLE_WAITING_MINUTES,
  TaskBundleSchema,
  type Assignment,
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

type ScheduleFailureReason =
  | 'helper_duration_exceeds_thirty_minutes'
  | 'waiting_time_exceeds_twenty_minutes'
  | 'task_windows_do_not_align'
  | 'task_window_cannot_fit_estimated_duration'

type ScheduleAttempt =
  | Readonly<{ ok: true; schedule: Schedule }>
  | Readonly<{ ok: false; reasonCode: ScheduleFailureReason }>

export type BundleAssignmentPlan = Readonly<{
  bundles: readonly TaskBundle[]
  assignments: readonly Assignment[]
  unassignedTaskIds: readonly string[]
  splitReasonCodes: readonly string[]
}>

export function planBundleAssignments({
  tasks,
  candidateProfiles
}: Readonly<{
  tasks: readonly Task[]
  candidateProfiles: readonly CandidateProfile[]
}>): BundleAssignmentPlan {
  const readyTasks = tasks.filter((task) => task.status === 'ready').sort(compareTasks)
  if (readyTasks.length === 0) {
    return { bundles: [], assignments: [], unassignedTaskIds: [], splitReasonCodes: [] }
  }

  const context = getSharedContext(readyTasks)
  if (context === null) {
    throw new Error('Tasks must share runId and requestId before bundle planning')
  }

  const tasksWithRejectedLlmDuration = readyTasks.filter(hasRejectedLlmDuration)
  const tasksWithUsableDuration = readyTasks.filter((task) => !hasRejectedLlmDuration(task))
  const tasksWithSchedulingMetadata = tasksWithUsableDuration.filter(hasSchedulingMetadata)
  const tasksMissingSchedulingMetadata = tasksWithUsableDuration.filter(
    (task) => !hasSchedulingMetadata(task)
  )
  const initial = createBundles(tasksWithSchedulingMetadata, context)
  const resolved = resolveAssignments({
    bundles: initial.bundles,
    tasksById: new Map(readyTasks.map((task) => [task.taskId, task])),
    candidateProfiles,
    initialAssignments: [],
    context
  })

  return {
    bundles: resolved.bundles,
    assignments: resolved.assignments,
    unassignedTaskIds: unique([
      ...tasksWithRejectedLlmDuration.map((task) => task.taskId),
      ...tasksMissingSchedulingMetadata.map((task) => task.taskId),
      ...initial.unassignedTaskIds,
      ...resolved.unassignedTaskIds
    ]),
    splitReasonCodes: unique([
      ...(tasksWithRejectedLlmDuration.length > 0
        ? ['llm_estimated_duration_exceeds_twenty_minutes']
        : []),
      ...(tasksMissingSchedulingMetadata.length > 0 ? ['task_schedule_metadata_missing'] : []),
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

      if (attempted.ok) {
        groupedTasks = [...groupedTasks, candidateTask]
        remaining.splice(candidateIndex, 1)
        continue
      }

      splitReasonCodes.push(attempted.reasonCode)
      candidateIndex += 1
    }

    const attempted = scheduleTasks(groupedTasks)
    if (!attempted.ok) {
      splitReasonCodes.push(attempted.reasonCode)
      unassignedTaskIds.push(...groupedTasks.map((task) => task.taskId))
      continue
    }

    bundles.push(createBundle(groupedTasks, attempted.schedule, context))
  }

  return { bundles, unassignedTaskIds, splitReasonCodes }
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
        const attempted = scheduleTasks([task])
        if (!attempted.ok) return []
        return [createBundle([task], attempted.schedule, context)]
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

function scheduleTasks(tasks: readonly Task[], boundary?: TimeWindow): ScheduleAttempt {
  const totalDuration = tasks.reduce((total, task) => total + task.estimatedDurationMinutes, 0)
  if (totalDuration > MAX_BUNDLE_ACTIVITY_DURATION_MINUTES) {
    return { ok: false, reasonCode: 'helper_duration_exceeds_thirty_minutes' }
  }

  if (tasks.length === 0 || tasks.some((task) => !canFitOwnWindow(task))) {
    return { ok: false, reasonCode: 'task_window_cannot_fit_estimated_duration' }
  }

  const fixedSchedule = scheduleFixedTasks(tasks, boundary)
  if (fixedSchedule === null) {
    return { ok: false, reasonCode: 'task_windows_do_not_align' }
  }

  const flexibleTasks = tasks
    .filter((task) => task.timeCertainty === 'flexible')
    .sort(compareFlexibleTasks)
  const scheduledTasks = placeFlexibleTasks(flexibleTasks, fixedSchedule, boundary, true)
  if (scheduledTasks !== null) {
    return { ok: true, schedule: createSchedule(scheduledTasks, totalDuration) }
  }

  const scheduleIgnoringWaitingLimit = placeFlexibleTasks(
    flexibleTasks,
    fixedSchedule,
    boundary,
    false
  )
  return scheduleIgnoringWaitingLimit === null
    ? { ok: false, reasonCode: 'task_windows_do_not_align' }
    : { ok: false, reasonCode: 'waiting_time_exceeds_twenty_minutes' }
}

function scheduleFixedTasks(
  tasks: readonly Task[],
  boundary: TimeWindow | undefined
): ScheduledTask[] | null {
  const scheduledTasks: ScheduledTask[] = []

  for (const task of tasks.filter(isFixedTask).sort(compareTasks)) {
    const startAt = Date.parse(task.timeWindow.startAt)
    const endAt = startAt + task.estimatedDurationMinutes * MINUTE_MS
    if (!isWithinBoundary(startAt, endAt, boundary)) return null
    if (scheduledTasks.some((scheduled) => intervalsOverlap(scheduled, { startAt, endAt }))) {
      return null
    }
    scheduledTasks.push({ task, startAt, endAt })
  }

  return scheduledTasks
}

function placeFlexibleTasks(
  remainingTasks: readonly Task[],
  scheduledTasks: readonly ScheduledTask[],
  boundary: TimeWindow | undefined,
  enforceWaitingLimit: boolean,
  failedStates = new Set<string>()
): ScheduledTask[] | null {
  const sortedSchedule = [...scheduledTasks].sort(compareScheduledTasks)
  if (remainingTasks.length === 0) {
    const waitingMinutes = calculateFixedTaskWaitingMinutes(sortedSchedule)
    return !enforceWaitingLimit || waitingMinutes <= MAX_BUNDLE_WAITING_MINUTES
      ? sortedSchedule
      : null
  }

  const stateKey = createSchedulingStateKey(remainingTasks, sortedSchedule)
  if (failedStates.has(stateKey)) return null

  const attemptedTaskSignatures = new Set<string>()
  for (const task of [...remainingTasks].sort(compareFlexibleTasks)) {
    const taskSignature = createTaskSchedulingSignature(task)
    if (attemptedTaskSignatures.has(taskSignature)) continue
    attemptedTaskSignatures.add(taskSignature)

    const otherTasks = remainingTasks.filter(({ taskId }) => taskId !== task.taskId)
    for (const startAt of findPlacementStarts(task, sortedSchedule, boundary)) {
      const placedTask = {
        task,
        startAt,
        endAt: startAt + task.estimatedDurationMinutes * MINUTE_MS
      }
      const result = placeFlexibleTasks(
        otherTasks,
        [...sortedSchedule, placedTask],
        boundary,
        enforceWaitingLimit,
        failedStates
      )
      if (result !== null) return result
    }
  }

  failedStates.add(stateKey)
  return null
}

function findPlacementStarts(
  task: Task,
  scheduledTasks: readonly ScheduledTask[],
  boundary: TimeWindow | undefined
): number[] {
  const durationMs = task.estimatedDurationMinutes * MINUTE_MS
  const windowStartAt = Math.max(
    Date.parse(task.timeWindow.startAt),
    boundary === undefined ? Number.NEGATIVE_INFINITY : Date.parse(boundary.startAt)
  )
  const windowEndAt = Math.min(
    Date.parse(task.timeWindow.endAt),
    boundary === undefined ? Number.POSITIVE_INFINITY : Date.parse(boundary.endAt)
  )
  const starts: number[] = []
  let cursor = windowStartAt

  for (const occupied of scheduledTasks) {
    if (occupied.endAt <= cursor) continue
    if (occupied.startAt >= windowEndAt) break
    if (cursor + durationMs <= Math.min(occupied.startAt, windowEndAt)) starts.push(cursor)
    cursor = Math.max(cursor, occupied.endAt)
  }

  if (cursor + durationMs <= windowEndAt) starts.push(cursor)
  return uniqueNumbers(starts)
}

function createSchedule(
  scheduledTasks: readonly ScheduledTask[],
  totalActivityDurationMinutes: number
): Schedule {
  const sortedTasks = [...scheduledTasks].sort(compareScheduledTasks)
  const first = sortedTasks[0]
  const last = sortedTasks.at(-1)
  if (first === undefined || last === undefined) {
    throw new Error('A schedule requires at least one task')
  }

  return {
    scheduledTasks: sortedTasks,
    totalActivityDurationMinutes,
    waitingMinutes: calculateFixedTaskWaitingMinutes(sortedTasks),
    scheduledWindow: {
      startAt: new Date(first.startAt).toISOString(),
      endAt: new Date(last.endAt).toISOString()
    }
  }
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
      const attempted = scheduleTasks(tasks, availabilityWindow)
      if (!attempted.ok) return []
      const { schedule } = attempted
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
        left.profile.candidateId.localeCompare(right.profile.candidateId) ||
        Date.parse(left.schedule.scheduledWindow.startAt) -
          Date.parse(right.schedule.scheduledWindow.startAt) ||
        Date.parse(left.schedule.scheduledWindow.endAt) -
          Date.parse(right.schedule.scheduledWindow.endAt)
    )[0] ?? null
  )
}

function calculateFixedTaskWaitingMinutes(scheduledTasks: readonly ScheduledTask[]): number {
  const fixedTasks = scheduledTasks.filter(({ task }) => task.timeCertainty === 'fixed')
  let waitingMilliseconds = 0

  for (let index = 1; index < fixedTasks.length; index += 1) {
    const previous = fixedTasks[index - 1]
    const next = fixedTasks[index]
    if (previous === undefined || next === undefined) continue

    const activeMillisecondsBetween = scheduledTasks.reduce((total, scheduled) => {
      if (scheduled === previous || scheduled === next) return total
      const overlapStart = Math.max(previous.endAt, scheduled.startAt)
      const overlapEnd = Math.min(next.startAt, scheduled.endAt)
      return total + Math.max(0, overlapEnd - overlapStart)
    }, 0)
    const elapsedMilliseconds = Math.max(0, next.startAt - previous.endAt)
    waitingMilliseconds += Math.max(0, elapsedMilliseconds - activeMillisecondsBetween)
  }

  return Math.ceil(waitingMilliseconds / MINUTE_MS)
}

function canFitOwnWindow(task: Task): boolean {
  const durationMs = task.estimatedDurationMinutes * MINUTE_MS
  return Date.parse(task.timeWindow.startAt) + durationMs <= Date.parse(task.timeWindow.endAt)
}

function isFixedTask(task: Task): boolean {
  return task.timeCertainty === 'fixed'
}

function isWithinBoundary(
  startAt: number,
  endAt: number,
  boundary: TimeWindow | undefined
): boolean {
  if (boundary === undefined) return true
  return Date.parse(boundary.startAt) <= startAt && Date.parse(boundary.endAt) >= endAt
}

function intervalsOverlap(
  left: Readonly<{ startAt: number; endAt: number }>,
  right: Readonly<{ startAt: number; endAt: number }>
): boolean {
  return left.startAt < right.endAt && right.startAt < left.endAt
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

function compareFlexibleTasks(left: Task, right: Task): number {
  return (
    Date.parse(left.timeWindow.endAt) - Date.parse(right.timeWindow.endAt) ||
    Date.parse(left.timeWindow.startAt) - Date.parse(right.timeWindow.startAt) ||
    left.taskId.localeCompare(right.taskId)
  )
}

function compareScheduledTasks(left: ScheduledTask, right: ScheduledTask): number {
  return left.startAt - right.startAt || left.task.taskId.localeCompare(right.task.taskId)
}

function createSchedulingStateKey(
  remainingTasks: readonly Task[],
  scheduledTasks: readonly ScheduledTask[]
): string {
  const remaining = [...remainingTasks]
    .map((task) => task.taskId)
    .sort()
    .join(',')
  const scheduled = scheduledTasks
    .map(({ task, startAt, endAt }) => `${task.timeCertainty}:${startAt}:${endAt}`)
    .join(',')
  return `${remaining}|${scheduled}`
}

function createTaskSchedulingSignature(task: Task): string {
  return [
    task.timeWindow.startAt,
    task.timeWindow.endAt,
    task.estimatedDurationMinutes,
    task.timeCertainty
  ].join(':')
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

function hasRejectedLlmDuration(task: Task): boolean {
  return task.durationSource === 'llm_estimated' && task.estimatedDurationMinutes > 20
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right)
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
