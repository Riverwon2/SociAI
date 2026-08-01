import type { AvailableFact, JsonValue } from '@30-minute-exchange/contracts'

import { SUFFICIENCY_FACT_CODES } from './sufficiency-rules.js'

const TEXT_FACT_CODES = new Set<string>([
  SUFFICIENCY_FACT_CODES.taskObject,
  SUFFICIENCY_FACT_CODES.taskScope,
  SUFFICIENCY_FACT_CODES.pickupPoint,
  SUFFICIENCY_FACT_CODES.dropoffPoint
])

export function isAvailableFactValid(fact: AvailableFact): boolean {
  if (TEXT_FACT_CODES.has(fact.code)) return hasMeaningfulText(fact.value)

  switch (fact.code) {
    case SUFFICIENCY_FACT_CODES.itemQuantity:
      return isPositiveQuantity(fact.value)
    case SUFFICIENCY_FACT_CODES.itemWeight:
      return isPositiveWeight(fact.value)
    case SUFFICIENCY_FACT_CODES.requiredEquipment:
      return typeof fact.value === 'boolean' || hasMeaningfulText(fact.value)
    case 'requester_or_guardian_present':
      return fact.value === true
    default:
      return isMeaningfulJson(fact.value)
  }
}

function hasMeaningfulText(value: JsonValue): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (!isJsonObject(value)) return false
  return ['label', 'name', 'description', 'value'].some(
    (key) => typeof value[key] === 'string' && value[key].trim().length > 0
  )
}

function isPositiveQuantity(value: JsonValue): boolean {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0
  if (typeof value !== 'string') return false

  const normalized = value.trim().toLocaleLowerCase('ko-KR')
  const numeric = normalized.match(/^(\d+)\s*(?:개|박스|점|대)?$/u)
  if (numeric !== null) return Number(numeric[1]) > 0
  return /^(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)\s*(?:개|박스|점|대)$/u.test(normalized)
}

function isPositiveWeight(value: JsonValue): boolean {
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') {
    const match = value
      .trim()
      .toLocaleLowerCase('ko-KR')
      .match(/^(\d+(?:\.\d+)?)\s*(?:kg|g|킬로그램|킬로|그램)$/u)
    return match !== null && Number(match[1]) > 0
  }
  if (!isJsonObject(value)) return false

  const amount = value.amount ?? value.value
  const unit = value.unit
  return (
    typeof amount === 'number' &&
    amount > 0 &&
    typeof unit === 'string' &&
    /^(?:kg|g|킬로그램|킬로|그램)$/u.test(unit.trim().toLocaleLowerCase('ko-KR'))
  )
}

function isMeaningfulJson(value: JsonValue): boolean {
  if (value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.length > 0 && value.every(isMeaningfulJson)
  return Object.keys(value).length > 0 && Object.values(value).every(isMeaningfulJson)
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
