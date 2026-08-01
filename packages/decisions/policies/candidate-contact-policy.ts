import {
  CandidateSchema,
  SufficiencyDecisionSchema,
  type Candidate,
  type SufficiencyDecision
} from '@30-minute-exchange/contracts'

export type CandidateContactPlan =
  | Readonly<{
      kind: 'matching'
      taskId: string
      candidateId: string
      taskStatus: 'ready'
    }>
  | Readonly<{
      kind: 'clarification'
      taskId: string
      candidateId: string
      taskStatus: 'held'
    }>

export type PlanCandidateContactInput = Readonly<{
  decision: SufficiencyDecision
  candidates: readonly Candidate[]
}>

/** Selects one highest-ranked candidate without treating clarification as a match. */
export function planCandidateContact(
  input: PlanCandidateContactInput
): CandidateContactPlan | null {
  const decision = SufficiencyDecisionSchema.parse(input.decision)
  const candidates = input.candidates.map((candidate) => CandidateSchema.parse(candidate))

  for (const candidate of candidates) {
    if (
      candidate.runId !== decision.runId ||
      candidate.requestId !== decision.requestId ||
      candidate.taskId !== decision.taskId
    ) {
      throw new Error('Sufficiency decision and candidate context must match')
    }
  }

  const candidate = [...candidates].sort(
    (left, right) => left.rank - right.rank || left.candidateId.localeCompare(right.candidateId)
  )[0]
  if (candidate === undefined) return null

  return decision.status === 'sufficient'
    ? {
        kind: 'matching',
        taskId: decision.taskId,
        candidateId: candidate.candidateId,
        taskStatus: 'ready'
      }
    : {
        kind: 'clarification',
        taskId: decision.taskId,
        candidateId: candidate.candidateId,
        taskStatus: 'held'
      }
}
