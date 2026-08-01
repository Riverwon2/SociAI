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
