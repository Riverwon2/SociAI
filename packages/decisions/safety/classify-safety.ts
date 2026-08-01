import type { SafetyAction, SafetyLevel, Task } from '@30-minute-exchange/contracts'

import { SAFETY_REASON_CODES, type SafetyReasonCode } from './reason-codes.js'
import { SAFETY_RULES, type SafetyRule } from './safety-rules.js'
import {
  findSafetyTextMatches,
  isNegatedSafetyMatch,
  normalizeSafetyClauses
} from './text-normalizer.js'

const SAFETY_LEVEL_PRIORITY: Readonly<Record<SafetyLevel, number>> = Object.freeze({
  low: 0,
  conditional: 1,
  high: 2,
  emergency: 3
})

export type SafetyClassification = Readonly<{
  level: SafetyLevel
  action: SafetyAction
  reasonCodes: readonly SafetyReasonCode[]
  conditions: readonly string[]
  guidance?: string
}>

function findMatchingRules(task: Task): SafetyRule[] {
  const clauses = normalizeSafetyClauses(task.title, task.description)
  return SAFETY_RULES.filter((rule) => clauses.some((clause) => matchesRule(clause, rule)))
}

function matchesRule(normalizedClause: string, rule: SafetyRule): boolean {
  return findSafetyTextMatches(normalizedClause, rule.directPhrases, rule.intentPatterns).some(
    (match) => !isNegatedSafetyMatch(normalizedClause, match)
  )
}

export function classifySafety(task: Task): SafetyClassification {
  const matchedRules = findMatchingRules(task)

  if (matchedRules.length === 0) return createOrdinaryLifeSupportDecision()

  const governingRule = [...matchedRules].sort(
    (left, right) => SAFETY_LEVEL_PRIORITY[right.level] - SAFETY_LEVEL_PRIORITY[left.level]
  )[0]
  if (governingRule === undefined) return createOrdinaryLifeSupportDecision()

  const governingRules = matchedRules.filter(({ level }) => level === governingRule.level)
  const guidance = unique(
    governingRules.flatMap((rule) => (rule.guidance === undefined ? [] : [rule.guidance]))
  ).join(' ')

  return {
    level: governingRule.level,
    action: governingRule.action,
    reasonCodes: unique(matchedRules.map(({ reasonCode }) => reasonCode)),
    conditions: unique(governingRules.flatMap(({ conditions }) => conditions)),
    ...(guidance.length === 0 ? {} : { guidance })
  }
}

function createOrdinaryLifeSupportDecision(): SafetyClassification {
  return {
    level: 'low',
    action: 'proceed',
    reasonCodes: [SAFETY_REASON_CODES.ordinaryLifeSupport],
    conditions: []
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}
