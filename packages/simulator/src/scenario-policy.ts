import { deterministicInteger } from './seeded-random.js'

export type SimulatedOutcome = 'accepted' | 'rejected' | 'timed_out' | 'cancelled'
export type ClarificationOutcome = 'conversation_agreed' | 'rejected'

const KNOWN_SCENARIOS: Readonly<Record<string, readonly SimulatedOutcome[]>> = Object.freeze({
  'happy-path-v1': ['accepted'],
  'retry-path-v1': ['rejected', 'timed_out', 'accepted'],
  'mixed-risk-v1': ['accepted']
})

const KNOWN_CLARIFICATION_SCENARIOS: Readonly<Record<string, ClarificationOutcome>> = Object.freeze(
  {
    'clarification-agreed-v1': 'conversation_agreed',
    'clarification-rejected-v1': 'rejected'
  }
)

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

export function determineClarificationResponse(
  seed: string,
  candidateId: string
): ClarificationOutcome {
  const known = KNOWN_CLARIFICATION_SCENARIOS[seed]
  if (known !== undefined) return known

  return deterministicInteger(`${seed}:${candidateId}:clarification`, 100) < 70
    ? 'conversation_agreed'
    : 'rejected'
}
