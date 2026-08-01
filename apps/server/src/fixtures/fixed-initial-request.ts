import {
  InitialRequestSchema,
  SCHEMA_VERSION,
  type InitialRequest
} from '@30-minute-exchange/contracts'

export const FIXED_RUN_ID = 'run-fixed-library-return'

export const fixedInitialRequest: InitialRequest = InitialRequestSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  requestId: 'request-fixed-library-return',
  helpDescription:
    '미래구 중앙도서관에 예약한 책을 반납하러 가야 하는데, 30분 동안 동행이 필요합니다.',
  timeWindow: {
    startAt: '2026-08-03T10:00:00+09:00',
    endAt: '2026-08-03T10:30:00+09:00'
  },
  maxActivityDurationMinutes: 30,
  timeFlexibility: { kind: 'fixed' },
  activityRegion: {
    label: '미래구 중앙도서관 인근',
    approximateLocation: '미래구 별빛로 12 인근'
  },
  costPolicy: { choice: 'none', paymentMethod: 'not_applicable' },
  fallbackPolicy: {
    allowTimeAdjustment: false,
    allowPartialCompletion: false,
    allowScopeReduction: false
  },
  optionalNotes: '책 반납 절차를 함께 확인해 줄 이웃이면 좋겠습니다.'
})
