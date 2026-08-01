import type { SafetyAction, SafetyLevel } from '@30-minute-exchange/contracts'

import { SAFETY_REASON_CODES, type SafetyReasonCode } from './reason-codes.js'
import type { SafetyIntentPattern } from './text-normalizer.js'

export type SafetyRule = Readonly<{
  id: string
  level: SafetyLevel
  action: SafetyAction
  reasonCode: SafetyReasonCode
  directPhrases: readonly string[]
  intentPatterns: readonly SafetyIntentPattern[]
  conditions: readonly string[]
  guidance?: string
}>

export const SAFETY_RULES: readonly SafetyRule[] = Object.freeze([
  {
    id: 'emergency-situation',
    level: 'emergency',
    action: 'emergency_guidance',
    reasonCode: SAFETY_REASON_CODES.emergencySituation,
    directPhrases: [
      '의식이 없',
      '의식 없음',
      '숨을 못 쉬',
      '숨이 안 쉬',
      '숨 쉬기 어렵',
      '호흡이 어렵',
      '호흡 곤란',
      '심한 출혈',
      '피가 멈추지',
      '가슴 통증',
      '쓰러',
      '경련',
      '응급 상황',
      '119를 불러'
    ],
    intentPatterns: [],
    conditions: [],
    guidance: '즉시 119 등 지역 응급 서비스에 연락하세요.'
  },
  {
    id: 'medication-assistance',
    level: 'high',
    action: 'block',
    reasonCode: SAFETY_REASON_CODES.medicationAssistance,
    directPhrases: ['처방약 복용', '약 복용 보조', '약을 먹여', '약 먹여', '투약', '복약 지도'],
    intentPatterns: [
      {
        objectTerms: ['처방약', '약', '알약', '복약'],
        actionTerms: ['복용을 도와', '복용 보조', '먹이', '먹여', '투약', '복약 지도', '챙겨 먹']
      }
    ],
    conditions: [],
    guidance: '약 복용에 직접 관여하는 요청은 일반 이웃 매칭에서 제외됩니다.'
  },
  {
    id: 'medical-procedure',
    level: 'high',
    action: 'block',
    reasonCode: SAFETY_REASON_CODES.medicalProcedure,
    directPhrases: ['주사를 놓', '상처를 소독', '혈당 측정', '의료 처치', '의료 시술'],
    intentPatterns: [
      {
        objectTerms: ['상처', '환부', '몸'],
        actionTerms: ['소독', '빨간약을 바르', '빨간약을 발라', '약을 바르', '처치']
      },
      {
        objectTerms: ['주사', '혈당', '붕대'],
        actionTerms: ['놓', '주입', '측정', '갈아', '교체']
      }
    ],
    conditions: [],
    guidance: '의료 처치는 일반 이웃 매칭에서 제외됩니다.'
  },
  {
    id: 'cash-handling',
    level: 'high',
    action: 'block',
    reasonCode: SAFETY_REASON_CODES.cashHandling,
    directPhrases: ['돈을 찾아', '현금을 대신', '비밀번호를 알려'],
    intentPatterns: [
      {
        objectTerms: ['현금', '돈', '카드', '계좌', '비밀번호', 'atm'],
        actionTerms: [
          '인출해',
          '인출하',
          '인출을 대신',
          '인출 부탁',
          '출금해',
          '출금하',
          '뽑',
          '찾아',
          '이체해',
          '이체하',
          '이체를 대신',
          '송금해',
          '송금하',
          '결제해',
          '결제하',
          '비밀번호를 알려'
        ]
      }
    ],
    conditions: [],
    guidance: '요청자를 대신한 현금 및 금융 처리는 일반 이웃 매칭에서 제외됩니다.'
  },
  {
    id: 'unsupervised-child-care',
    level: 'high',
    action: 'block',
    reasonCode: SAFETY_REASON_CODES.unsupervisedChildCare,
    directPhrases: [
      '아이를 혼자 돌봐',
      '아동 단독 돌봄',
      '아이를 맡아',
      '아이를 봐줘',
      '애를 봐줘'
    ],
    intentPatterns: [
      {
        objectTerms: ['아이', '아동', '어린이', '유치원생', '애'],
        actionTerms: ['혼자 돌봐', '단독 돌봄', '맡아', '맡아줘', '봐줘', '봐 주세요']
      },
      {
        objectTerms: ['아이', '아동', '어린이', '유치원생', '애'],
        actionTerms: ['있어 줘', '있어 주', '있어주세요', '함께 있어'],
        contextTerms: ['부모가 없는', '보호자가 없는', '단둘이', '돌아올 때까지', '혼자', '단독']
      }
    ],
    conditions: [],
    guidance: '아동 단독 돌봄은 일반 이웃 매칭에서 제외됩니다.'
  },
  {
    id: 'indoor-entry',
    level: 'conditional',
    action: 'verify_conditions',
    reasonCode: SAFETY_REASON_CODES.indoorEntryRequiresVerification,
    directPhrases: [],
    intentPatterns: [
      {
        objectTerms: ['집', '자택', '주택', '회사', '사무실', '사업장'],
        actionTerms: ['들어', '출입'],
        maxDistanceCharacters: 32
      }
    ],
    conditions: ['집 또는 회사 출입 시 요청자 또는 보호자가 현장에 있어야 합니다.']
  },
  {
    id: 'heavy-item',
    level: 'conditional',
    action: 'verify_conditions',
    reasonCode: SAFETY_REASON_CODES.heavyItemRequiresVerification,
    directPhrases: ['무거운 물건', '대형 가구', '무거운 상자'],
    intentPatterns: [
      {
        objectTerms: ['물건', '상자', '가구', '짐'],
        actionTerms: ['옮', '들어', '운반'],
        contextTerms: ['무거운', '대형', '큰 가구', '큰 상자']
      }
    ],
    conditions: ['물품 무게와 30분 이내 수행 가능 여부가 확인되어야 합니다.']
  }
])
