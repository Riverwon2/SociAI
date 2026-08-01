import {
  CandidateSchema,
  RequestIdSchema,
  RunIdSchema,
  SCHEMA_VERSION,
  SufficiencyDecisionSchema,
  TaskIdSchema,
  TaskSchema,
  ToolCallIdSchema,
  type Candidate,
  type SufficiencyDecision,
  type Task
} from '@30-minute-exchange/contracts'

import { determineClarificationResponse, type ClarificationOutcome } from './scenario-policy.js'

export type ClarificationInviteCall = Readonly<{
  schemaVersion: typeof SCHEMA_VERSION
  runId: string
  requestId: string
  taskId: string
  toolCallId: string
  task: Task
  sufficiencyDecision: SufficiencyDecision
  candidate: Candidate
  seed: string
}>

export type ClarificationInviteResult = Readonly<{
  schemaVersion: typeof SCHEMA_VERSION
  runId: string
  requestId: string
  taskId: string
  toolCallId: string
  candidateId: string
  ok: true
  data: Readonly<{
    candidateId: string
    outcome: ClarificationOutcome
    taskStatus: 'held'
    requesterMessage: string
    isSimulation: true
  }>
}>

/** Simulates only the candidate's clarification interest shown to the requester. */
export function sendClarificationInvite(input: ClarificationInviteCall): ClarificationInviteResult {
  validateContext(input)
  const task = TaskSchema.parse(input.task)
  const sufficiencyDecision = SufficiencyDecisionSchema.parse(input.sufficiencyDecision)
  const candidate = CandidateSchema.parse(input.candidate)
  if (task.status !== 'held') {
    throw new Error('A clarification invite requires a held task')
  }
  if (sufficiencyDecision.status !== 'insufficient') {
    throw new Error('A clarification invite requires an insufficient decision')
  }

  const outcome = determineClarificationResponse(input.seed, candidate.candidateId)
  const requesterMessage =
    outcome === 'conversation_agreed'
      ? `${candidate.displayName}: 정보 확인 대화에 동의했습니다.`
      : `${candidate.displayName}: 정보 확인 대화를 거절했습니다.`

  return {
    schemaVersion: SCHEMA_VERSION,
    runId: input.runId,
    requestId: input.requestId,
    taskId: input.taskId,
    toolCallId: input.toolCallId,
    candidateId: candidate.candidateId,
    ok: true,
    data: {
      candidateId: candidate.candidateId,
      outcome,
      taskStatus: 'held',
      requesterMessage,
      isSimulation: true
    }
  }
}

function validateContext(input: ClarificationInviteCall): void {
  if (input.schemaVersion !== SCHEMA_VERSION) throw new Error('schemaVersion must match')
  const runId = RunIdSchema.parse(input.runId)
  const requestId = RequestIdSchema.parse(input.requestId)
  const taskId = TaskIdSchema.parse(input.taskId)
  ToolCallIdSchema.parse(input.toolCallId)
  if (input.seed.trim().length === 0 || input.seed.length > 128) {
    throw new Error('seed must contain between 1 and 128 characters')
  }

  const task = TaskSchema.parse(input.task)
  const sufficiencyDecision = SufficiencyDecisionSchema.parse(input.sufficiencyDecision)
  const candidate = CandidateSchema.parse(input.candidate)
  if (task.runId !== runId || task.requestId !== requestId || task.taskId !== taskId) {
    throw new Error('task context must match clarification invite context')
  }
  if (
    sufficiencyDecision.runId !== runId ||
    sufficiencyDecision.requestId !== requestId ||
    sufficiencyDecision.taskId !== taskId
  ) {
    throw new Error('sufficiency decision context must match clarification invite context')
  }
  if (
    candidate.runId !== runId ||
    candidate.requestId !== requestId ||
    candidate.taskId !== taskId
  ) {
    throw new Error('candidate context must match clarification invite context')
  }
}
