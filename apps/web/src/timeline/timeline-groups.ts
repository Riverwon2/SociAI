import type { AgentEvent } from '@30-minute-exchange/contracts'
import type { ConsumableAgentEvent } from '@30-minute-exchange/event-stream'

export type TimelineGroupKind = 'run' | 'task' | 'bundle' | 'bundle-set'

export interface TimelineDisplayGroup {
  readonly key: string
  readonly kind: TimelineGroupKind
  readonly bundleIds: readonly string[]
  readonly assignmentIds: readonly string[]
  readonly taskIds: readonly string[]
  readonly items: readonly ConsumableAgentEvent[]
}

interface EventCorrelation {
  readonly key: string
  readonly kind: TimelineGroupKind
  readonly bundleIds: readonly string[]
  readonly assignmentIds: readonly string[]
  readonly taskIds: readonly string[]
}

interface CorrelationIndex {
  readonly bundleIdByTaskId: ReadonlyMap<string, string>
  readonly bundleIdByAssignmentId: ReadonlyMap<string, string>
  readonly taskIdsByAssignmentId: ReadonlyMap<string, readonly string[]>
}

/**
 * Creates contiguous display groups without reordering events. A bundle that has
 * concurrent activity therefore appears in multiple blocks, in source sequence.
 */
export function deriveTimelineDisplayGroups(
  items: readonly ConsumableAgentEvent[]
): readonly TimelineDisplayGroup[] {
  const index = buildCorrelationIndex(items)
  const groups: TimelineDisplayGroup[] = []

  for (const item of items) {
    const correlation = correlateItem(item, index)
    const previous = groups.at(-1)
    if (previous !== undefined && previous.key === correlation.key) {
      groups[groups.length - 1] = { ...previous, items: [...previous.items, item] }
      continue
    }

    groups.push({ ...correlation, items: [item] })
  }

  return groups
}

function buildCorrelationIndex(items: readonly ConsumableAgentEvent[]): CorrelationIndex {
  const bundleIdByTaskId = new Map<string, string>()
  const bundleIdByAssignmentId = new Map<string, string>()
  const taskIdsByAssignmentId = new Map<string, readonly string[]>()

  for (const item of items) {
    if (item.kind !== 'known') continue
    const { event } = item
    if (event.type === 'bundles.planned') {
      for (const bundle of event.data.bundles) {
        for (const taskId of bundle.taskIds) bundleIdByTaskId.set(taskId, bundle.bundleId)
      }
    }
    if (event.type === 'assignments.planned') {
      for (const assignment of event.data.assignments) {
        bundleIdByAssignmentId.set(assignment.assignmentId, assignment.bundleId)
        taskIdsByAssignmentId.set(assignment.assignmentId, assignment.taskIds)
        for (const taskId of assignment.taskIds) {
          if (!bundleIdByTaskId.has(taskId)) bundleIdByTaskId.set(taskId, assignment.bundleId)
        }
      }
    }
  }

  return { bundleIdByTaskId, bundleIdByAssignmentId, taskIdsByAssignmentId }
}

function correlateItem(item: ConsumableAgentEvent, index: CorrelationIndex): EventCorrelation {
  if (item.kind !== 'known') return runCorrelation()

  const { event } = item
  const directBundleIds = directBundleIdsFor(event)
  const assignmentIds = assignmentIdsFor(event)
  const assignmentBundleIds = assignmentIds
    .map((assignmentId) => index.bundleIdByAssignmentId.get(assignmentId))
    .filter((bundleId): bundleId is string => bundleId !== undefined)
  const taskIds = unique([
    ...(event.taskId === undefined ? [] : [event.taskId]),
    ...assignmentIds.flatMap((assignmentId) => index.taskIdsByAssignmentId.get(assignmentId) ?? [])
  ])
  const taskBundleIds = taskIds
    .map((taskId) => index.bundleIdByTaskId.get(taskId))
    .filter((bundleId): bundleId is string => bundleId !== undefined)
  const bundleIds = unique([...directBundleIds, ...assignmentBundleIds, ...taskBundleIds])

  if (bundleIds.length === 1) {
    return {
      key: `bundle:${bundleIds[0]}`,
      kind: 'bundle',
      bundleIds,
      assignmentIds,
      taskIds
    }
  }
  if (bundleIds.length > 1) {
    return {
      key: `bundle-set:${bundleIds.join('|')}`,
      kind: 'bundle-set',
      bundleIds,
      assignmentIds,
      taskIds
    }
  }
  if (taskIds.length > 0) {
    return { key: `task:${taskIds.join('|')}`, kind: 'task', bundleIds, assignmentIds, taskIds }
  }
  return runCorrelation()
}

function directBundleIdsFor(event: AgentEvent): readonly string[] {
  switch (event.type) {
    case 'bundles.planned':
      return event.data.bundles.map(({ bundleId }) => bundleId)
    case 'assignments.planned':
      return event.data.assignments.map(({ bundleId }) => bundleId)
    case 'bundle.candidates.ranked':
      return [event.data.bundleId]
    default:
      return []
  }
}

function assignmentIdsFor(event: AgentEvent): readonly string[] {
  switch (event.type) {
    case 'assignments.planned':
      return event.data.assignments.map(({ assignmentId }) => assignmentId)
    case 'outreach.sent':
    case 'neighbor.replied':
    case 'outreach.timed_out':
    case 'match.confirmed':
      return event.data.assignmentId === undefined ? [] : [event.data.assignmentId]
    default:
      return []
  }
}

function runCorrelation(): EventCorrelation {
  return { key: 'run', kind: 'run', bundleIds: [], assignmentIds: [], taskIds: [] }
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}
