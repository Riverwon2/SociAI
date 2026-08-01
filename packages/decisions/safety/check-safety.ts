import {
  CheckSafetyCallSchema,
  CheckSafetyResultSchema,
  SCHEMA_VERSION,
  type CheckSafetyCall,
  type CheckSafetyResult
} from '@30-minute-exchange/contracts'

import { classifySafety } from './classify-safety.js'

/** Validates the tool boundary and returns a contract-valid deterministic decision. */
export function checkSafety(input: CheckSafetyCall): CheckSafetyResult {
  const call = CheckSafetyCallSchema.parse(input)
  const classification = classifySafety(call.task)

  return CheckSafetyResultSchema.parse({
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
      level: classification.level,
      action: classification.action,
      reasonCodes: [...classification.reasonCodes],
      conditions: [...classification.conditions],
      ...(classification.guidance === undefined ? {} : { guidance: classification.guidance })
    }
  })
}
