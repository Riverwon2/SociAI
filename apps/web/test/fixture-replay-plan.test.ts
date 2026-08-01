import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@30-minute-exchange/contracts'

import { buildFixtureEvents } from '../src/demo/fixture-events.js'
import {
  createReplayProgress,
  pendingDecisions,
  planFixtureReplay,
  takeAutoStep,
  takeDecisionStep,
  type FixtureReplayProgress
} from '../src/demo/fixture-replay-plan.js'
import { getDemoScenario } from '../src/demo/scenarios.js'

describe('fixture replay plan', () => {
  it('holds every helper response until that helper answers', () => {
    const { plan, progress } = drainAuto('three_way_conflict')

    expect(plan.tracks.map(({ taskId }) => taskId)).toEqual([
      'task_three_way_pickup',
      'task_three_way_parcel',
      'task_three_way_delivery'
    ])
    expect([...pendingDecisions(plan, progress).keys()]).toEqual([
      'task_three_way_pickup',
      'task_three_way_parcel',
      'task_three_way_delivery'
    ])
    expect(plan.prelude.filter(({ type }) => type === 'outreach.sent')).toHaveLength(3)
    expect(takeAutoStep(plan, progress)).toBeNull()
  })

  it('lets helpers answer in any order and completes only after the last one', () => {
    const { plan } = drainAuto('three_way_conflict')
    let progress = drainAuto('three_way_conflict').progress
    const seen: AgentEvent[] = []

    for (const taskId of [
      'task_three_way_delivery',
      'task_three_way_pickup',
      'task_three_way_parcel'
    ]) {
      const step = takeDecisionStep(plan, progress, taskId, 'accepted')
      expect(step).not.toBeNull()
      if (step === null) throw new Error('decision step missing')
      seen.push(step.event)
      progress = step.progress
      progress = collectAuto(plan, progress, seen)
    }

    expect(seen.filter(({ type }) => type === 'match.confirmed')).toHaveLength(3)
    const completed = seen.at(-1)
    expect(completed?.type).toBe('request.completed')
  })

  it('does not release the completion event while one helper is still pending', () => {
    const { plan } = drainAuto('three_way_conflict')
    let progress = drainAuto('three_way_conflict').progress
    const seen: AgentEvent[] = []

    for (const taskId of ['task_three_way_pickup', 'task_three_way_parcel']) {
      const step = takeDecisionStep(plan, progress, taskId, 'accepted')
      if (step === null) throw new Error('decision step missing')
      seen.push(step.event)
      progress = collectAuto(plan, step.progress, seen)
    }

    expect(seen.some(({ type }) => type === 'request.completed')).toBe(false)
    expect([...pendingDecisions(plan, progress).keys()]).toEqual(['task_three_way_delivery'])
  })

  it('rejects a decision the fixture did not record', () => {
    const { plan, progress } = drainAuto('three_way_conflict')

    expect(takeDecisionStep(plan, progress, 'task_three_way_pickup', 'rejected')).toBeNull()
    expect(takeDecisionStep(plan, progress, 'unknown_task', 'accepted')).toBeNull()
  })

  it('keeps the single-task retry scenario gated one attempt at a time', () => {
    const { plan, progress } = drainAuto('reject_timeout_accept')
    const taskId = plan.tracks[0]?.taskId ?? ''

    expect(plan.tracks).toHaveLength(1)
    expect(pendingDecisions(plan, progress).get(taskId)).toBe('rejected')

    const afterReject = takeDecisionStep(plan, progress, taskId, 'rejected')
    if (afterReject === null) throw new Error('decision step missing')
    const settled = collectAuto(plan, afterReject.progress, [])
    expect(pendingDecisions(plan, settled).get(taskId)).toBe('timed_out')
  })
})

function drainAuto(scenarioId: Parameters<typeof getDemoScenario>[0]) {
  const plan = planFixtureReplay(buildFixtureEvents(getDemoScenario(scenarioId).fixture))
  return { plan, progress: collectAuto(plan, createReplayProgress(plan), []) }
}

function collectAuto(
  plan: ReturnType<typeof planFixtureReplay>,
  start: FixtureReplayProgress,
  seen: AgentEvent[]
): FixtureReplayProgress {
  let progress = start
  for (let guard = 0; guard < 200; guard += 1) {
    const step = takeAutoStep(plan, progress)
    if (step === null) return progress
    seen.push(step.event)
    progress = step.progress
  }
  throw new Error('replay did not settle')
}
