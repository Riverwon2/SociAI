export function advanceVirtualTime(startAt: string, elapsedMinutes: number): string {
  const start = Date.parse(startAt)
  if (!Number.isFinite(start)) throw new RangeError('startAt must be a valid ISO datetime')
  if (!Number.isInteger(elapsedMinutes) || elapsedMinutes < 0) {
    throw new RangeError('elapsedMinutes must be a non-negative integer')
  }
  return new Date(start + elapsedMinutes * 60_000).toISOString()
}
