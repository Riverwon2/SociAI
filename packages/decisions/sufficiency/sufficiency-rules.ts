import type { MissingInformation, Task } from '@30-minute-exchange/contracts'

import { normalizeSafetyText } from '../safety/text-normalizer.js'

export const SUFFICIENCY_FACT_CODES = Object.freeze({
  taskObject: 'task_object',
  taskScope: 'task_scope',
  pickupPoint: 'pickup_point',
  dropoffPoint: 'dropoff_point',
  itemQuantity: 'item_quantity',
  itemWeight: 'item_weight',
  requiredEquipment: 'required_equipment'
} as const)

export type SufficiencyFactCode =
  (typeof SUFFICIENCY_FACT_CODES)[keyof typeof SUFFICIENCY_FACT_CODES]

type SufficiencyRule = Readonly<{
  code: SufficiencyFactCode
  message: string
  isMissing: (text: string) => boolean
}>

const TRANSPORT_ACTION_PATTERN = /(?:가져다|가져오|전달|배달|옮|운반)/u
const PICKUP_ACTION_PATTERN = /(?:가져다|가져오|받아|수령)/u
const DROPOFF_ACTION_PATTERN = /(?:가져다|전달|배달|옮|운반|놓)/u
const BULK_OBJECT_PATTERN = /(?:상자|짐|물건|가구)/u
const LARGE_OR_HEAVY_PATTERN = /(?:무거운|대형|큰\s*(?:가구|상자|짐|물건))/u
const LARGE_ITEM_PATTERN = /(?:대형\s*(?:가구|상자|짐|물건)|큰\s*(?:가구|상자|짐|물건))/u
const HAS_PICKUP_PATTERN = /(?:에서|로부터)/u
const HAS_DROPOFF_PATTERN = /\S+(?:에|에게|으로|로|까지)\s*(?:전달|배달|가져다|옮|운반|놓)/u
const HAS_QUANTITY_PATTERN =
  /(?:\d+\s*(?:개|박스|점|대)|(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)\s*(?:개|박스|점|대)|(?:하나|둘|셋|넷))/u
const HAS_WEIGHT_PATTERN = /\d+(?:\.\d+)?\s*(?:kg|g|킬로그램|킬로|그램)/u
const HAS_EQUIPMENT_PATTERN = /(?:장비|카트|손수레|운반\s*도구)/u

const SUFFICIENCY_RULES: readonly SufficiencyRule[] = Object.freeze([
  {
    code: SUFFICIENCY_FACT_CODES.taskObject,
    message: '무엇을 수행 대상으로 하는지 확인할 수 없습니다.',
    isMissing: (text) => /(?:^|\s)(?:이거|저거|그거|그것|무언가|뭔가)(?:\s|$)/u.test(text)
  },
  {
    code: SUFFICIENCY_FACT_CODES.taskScope,
    message: '요청한 작업 범위를 확인할 수 없습니다.',
    isMissing: (text) =>
      /(?:가구|짐|물건)\s*(?:을|를)?\s*(?:정리|처리)/u.test(text) ||
      /(?:이것|이거|저것|저거)?\s*좀\s*도와/u.test(text)
  },
  {
    code: SUFFICIENCY_FACT_CODES.pickupPoint,
    message: '물품을 가져올 위치를 확인할 수 없습니다.',
    isMissing: (text) => PICKUP_ACTION_PATTERN.test(text) && !HAS_PICKUP_PATTERN.test(text)
  },
  {
    code: SUFFICIENCY_FACT_CODES.dropoffPoint,
    message: '물품을 전달할 위치를 확인할 수 없습니다.',
    isMissing: (text) => DROPOFF_ACTION_PATTERN.test(text) && !HAS_DROPOFF_PATTERN.test(text)
  },
  {
    code: SUFFICIENCY_FACT_CODES.itemQuantity,
    message: '수행시간에 영향을 주는 물품 수량을 확인할 수 없습니다.',
    isMissing: (text) =>
      TRANSPORT_ACTION_PATTERN.test(text) &&
      BULK_OBJECT_PATTERN.test(text) &&
      !HAS_QUANTITY_PATTERN.test(text)
  },
  {
    code: SUFFICIENCY_FACT_CODES.itemWeight,
    message: '무겁거나 큰 물품의 무게를 확인할 수 없습니다.',
    isMissing: (text) =>
      TRANSPORT_ACTION_PATTERN.test(text) &&
      LARGE_OR_HEAVY_PATTERN.test(text) &&
      !HAS_WEIGHT_PATTERN.test(text)
  },
  {
    code: SUFFICIENCY_FACT_CODES.requiredEquipment,
    message: '대형 물품 운반에 별도 장비가 필요한지 확인할 수 없습니다.',
    isMissing: (text) =>
      TRANSPORT_ACTION_PATTERN.test(text) &&
      LARGE_ITEM_PATTERN.test(text) &&
      !HAS_EQUIPMENT_PATTERN.test(text)
  }
])

/** Combines explicit planner omissions with deterministic task-text requirements. */
export function getRequiredMissingInformation(task: Task): MissingInformation[] {
  const text = normalizeSafetyText(task.title, task.description)
  const required = task.missingInformation.map((information) => ({ ...information }))
  const existingCodes = new Set(required.map(({ code }) => code))

  for (const rule of SUFFICIENCY_RULES) {
    if (existingCodes.has(rule.code) || !rule.isMissing(text)) continue
    required.push({ code: rule.code, message: rule.message })
    existingCodes.add(rule.code)
  }

  return required
}
