import {
  SCHEMA_VERSION,
  IsoDateTimeSchema,
  SendOutreachCallSchema,
  SendOutreachResultSchema,
  type SendOutreachCall,
  type SendOutreachResult
} from '@30-minute-exchange/contracts'

import { determineResponse } from './scenario-policy.js'
import { deterministicInteger } from './seeded-random.js'
import { advanceVirtualTime } from './virtual-clock.js'

export function sendOutreach(input: SendOutreachCall): SendOutreachResult {
  const call = SendOutreachCallSchema.parse(input)
  return createOutreachResult(call, call.task.timeWindow.startAt)
}

/** Uses the orchestrator's cumulative virtual clock without changing the shared call contract. */
export function sendOutreachAt(
  input: SendOutreachCall,
  virtualCurrentAt: string
): SendOutreachResult {
  const call = SendOutreachCallSchema.parse(input)
  return createOutreachResult(call, IsoDateTimeSchema.parse(virtualCurrentAt))
}

function createOutreachResult(
  call: SendOutreachCall,
  virtualCurrentAt: string
): SendOutreachResult {
  const outcome = determineResponse(call.seed, call.candidate.candidateId, call.attempt)
  const virtualElapsedMinutes =
    outcome === 'timed_out'
      ? call.timeoutMinutes
      : deterministicInteger(`${call.seed}:${call.candidate.candidateId}:elapsed`, 9) + 1
  const respondedAt =
    outcome === 'timed_out'
      ? undefined
      : advanceVirtualTime(virtualCurrentAt, virtualElapsedMinutes)

  return SendOutreachResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    runId: call.runId,
    requestId: call.requestId,
    taskId: call.taskId,
    toolCallId: call.toolCallId,
    candidateId: call.candidate.candidateId,
    ok: true,
    data: {
      candidateId: call.candidate.candidateId,
      outcome,
      virtualElapsedMinutes,
      ...(respondedAt === undefined ? {} : { respondedAt })
    }
  })
}
