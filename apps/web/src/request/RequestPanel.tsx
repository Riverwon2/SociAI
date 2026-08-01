import { useEffect, useState, type FormEvent } from 'react'
import type { DemoScenarioFixture, InitialRequest } from '@30-minute-exchange/contracts'

import { demoScenarios } from '../demo/scenarios.js'
import {
  fieldsFromFixture,
  parseRequestForm,
  type RequestFormFields
} from './request-form-model.js'

interface RequestPanelProps {
  readonly selectedScenarioId: DemoScenarioFixture['scenarioId']
  readonly executionMode: 'live' | 'replay'
  readonly liveAvailable: boolean
  readonly onScenarioChange: (scenarioId: DemoScenarioFixture['scenarioId']) => void
  readonly onExecutionModeChange: (mode: 'live' | 'replay') => void
  readonly onSubmitRequest: (request: InitialRequest) => void
}

export function RequestPanel({
  selectedScenarioId,
  executionMode,
  liveAvailable,
  onScenarioChange,
  onExecutionModeChange,
  onSubmitRequest
}: RequestPanelProps) {
  const scenario = demoScenarios.find(({ fixture }) => fixture.scenarioId === selectedScenarioId)
  if (scenario === undefined) throw new Error('Selected scenario is unavailable')

  // A request is always scheduled for the current local day, replay included, so
  // a fixture keeps its time of day and moves onto today. Building the fields and
  // validating them both fall back to that same day; pinning either one to the
  // fixture's own date makes the two disagree once that date has passed.
  const [fields, setFields] = useState(() => fieldsFromFixture(scenario.fixture))
  const [errors, setErrors] = useState<readonly string[]>([])

  useEffect(() => {
    setFields(fieldsFromFixture(scenario.fixture))
    setErrors([])
  }, [scenario])

  const update = <TKey extends keyof RequestFormFields>(
    key: TKey,
    value: RequestFormFields[TKey]
  ) => setFields((current) => ({ ...current, [key]: value }))

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = parseRequestForm(fields, scenario.fixture.initialRequest.requestId)
    if (!parsed.success) {
      setErrors(parsed.errors)
      return
    }
    setErrors([])
    onSubmitRequest(parsed.request)
  }

  return (
    <section className="request-shell" aria-labelledby="request-heading">
      <div className="request-intro">
        <p className="section-kicker">ONE-SHOT LOCAL CARE</p>
        <h1 id="request-heading">
          한 번 부탁하면,
          <br />
          <span>매칭될 때까지.</span>
        </h1>
        <p className="hero-copy">
          오늘 필요한 30분 이내의 생활지원을 적어주세요. 안전성을 먼저 확인하고, 조건에 맞는 이웃의
          자발적인 수락까지 이어갑니다.
        </p>
        <div className="promise-strip" aria-label="서비스 원칙">
          <span>추가 질문 없음</span>
          <span>비용 없음</span>
          <span>위험 작업만 제외</span>
        </div>
      </div>

      <form className="request-card" onSubmit={submit} noValidate>
        <div className="card-heading-row">
          <div>
            <p className="step-label">01 · 요청 준비</p>
            <h2>오늘 어떤 도움이 필요하세요?</h2>
          </div>
          <span className={`mode-badge mode-badge--${executionMode}`}>
            {executionMode === 'live' ? 'LIVE OPENAI' : 'FIXTURE REPLAY'}
          </span>
        </div>

        <div className="execution-mode-switch" role="group" aria-label="실행 방식">
          <button
            type="button"
            aria-pressed={executionMode === 'replay'}
            onClick={() => onExecutionModeChange('replay')}
          >
            Fixture replay
          </button>
          <button
            type="button"
            aria-pressed={executionMode === 'live'}
            disabled={!liveAvailable}
            onClick={() => onExecutionModeChange('live')}
          >
            Live {liveAvailable ? '연결' : '· 서버 대기'}
          </button>
        </div>

        <fieldset className="scenario-picker">
          <legend>대표 시나리오 불러오기</legend>
          <div className="scenario-grid">
            {demoScenarios.map(({ fixture, presentation }, index) => (
              <button
                className={`scenario-option scenario-option--${presentation.accent}`}
                type="button"
                key={fixture.scenarioId}
                aria-pressed={fixture.scenarioId === selectedScenarioId}
                onClick={() => onScenarioChange(fixture.scenarioId)}
              >
                <span className="scenario-number">0{index + 1}</span>
                <span>
                  <small>{presentation.eyebrow}</small>
                  <strong>{presentation.title}</strong>
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {errors.length > 0 && (
          <div className="error-summary" role="alert">
            <strong>요청을 제출하기 전에 확인해 주세요.</strong>
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <label className="field field--wide">
          <span>도움 내용</span>
          <textarea
            value={fields.helpDescription}
            onChange={(event) => update('helpDescription', event.target.value)}
            maxLength={2_000}
            required
          />
        </label>

        <div className="field-grid">
          <label className="field">
            <span>시작 시간</span>
            <input
              type="datetime-local"
              value={fields.startAt}
              onChange={(event) => update('startAt', event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>종료 시간</span>
            <input
              type="datetime-local"
              value={fields.endAt}
              onChange={(event) => update('endAt', event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>활동 지역</span>
            <input
              value={fields.regionLabel}
              onChange={(event) => update('regionLabel', event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>대략적인 위치</span>
            <input
              value={fields.approximateLocation}
              onChange={(event) => update('approximateLocation', event.target.value)}
              required
            />
          </label>
        </div>

        <label className="field field--wide">
          <span>
            추가 사항 <small>선택</small>
          </span>
          <input
            value={fields.optionalNotes}
            onChange={(event) => update('optionalNotes', event.target.value)}
            placeholder="접근성, 물품 무게, 실내 출입 여부 등"
            maxLength={2_000}
          />
        </label>

        <div className="privacy-note">
          <span aria-hidden="true">!</span>
          <p>
            라이브 데모에는 실제 이름, 정확한 주소, 연락처나 건강 정보를 입력하지 마세요. 현재
            후보와 응답은 모두 합성 데이터입니다.
          </p>
        </div>

        <button className="primary-action" type="submit">
          <span>이 요청으로 실행하기</span>
          <span aria-hidden="true">→</span>
        </button>
      </form>
    </section>
  )
}
