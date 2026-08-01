import type { Task, TimeWindow } from '@30-minute-exchange/contracts'

import { roundScore } from './ranking-policy.js'

function overlapMinutes(left: TimeWindow, right: TimeWindow): number {
  const start = Math.max(Date.parse(left.startAt), Date.parse(right.startAt))
  const end = Math.min(Date.parse(left.endAt), Date.parse(right.endAt))
  return Math.max(0, end - start) / 60_000
}

export function calculateAvailabilityScore(task: Task, windows: readonly TimeWindow[]): number {
  const taskWindowMinutes =
    (Date.parse(task.timeWindow.endAt) - Date.parse(task.timeWindow.startAt)) / 60_000
  const longestOverlap = Math.max(
    0,
    ...windows.map((window) => overlapMinutes(task.timeWindow, window))
  )

  if (longestOverlap < task.estimatedDurationMinutes) return 0
  return roundScore(Math.min(1, longestOverlap / taskWindowMinutes))
}

/** Removes already committed intervals before candidate eligibility and scoring. */
export function subtractScheduledCommitments(
  availabilityWindows: readonly TimeWindow[],
  scheduledCommitments: readonly TimeWindow[]
): TimeWindow[] {
  const commitments = scheduledCommitments
    .map((window) => ({ startAt: Date.parse(window.startAt), endAt: Date.parse(window.endAt) }))
    .sort((left, right) => left.startAt - right.startAt || left.endAt - right.endAt)

  return availabilityWindows.flatMap((window) => {
    let freeIntervals = [{ startAt: Date.parse(window.startAt), endAt: Date.parse(window.endAt) }]

    for (const commitment of commitments) {
      freeIntervals = freeIntervals.flatMap((interval) => subtractInterval(interval, commitment))
    }

    return freeIntervals.map(({ startAt, endAt }) => ({
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString()
    }))
  })
}

function subtractInterval(
  interval: Readonly<{ startAt: number; endAt: number }>,
  commitment: Readonly<{ startAt: number; endAt: number }>
): Readonly<{ startAt: number; endAt: number }>[] {
  if (commitment.endAt <= interval.startAt || commitment.startAt >= interval.endAt) {
    return [interval]
  }

  const remaining: Readonly<{ startAt: number; endAt: number }>[] = []
  if (commitment.startAt > interval.startAt) {
    remaining.push({ startAt: interval.startAt, endAt: commitment.startAt })
  }
  if (commitment.endAt < interval.endAt) {
    remaining.push({ startAt: commitment.endAt, endAt: interval.endAt })
  }
  return remaining
}
