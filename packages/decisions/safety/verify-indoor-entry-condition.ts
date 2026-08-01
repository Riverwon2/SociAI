import {
  InitialRequestSchema,
  TaskSchema,
  type InitialRequest,
  type Task
} from '@30-minute-exchange/contracts'

import { classifySafety } from './classify-safety.js'
import { SAFETY_REASON_CODES } from './reason-codes.js'
import { normalizeSafetyClauses } from './text-normalizer.js'

export type IndoorEntryConditionStatus =
  'not_applicable' | 'verified_present' | 'verified_absent' | 'unknown' | 'conflicting'

export type IndoorEntryConditionAction = 'not_applicable' | 'continue' | 'block' | 'hold'

export type IndoorEntryConditionVerification = Readonly<{
  status: IndoorEntryConditionStatus
  action: IndoorEntryConditionAction
  reasonCodes: readonly string[]
}>

export type VerifyIndoorEntryConditionInput = Readonly<{
  initialRequest: InitialRequest
  task: Task
}>

type PresenceEvidence = Readonly<{
  present: boolean
  absent: boolean
}>

type IndoorLocationScope = 'home' | 'workplace' | 'both'

const HOME_TERMS = ['집', '자택', '주택'] as const
const WORKPLACE_TERMS = ['회사', '사무실', '사업장'] as const

const REQUESTER_PRESENT_PATTERNS = createRolePatterns(
  '(?:요청자|제가|저는|나는|본인)',
  '(?:있(?!지\\s*않)|대기)'
)
const REQUESTER_ABSENT_PATTERNS = createRolePatterns(
  '(?:요청자|제가|저는|나는|본인)',
  '(?:없|부재|있지\\s*않)'
)
const GUARDIAN_PRESENT_PATTERNS = createRolePatterns('(?:보호자)', '(?:있(?!지\\s*않)|대기)')
const GUARDIAN_ABSENT_PATTERNS = createRolePatterns('(?:보호자)', '(?:없|부재|있지\\s*않)')

const GENERIC_ABSENCE_PATTERNS = [
  /(?:현장|집|자택|주택|회사|사무실|사업장)(?:에는|에|은|는)?\s*아무도\s*(?:없|있지\s*않)/u,
  /아무도.{0,16}(?:없|있지\s*않)/u,
  /(?:빈집|빈\s*집|빈\s*사무실|빈\s*회사)/u
] as const

/**
 * Verifies the on-site-person condition only after a home/company entry task
 * has been classified as conditional. Only facts from the initial request are
 * accepted; derived task wording cannot create evidence.
 */
export function verifyIndoorEntryCondition(
  input: VerifyIndoorEntryConditionInput
): IndoorEntryConditionVerification {
  const initialRequest = InitialRequestSchema.parse(input.initialRequest)
  const task = TaskSchema.parse(input.task)

  if (initialRequest.requestId !== task.requestId) {
    throw new Error('InitialRequest and task requestId must match')
  }

  const classification = classifySafety(task)
  if (
    classification.level !== 'conditional' ||
    !classification.reasonCodes.includes(SAFETY_REASON_CODES.indoorEntryRequiresVerification)
  ) {
    return { status: 'not_applicable', action: 'not_applicable', reasonCodes: [] }
  }

  const clauses = normalizeSafetyClauses(
    initialRequest.helpDescription,
    initialRequest.optionalNotes ?? ''
  )
  const scopedClauses = filterClausesForTaskLocation(clauses, task)
  const requester = findPresenceEvidence(
    scopedClauses,
    REQUESTER_PRESENT_PATTERNS,
    REQUESTER_ABSENT_PATTERNS
  )
  const guardian = findPresenceEvidence(
    scopedClauses,
    GUARDIAN_PRESENT_PATTERNS,
    GUARDIAN_ABSENT_PATTERNS
  )
  const genericAbsence = matchesAny(scopedClauses, GENERIC_ABSENCE_PATTERNS)

  if (
    (requester.present && requester.absent) ||
    (guardian.present && guardian.absent) ||
    (genericAbsence && (requester.present || guardian.present))
  ) {
    return {
      status: 'conflicting',
      action: 'hold',
      reasonCodes: ['requester_or_guardian_presence_conflicting']
    }
  }

  if (requester.present || guardian.present) {
    return {
      status: 'verified_present',
      action: 'continue',
      reasonCodes: ['requester_or_guardian_present']
    }
  }

  if (genericAbsence || (requester.absent && guardian.absent)) {
    return {
      status: 'verified_absent',
      action: 'block',
      reasonCodes: ['requester_and_guardian_absent']
    }
  }

  return {
    status: 'unknown',
    action: 'hold',
    reasonCodes: ['requester_or_guardian_presence_unknown']
  }
}

function createRolePatterns(role: string, state: string): readonly RegExp[] {
  const location = '(?:(?:집|자택|주택|회사|사무실|사업장)(?:\\s*현장)?|현장)'
  return [
    new RegExp(`${role}(?:은|는|이|가|도)?\\s*(?:${location}(?:에는|에)?\\s*)?${state}`, 'u'),
    new RegExp(`${location}(?:에는|에)?\\s*${role}(?:은|는|이|가|도)?\\s*${state}`, 'u')
  ]
}

function filterClausesForTaskLocation(clauses: readonly string[], task: Task): readonly string[] {
  const scope = determineTaskLocationScope(task)
  if (scope === 'both') return clauses

  return clauses.filter((clause) => {
    const mentionsHome = includesAny(clause, HOME_TERMS)
    const mentionsWorkplace = includesAny(clause, WORKPLACE_TERMS)

    if (!mentionsHome && !mentionsWorkplace) return true
    return scope === 'home' ? mentionsHome : mentionsWorkplace
  })
}

function determineTaskLocationScope(task: Task): IndoorLocationScope {
  const taskText = normalizeSafetyClauses(task.title, task.description).join(' ')
  const mentionsHome = includesAny(taskText, HOME_TERMS)
  const mentionsWorkplace = includesAny(taskText, WORKPLACE_TERMS)

  if (mentionsHome && mentionsWorkplace) return 'both'
  return mentionsHome ? 'home' : 'workplace'
}

function findPresenceEvidence(
  clauses: readonly string[],
  presentPatterns: readonly RegExp[],
  absentPatterns: readonly RegExp[]
): PresenceEvidence {
  return {
    present: matchesAny(clauses, presentPatterns),
    absent: matchesAny(clauses, absentPatterns)
  }
}

function matchesAny(clauses: readonly string[], patterns: readonly RegExp[]): boolean {
  return clauses.some((clause) => patterns.some((pattern) => pattern.test(clause)))
}

function includesAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term))
}
