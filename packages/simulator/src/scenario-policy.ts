import { deterministicInteger } from './seeded-random.js'

export type SimulatedOutcome = 'accepted' | 'rejected' | 'timed_out' | 'cancelled'

const KNOWN_SCENARIOS: Readonly<Record<string, readonly SimulatedOutcome[]>> = Object.freeze({
  'happy-path-v1': ['accepted'],
  'retry-path-v1': ['rejected', 'accepted'],
  'timeout-retry-path-v1': ['timed_out', 'accepted'],
  'mixed-risk-v1': ['accepted']
})

export function determineResponse(
  seed: string,
  candidateId: string,
  attempt: number
): SimulatedOutcome {
  const known = KNOWN_SCENARIOS[seed]?.[attempt - 1]
  if (known !== undefined) return known

  const bucket = deterministicInteger(`${seed}:${candidateId}:${attempt}`, 100)
  if (bucket < 55) return 'accepted'
  if (bucket < 75) return 'rejected'
  if (bucket < 90) return 'timed_out'
  return 'cancelled'
}
