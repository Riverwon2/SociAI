import type { SafetyAction, SafetyLevel } from '@30-minute-exchange/contracts'

import { SAFETY_REASON_CODES, type SafetyReasonCode } from './reason-codes.js'

export type SafetyRule = Readonly<{
  id: string
  level: SafetyLevel
  action: SafetyAction
  reasonCode: SafetyReasonCode
  phrases: readonly string[]
  conditions: readonly string[]
  guidance?: string
}>

export const SAFETY_RULES: readonly SafetyRule[] = Object.freeze([
  {
    id: 'emergency-situation',
    level: 'emergency',
    action: 'emergency_guidance',
    reasonCode: SAFETY_REASON_CODES.emergencySituation,
    phrases: [
      '의식이 없다',
      '의식 없음',
      '숨을 못 쉰다',
      '호흡 곤란',
      '심한 출혈',
      '가슴 통증',
      '쓰러졌다',
      '응급 상황'
    ],
    conditions: [],
    guidance: '즉시 119 등 지역 응급 서비스에 연락하세요.'
  },
  {
    id: 'medication-assistance',
    level: 'high',
    action: 'block',
    reasonCode: SAFETY_REASON_CODES.medicationAssistance,
    phrases: ['처방약 복용', '약 복용 보조', '약을 먹여', '투약', '복약 지도'],
    conditions: [],
    guidance: '약 복용에 직접 관여하는 요청은 일반 이웃 매칭에서 제외됩니다.'
  },
  {
    id: 'medical-procedure',
    level: 'high',
    action: 'block',
    reasonCode: SAFETY_REASON_CODES.medicalProcedure,
    phrases: ['주사를 놓', '상처를 소독', '혈당 측정', '의료 처치', '의료 시술'],
    conditions: [],
    guidance: '의료 처치는 일반 이웃 매칭에서 제외됩니다.'
  },
  {
    id: 'cash-handling',
    level: 'high',
    action: 'block',
    reasonCode: SAFETY_REASON_CODES.cashHandling,
    phrases: ['현금 인출', '돈을 찾아', '현금을 대신', '계좌 이체', '비밀번호를 알려'],
    conditions: [],
    guidance: '요청자를 대신한 현금 및 금융 처리는 일반 이웃 매칭에서 제외됩니다.'
  },
  {
    id: 'unsupervised-child-care',
    level: 'high',
    action: 'block',
    reasonCode: SAFETY_REASON_CODES.unsupervisedChildCare,
    phrases: ['아이를 혼자 돌봐', '아동 단독 돌봄', '아이를 맡아', '아이를 봐줘'],
    conditions: [],
    guidance: '아동 단독 돌봄은 일반 이웃 매칭에서 제외됩니다.'
  },
  {
    id: 'indoor-entry',
    level: 'conditional',
    action: 'verify_conditions',
    reasonCode: SAFETY_REASON_CODES.indoorEntryRequiresVerification,
    phrases: ['집 안으로', '실내 출입', '집 안에 들어'],
    conditions: ['실내 출입 허용 여부와 안전한 전달 위치가 사전에 확인되어야 합니다.']
  },
  {
    id: 'heavy-item',
    level: 'conditional',
    action: 'verify_conditions',
    reasonCode: SAFETY_REASON_CODES.heavyItemRequiresVerification,
    phrases: ['무거운 물건', '대형 가구', '무거운 상자'],
    conditions: ['물품 무게와 30분 이내 수행 가능 여부가 확인되어야 합니다.']
  }
])
