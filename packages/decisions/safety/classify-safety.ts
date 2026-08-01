import type { SafetyAction, SafetyLevel, Task } from '@30-minute-exchange/contracts'

import { SAFETY_REASON_CODES, type SafetyReasonCode } from './reason-codes.js'
import { SAFETY_RULES, type SafetyRule } from './safety-rules.js'
import { containsAnySafetyPhrase, normalizeSafetyText } from './text-normalizer.js'

export type SafetyClassification = Readonly<{
  level: SafetyLevel
  action: SafetyAction
  reasonCodes: readonly SafetyReasonCode[]
  conditions: readonly string[]
  guidance?: string
}>

function findFirstMatchingRule(task: Task): SafetyRule | undefined {
  const text = normalizeSafetyText(task.title, task.description)
  return SAFETY_RULES.find((rule) => containsAnySafetyPhrase(text, rule.phrases))
}

export function classifySafety(task: Task): SafetyClassification {
  const matchedRule = findFirstMatchingRule(task)

  if (matchedRule !== undefined) {
    return {
      level: matchedRule.level,
      action: matchedRule.action,
      reasonCodes: [matchedRule.reasonCode],
      conditions: [...matchedRule.conditions],
      ...(matchedRule.guidance === undefined ? {} : { guidance: matchedRule.guidance })
    }
  }

  return {
    level: 'low',
    action: 'proceed',
    reasonCodes: [SAFETY_REASON_CODES.ordinaryLifeSupport],
    conditions: []
  }
}
