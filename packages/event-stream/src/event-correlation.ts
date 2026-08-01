import type { RawToolEvent } from '@30-minute-exchange/contracts'

export type RawToolCorrelationStatus = 'complete' | 'waiting_for_result' | 'orphan_result'

export interface RawToolCorrelation {
  readonly toolCallId: string
  readonly status: RawToolCorrelationStatus
  readonly callEvents: readonly RawToolEvent[]
  readonly resultEvents: readonly RawToolEvent[]
  readonly firstSequence: number
  readonly lastSequence: number
}

export function correlateRawToolEvents(
  events: readonly RawToolEvent[]
): readonly RawToolCorrelation[] {
  const groups = new Map<string, RawToolEvent[]>()
  for (const event of events) {
    const group = groups.get(event.toolCallId) ?? []
    group.push(event)
    groups.set(event.toolCallId, group)
  }

  return [...groups.entries()]
    .map(([toolCallId, group]) => createCorrelation(toolCallId, group))
    .sort((left, right) => left.firstSequence - right.firstSequence)
}

function createCorrelation(toolCallId: string, group: readonly RawToolEvent[]): RawToolCorrelation {
  const sorted = [...group].sort((left, right) => left.sequence - right.sequence)
  const callEvents = sorted.filter(({ direction }) => direction === 'tool_call')
  const resultEvents = sorted.filter(({ direction }) => direction === 'tool_result')

  return {
    toolCallId,
    status: getStatus(callEvents, resultEvents),
    callEvents,
    resultEvents,
    firstSequence: sorted[0]?.sequence ?? 0,
    lastSequence: sorted.at(-1)?.sequence ?? 0
  }
}

function getStatus(
  calls: readonly RawToolEvent[],
  results: readonly RawToolEvent[]
): RawToolCorrelationStatus {
  if (calls.length === 0) return 'orphan_result'
  return results.length === 0 ? 'waiting_for_result' : 'complete'
}
