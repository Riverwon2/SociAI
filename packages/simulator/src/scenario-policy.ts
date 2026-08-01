import { deterministicInteger } from './seeded-random.js'

export type SimulatedOutcome = 'accepted' | 'rejected' | 'timed_out' | 'cancelled'

type CandidateResponseFixture = Readonly<Record<string, SimulatedOutcome>>

const KNOWN_SCENARIOS: Readonly<Record<string, CandidateResponseFixture>> = Object.freeze({
  'happy-path-v1': Object.freeze({ 'candidate-alpha': 'accepted' }),
  'retry-path-v1': Object.freeze({
    'candidate-alpha': 'rejected',
    'candidate-beta': 'accepted'
  }),
  'timeout-retry-path-v1': Object.freeze({
    'candidate-alpha': 'timed_out',
    'candidate-beta': 'accepted'
  }),
  'mixed-risk-v1': Object.freeze({ 'candidate-alpha': 'accepted' })
})

export function determineResponse(
  seed: string,
  candidateId: string,
  attempt: number
): SimulatedOutcome {
  const known = KNOWN_SCENARIOS[seed]?.[candidateId]
  if (known !== undefined) return known

  const bucket = deterministicInteger(`${seed}:${candidateId}:${attempt}`, 100)
  if (bucket < 55) return 'accepted'
  if (bucket < 75) return 'rejected'
  if (bucket < 90) return 'timed_out'
  return 'cancelled'
}
