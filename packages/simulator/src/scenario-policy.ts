import { deterministicInteger } from './seeded-random.js'

export type SimulatedOutcome = 'accepted' | 'rejected' | 'timed_out' | 'cancelled'
export type ClarificationOutcome = 'conversation_agreed' | 'rejected'

/**
 * Parallel bundle outreach cannot rely on an attempt counter, because each
 * bundle counts its own attempts against the same seed. `byCandidateId` is the
 * authoritative fixture; `byAttempt` stays for the single-task replay scenarios
 * that predate bundles.
 */
type CandidateResponseFixture = Readonly<{
  byCandidateId?: Readonly<Record<string, SimulatedOutcome>>
  byAttempt?: readonly SimulatedOutcome[]
}>

const KNOWN_SCENARIOS: Readonly<Record<string, CandidateResponseFixture>> = Object.freeze({
  'happy-path-v1': Object.freeze({
    byCandidateId: Object.freeze({ 'candidate-alpha': 'accepted' }),
    byAttempt: Object.freeze(['accepted'] as const)
  }),
  'retry-path-v1': Object.freeze({
    byCandidateId: Object.freeze({
      'candidate-alpha': 'rejected',
      'candidate-beta': 'accepted'
    }),
    byAttempt: Object.freeze(['rejected', 'timed_out', 'accepted'] as const)
  }),
  'timeout-retry-path-v1': Object.freeze({
    byCandidateId: Object.freeze({
      'candidate-alpha': 'timed_out',
      'candidate-beta': 'accepted'
    })
  }),
  'mixed-risk-v1': Object.freeze({
    byCandidateId: Object.freeze({ 'candidate-alpha': 'accepted' }),
    byAttempt: Object.freeze(['accepted'] as const)
  })
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
  const scenario = KNOWN_SCENARIOS[seed]
  const knownForCandidate = scenario?.byCandidateId?.[candidateId]
  if (knownForCandidate !== undefined) return knownForCandidate

  const knownForAttempt = scenario?.byAttempt?.[attempt - 1]
  if (knownForAttempt !== undefined) return knownForAttempt

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
