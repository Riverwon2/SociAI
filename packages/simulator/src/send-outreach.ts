import {
  SCHEMA_VERSION,
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
  const outcome = determineResponse(call.seed, call.candidate.candidateId, call.attempt)
  const virtualElapsedMinutes =
    outcome === 'timed_out'
      ? call.timeoutMinutes
      : deterministicInteger(`${call.seed}:${call.candidate.candidateId}:elapsed`, 9) + 1
  const respondedAt =
    outcome === 'timed_out'
      ? undefined
      : advanceVirtualTime(call.task.timeWindow.startAt, virtualElapsedMinutes)

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
