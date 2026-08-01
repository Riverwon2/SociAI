import { afterEach, describe, expect, it, vi } from 'vitest'

import { replayInSequence, type ReplayScheduler } from '../src/replay-client.js'

describe('replay client', () => {
  afterEach(() => vi.useRealTimers())

  it('replays a sorted snapshot and supports cancellation', () => {
    const scheduled: Array<() => void> = []
    const scheduler: ReplayScheduler = (callback) => {
      scheduled.push(callback)
      return () => undefined
    }
    const seen: number[] = []

    const replay = replayInSequence({
      items: [{ sequence: 3 }, { sequence: 1 }, { sequence: 2 }],
      intervalMs: 25,
      scheduler,
      onItem: ({ sequence }) => seen.push(sequence)
    })

    scheduled.shift()?.()
    scheduled.shift()?.()
    replay.cancel()
    scheduled.shift()?.()

    expect(seen).toEqual([1, 2])
    expect(replay.isCancelled()).toBe(true)
  })

  it('uses the default scheduler to finish a complete replay', () => {
    vi.useFakeTimers()
    const seen: number[] = []
    const replay = replayInSequence({
      items: [{ sequence: 2 }, { sequence: 1 }],
      intervalMs: -1,
      onItem: ({ sequence }) => seen.push(sequence)
    })

    vi.runAllTimers()
    replay.cancel()
    replay.cancel()

    expect(seen).toEqual([1, 2])
    expect(replay.isCancelled()).toBe(true)
  })

  it('does not schedule work for an empty replay', () => {
    const scheduler = vi.fn<ReplayScheduler>()
    const replay = replayInSequence({ items: [], intervalMs: 10, scheduler, onItem: vi.fn() })

    expect(scheduler).not.toHaveBeenCalled()
    expect(replay.isCancelled()).toBe(false)
  })
})
