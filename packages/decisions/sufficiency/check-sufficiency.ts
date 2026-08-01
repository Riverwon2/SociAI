import {
  CheckSufficiencyCallSchema,
  CheckSufficiencyResultSchema,
  SCHEMA_VERSION,
  type CheckSufficiencyCall,
  type CheckSufficiencyResult
} from '@30-minute-exchange/contracts'

import { evaluateSufficiency } from './evaluate-sufficiency.js'

/** Validates the tool boundary and returns a contract-valid sufficiency decision. */
export function checkSufficiency(input: CheckSufficiencyCall): CheckSufficiencyResult {
  const call = CheckSufficiencyCallSchema.parse(input)
  const evaluation = evaluateSufficiency(call.task, call.availableFacts)

  return CheckSufficiencyResultSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    runId: call.runId,
    requestId: call.requestId,
    taskId: call.taskId,
    toolCallId: call.toolCallId,
    ok: true,
    data: {
      schemaVersion: SCHEMA_VERSION,
      runId: call.runId,
      requestId: call.requestId,
      taskId: call.taskId,
      status: evaluation.status,
      action: evaluation.action,
      reasonCodes: [...evaluation.reasonCodes],
      missingInformation: [...evaluation.missingInformation],
      ...(evaluation.guidance === undefined ? {} : { guidance: evaluation.guidance })
    }
  })
}
