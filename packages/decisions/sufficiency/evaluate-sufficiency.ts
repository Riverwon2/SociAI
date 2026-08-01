import type {
  AvailableFact,
  MissingInformation,
  SufficiencyAction,
  SufficiencyStatus,
  Task
} from '@30-minute-exchange/contracts'

import { SUFFICIENCY_REASON_CODES } from './reason-codes.js'
import { getRequiredMissingInformation } from './sufficiency-rules.js'
import { isAvailableFactValid } from './validate-available-fact.js'

export type SufficiencyEvaluation = Readonly<{
  status: SufficiencyStatus
  action: SufficiencyAction
  reasonCodes: readonly string[]
  missingInformation: readonly MissingInformation[]
  guidance?: string
}>

export function evaluateSufficiency(
  task: Task,
  availableFacts: readonly AvailableFact[]
): SufficiencyEvaluation {
  const availableCodes = new Set(
    availableFacts.filter(isAvailableFactValid).map(({ code }) => code)
  )
  const unresolved = getRequiredMissingInformation(task).filter(
    ({ code }) => !availableCodes.has(code)
  )

  if (unresolved.length === 0) {
    return {
      status: 'sufficient',
      action: 'proceed',
      reasonCodes: [SUFFICIENCY_REASON_CODES.requiredInformationAvailable],
      missingInformation: []
    }
  }

  return {
    status: 'insufficient',
    action: 'hold',
    reasonCodes: [SUFFICIENCY_REASON_CODES.missingRequiredInformation],
    missingInformation: unresolved,
    guidance: '필수 정보를 확인할 수 없어 이 태스크만 보류합니다.'
  }
}
