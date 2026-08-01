import {
  SendBundleOutreachCallSchema,
  SendBundleOutreachResultSchema,
  type SendBundleOutreachCall,
  type SendBundleOutreachResult
} from '@30-minute-exchange/contracts'

import { determineResponse } from './scenario-policy.js'
import { deterministicInteger } from './seeded-random.js'
import { advanceVirtualTimeSeconds } from './virtual-clock.js'

export const DEFAULT_OUTREACH_TIMEOUT_SECONDS = 10
/** Mirrors MAX_CANDIDATE_ATTEMPTS in decisions; packages must not depend on each other. */
const MAX_BUNDLE_OUTREACH_ATTEMPTS = 3

export function sendBundleOutreach(input: SendBundleOutreachCall): SendBundleOutreachResult {
  const call = SendBundleOutreachCallSchema.parse(input)
  if (call.assignment.attempt > MAX_BUNDLE_OUTREACH_ATTEMPTS) {
    throw new RangeError('A bundle supports at most three candidate outreach attempts')
  }
  const outcome = determineResponse(call.seed, call.assignment.candidateId, call.assignment.attempt)
  const virtualElapsedSeconds =
    outcome === 'timed_out'
      ? call.timeoutSeconds
      : deterministicInteger(
          `${call.seed}:${call.assignment.candidateId}:${call.assignment.attempt}:elapsed`,
          call.timeoutSeconds
        ) + 1
  const respondedAt =
    outcome === 'timed_out'
      ? undefined
      : advanceVirtualTimeSeconds(call.bundle.scheduledWindow.startAt, virtualElapsedSeconds)

  return SendBundleOutreachResultSchema.parse({
    schemaVersion: call.schemaVersion,
    runId: call.runId,
    requestId: call.requestId,
    toolCallId: call.toolCallId,
    ok: true,
    data: {
      assignmentId: call.assignment.assignmentId,
      candidateId: call.assignment.candidateId,
      outcome,
      virtualElapsedSeconds,
      ...(respondedAt === undefined ? {} : { respondedAt })
    }
  })
}
