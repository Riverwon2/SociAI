import {
  createInitialRequestSchemaForDate,
  type DemoScenarioFixture,
  type InitialRequest
} from '@30-minute-exchange/contracts'

export interface RequestFormFields {
  readonly helpDescription: string
  readonly startAt: string
  readonly endAt: string
  readonly regionLabel: string
  readonly approximateLocation: string
  readonly maxDuration: string
  readonly allowTimeAdjustment: boolean
  readonly allowPartialCompletion: boolean
  readonly allowScopeReduction: boolean
  readonly optionalNotes: string
}

export type RequestFormParseResult =
  | { readonly success: true; readonly request: InitialRequest }
  | { readonly success: false; readonly errors: readonly string[] }

export function fieldsFromFixture(fixture: DemoScenarioFixture): RequestFormFields {
  const { initialRequest } = fixture
  return {
    helpDescription: initialRequest.helpDescription,
    startAt: toSeoulDateTimeInput(initialRequest.timeWindow.startAt),
    endAt: toSeoulDateTimeInput(initialRequest.timeWindow.endAt),
    regionLabel: initialRequest.activityRegion.label,
    approximateLocation: initialRequest.activityRegion.approximateLocation,
    maxDuration: String(initialRequest.maxActivityDurationMinutes),
    allowTimeAdjustment: initialRequest.fallbackPolicy.allowTimeAdjustment,
    allowPartialCompletion: initialRequest.fallbackPolicy.allowPartialCompletion,
    allowScopeReduction: initialRequest.fallbackPolicy.allowScopeReduction,
    optionalNotes: initialRequest.optionalNotes ?? ''
  }
}

export function parseRequestForm(
  fields: RequestFormFields,
  requestId: string,
  today = getSeoulDate()
): RequestFormParseResult {
  const candidate = {
    schemaVersion: 2 as const,
    requestId,
    helpDescription: fields.helpDescription,
    timeWindow: {
      startAt: toSeoulIso(fields.startAt),
      endAt: toSeoulIso(fields.endAt)
    },
    maxActivityDurationMinutes: Number(fields.maxDuration),
    timeFlexibility: fields.allowTimeAdjustment
      ? ({ kind: 'flexible', maxShiftMinutes: 30 } as const)
      : ({ kind: 'fixed' } as const),
    activityRegion: {
      label: fields.regionLabel,
      approximateLocation: fields.approximateLocation
    },
    costPolicy: { choice: 'none', paymentMethod: 'not_applicable' } as const,
    fallbackPolicy: {
      allowTimeAdjustment: fields.allowTimeAdjustment,
      allowPartialCompletion: fields.allowPartialCompletion,
      allowScopeReduction: fields.allowScopeReduction
    },
    ...(fields.optionalNotes.trim() === '' ? {} : { optionalNotes: fields.optionalNotes })
  }

  const result = createInitialRequestSchemaForDate(today).safeParse(candidate)
  if (result.success) return { success: true, request: result.data }
  return {
    success: false,
    errors: [...new Set(result.error.issues.map(toKoreanValidationMessage))]
  }
}

export function getSeoulDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

function toSeoulDateTimeInput(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(value))
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}`
}

function toSeoulIso(value: string): string {
  return `${value}:00+09:00`
}

function toKoreanValidationMessage(issue: { readonly path: readonly PropertyKey[] }): string {
  const field = String(issue.path[0] ?? '')
  return (
    {
      helpDescription: '도움받을 내용을 입력해 주세요.',
      timeWindow: '희망 시간은 오늘 안에서 시작보다 종료가 늦어야 합니다.',
      maxActivityDurationMinutes: '활동 시간은 1분 이상 30분 이하로 입력해 주세요.',
      activityRegion: '활동 지역과 대략적인 위치를 입력해 주세요.',
      fallbackPolicy: '고정 시간 요청에서는 시간 조정을 허용할 수 없습니다.'
    }[field] ?? '입력값을 다시 확인해 주세요.'
  )
}

