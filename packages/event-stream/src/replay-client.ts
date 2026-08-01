export type ReplayScheduler = (callback: () => void, delayMs: number) => () => void

export interface ReplayItem {
  readonly sequence: number
}

export interface ReplayOptions<TItem extends ReplayItem> {
  readonly items: readonly TItem[]
  readonly intervalMs: number
  readonly onItem: (item: TItem) => void
  readonly scheduler?: ReplayScheduler
}

export interface ReplayController {
  cancel(): void
  isCancelled(): boolean
}

export function replayInSequence<TItem extends ReplayItem>(
  options: ReplayOptions<TItem>
): ReplayController {
  const items = [...options.items].sort((left, right) => left.sequence - right.sequence)
  const scheduler = options.scheduler ?? defaultScheduler
  let index = 0
  let cancelled = false
  let cancelScheduled: () => void = () => undefined

  const scheduleNext = () => {
    if (cancelled || index >= items.length) return
    cancelScheduled = scheduler(() => {
      if (cancelled) return
      const item = items[index]
      if (item === undefined) return
      options.onItem(item)
      index += 1
      scheduleNext()
    }, options.intervalMs)
  }

  scheduleNext()
  return {
    cancel() {
      if (cancelled) return
      cancelled = true
      cancelScheduled()
    },
    isCancelled: () => cancelled
  }
}

const defaultScheduler: ReplayScheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, Math.max(0, delayMs))
  return () => clearTimeout(timer)
}
