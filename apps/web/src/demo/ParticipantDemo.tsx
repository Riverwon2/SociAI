import type { ParticipantDemoView, RequesterDemoStage } from './participant-demo-model.js'

interface ParticipantDemoProps {
  readonly view: ParticipantDemoView
  readonly mode: 'live' | 'replay'
  readonly pendingReplayDecision: FixtureReplayDecision | null
  readonly replayFeedback: string | null
  readonly onFixtureDecision: (decision: FixtureReplayDecision) => void
  readonly missionCompleted: boolean
  readonly onMissionComplete: () => void
  readonly onReset: () => void
}

export type FixtureReplayDecision = 'accepted' | 'rejected' | 'timed_out'

export function ParticipantDemo({
  view,
  mode,
  pendingReplayDecision,
  replayFeedback,
  onFixtureDecision,
  missionCompleted,
  onMissionComplete,
  onReset
}: ParticipantDemoProps) {
  const requester = requesterCopy(view)

  return (
    <section className="participant-demo" aria-labelledby="participant-demo-heading">
      <header className="participant-demo-heading">
        <div>
          <p className="section-kicker">두 사람의 연결 화면</p>
          <h1 id="participant-demo-heading">도움을 요청하고, 이웃이 응답하는 순간</h1>
        </div>
        <div className="participant-demo-meta">
          <span className={`mode-badge mode-badge--${mode}`}>
            {mode === 'live' ? 'LIVE' : 'FIXTURE REPLAY'}
          </span>
          <span>모든 이름과 위치는 합성 정보입니다.</span>
        </div>
      </header>

      <div className="participant-split">
        <article
          className="participant-screen requester-screen"
          aria-labelledby="requester-heading"
        >
          <ScreenChrome label="신청자 화면" tone="requester" />
          <div className="requester-content" aria-live="polite">
            <CareFace stage={view.requesterStage} />
            <div className="requester-message">
              <span className="eyebrow">도움 신청 현황</span>
              <h2 id="requester-heading">{requester.heading}</h2>
              {requester.description !== null && <p>{requester.description}</p>}
              {view.matchedCandidateName !== null && (
                <div className="matched-neighbor">
                  <span aria-hidden="true">♥</span>
                  <p>
                    <strong>{view.matchedCandidateName}님</strong>이 도움을 수락했어요.
                  </p>
                </div>
              )}
            </div>
            <RequesterProgress stage={view.requesterStage} />
            {view.result !== null && (
              <button className="participant-reset" type="button" onClick={onReset}>
                새 도움 요청하기
              </button>
            )}
          </div>
        </article>

        <article className="participant-screen helper-screen" aria-labelledby="helper-heading">
          <ScreenChrome
            label="도움 수락자 화면"
            tone="helper"
            profile={
              view.candidate === null ? '이웃 화면' : `${view.candidate.displayName}님의 화면`
            }
          />
          <div className="helper-content" aria-live="polite">
            <HelperPanel
              view={view}
              mode={mode}
              pendingReplayDecision={pendingReplayDecision}
              replayFeedback={replayFeedback}
              onFixtureDecision={onFixtureDecision}
              missionCompleted={missionCompleted}
              onMissionComplete={onMissionComplete}
            />
          </div>
        </article>
      </div>
    </section>
  )
}

function ScreenChrome({
  label,
  tone,
  profile
}: {
  readonly label: string
  readonly tone: 'requester' | 'helper'
  readonly profile?: string
}) {
  return (
    <header className="participant-screen-header">
      <div className="screen-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <span className={`role-mark role-mark--${tone}`}>
          {tone === 'requester' ? '신청' : '수락'}
        </span>
        <strong>{label}</strong>
      </div>
      <small>{profile ?? '나의 요청'}</small>
    </header>
  )
}

const orbitHeartPositions = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight'
] as const

function CareFace({ stage }: { readonly stage: RequesterDemoStage }) {
  const settled = ['matched', 'partially_matched'].includes(stage)
  const stopped = ['safety_excluded', 'unmatched', 'failed'].includes(stage)
  return (
    <div
      className={`care-face-wrap ${settled ? 'care-face-wrap--settled' : ''} ${stopped ? 'care-face-wrap--stopped' : ''}`}
      aria-hidden="true"
    >
      {orbitHeartPositions.map((position) => (
        <span className={`orbit-heart orbit-heart--${position}`} key={position}>
          ♥
        </span>
      ))}
      <svg className="care-face" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r="70" />
        <path className="care-eye" d="M52 78c7-12 18-12 25 0" />
        <path className="care-eye" d="M103 78c7-12 18-12 25 0" />
        <path className="care-smile" d="M55 105c17 28 53 28 70 0" />
      </svg>
    </div>
  )
}

function RequesterProgress({ stage }: { readonly stage: RequesterDemoStage }) {
  const current = requesterProgress(stage)
  return (
    <ol className="requester-progress" aria-label="도움 신청 진행 단계">
      {['요청 접수', '이웃 찾기', '연결 결과'].map((label, index) => {
        const step = index + 1
        return (
          <li
            className={step < current ? 'is-complete' : step === current ? 'is-current' : ''}
            key={label}
          >
            <span>{step < current ? '✓' : step}</span>
            <small>{label}</small>
          </li>
        )
      })}
    </ol>
  )
}

function HelperPanel({
  view,
  mode,
  pendingReplayDecision,
  replayFeedback,
  onFixtureDecision,
  missionCompleted,
  onMissionComplete
}: {
  readonly view: ParticipantDemoView
  readonly mode: 'live' | 'replay'
  readonly pendingReplayDecision: FixtureReplayDecision | null
  readonly replayFeedback: string | null
  readonly onFixtureDecision: (decision: FixtureReplayDecision) => void
  readonly missionCompleted: boolean
  readonly onMissionComplete: () => void
}) {
  if (view.helperStage === 'waiting' || view.requestCard === null) {
    return (
      <div className="helper-waiting">
        <span className="helper-radar" aria-hidden="true">
          <i />
        </span>
        <p className="eyebrow">우리 동네 도움</p>
        <h2 id="helper-heading">새로운 도움 요청을 기다리고 있어요</h2>
        <p>가까운 곳에서 가능한 요청이 오면 이 화면에 알려드릴게요.</p>
      </div>
    )
  }

  if (view.helperStage === 'mission') {
    return (
      <div className="helper-mission">
        <span className="mission-heart" aria-hidden="true">
          ♥
        </span>
        <p className="eyebrow">도움 연결 완료</p>
        <h2 id="helper-heading">
          {missionCompleted ? '도움을 완료했어요' : '따뜻한 도움을 수락했어요'}
        </h2>
        <p>
          {missionCompleted
            ? '따뜻한 세상을 만드는 데 함께해 주셔서 감사합니다.'
            : '약속한 시간에 미션을 수행한 뒤 아래 완료 버튼을 눌러주세요.'}
        </p>
        <RequestSummary card={view.requestCard} compact />
        <button
          className="mission-complete-button"
          type="button"
          onClick={onMissionComplete}
          disabled={missionCompleted}
        >
          {missionCompleted ? '미션 완료됨' : '미션 완료'}
        </button>
        <small className="demo-action-note">화면 데모용 동작 · 서버에는 전송되지 않습니다.</small>
      </div>
    )
  }

  if (view.helperStage === 'rerouting') {
    return (
      <div className="helper-rerouting">
        <span aria-hidden="true">↻</span>
        <p className="eyebrow">다음 이웃 연결 중</p>
        <h2 id="helper-heading">
          {view.previousOutcome === 'timed_out'
            ? '응답 시간이 지나 다음 이웃을 찾고 있어요'
            : '이번 이웃이 거절해 다음 이웃을 찾고 있어요'}
        </h2>
        <p>신청자는 다시 입력할 필요 없이 기존 조건 안에서 연결이 계속됩니다.</p>
      </div>
    )
  }

  return (
    <div className="helper-request">
      <div className="incoming-request-label">
        <span>새 도움 요청</span>
        <b>{formatDistance(view.requestCard.distanceKm)}</b>
      </div>
      <h2 id="helper-heading">우리 동네에 도움이 필요해요</h2>
      <RequestSummary card={view.requestCard} />
      <div className="helper-actions" aria-label="도움 요청 응답">
        <button
          className="helper-action-reject"
          type="button"
          disabled={mode !== 'replay' || pendingReplayDecision === null}
          onClick={() => onFixtureDecision('rejected')}
        >
          거절
        </button>
        <button
          className="helper-action-accept"
          type="button"
          disabled={mode !== 'replay' || pendingReplayDecision === null}
          onClick={() => onFixtureDecision('accepted')}
        >
          수락
        </button>
      </div>
      {mode === 'replay' && pendingReplayDecision === 'timed_out' && (
        <button
          className="helper-timeout-action"
          type="button"
          onClick={() => onFixtureDecision('timed_out')}
        >
          응답하지 않고 시간 보내기
        </button>
      )}
      {replayFeedback !== null && (
        <p className="fixture-action-feedback" role="status">
          {replayFeedback}
        </p>
      )}
      <small className="demo-action-note">
        {fixtureActionNote(mode, pendingReplayDecision, view.attempt)}
      </small>
    </div>
  )
}

function fixtureActionNote(
  mode: 'live' | 'replay',
  pendingDecision: FixtureReplayDecision | null,
  attempt: number | null
) {
  if (mode === 'live') return '실제 수락과 거절 전송은 서버 응답 기능이 연결된 뒤 활성화됩니다.'
  if (pendingDecision === null) return '다음 응답 장면을 준비하고 있습니다.'
  return `자동으로 넘어가지 않습니다. ${fixtureDecisionLabel(pendingDecision)}을 눌러 ${attempt ?? 1}번째 응답을 계속하세요.`
}

function fixtureDecisionLabel(decision: FixtureReplayDecision) {
  if (decision === 'accepted') return '수락'
  if (decision === 'rejected') return '거절'
  return '응답 시간 넘기기'
}

function RequestSummary({
  card,
  compact = false
}: {
  readonly card: NonNullable<ParticipantDemoView['requestCard']>
  readonly compact?: boolean
}) {
  return (
    <div className={compact ? 'participant-request-card is-compact' : 'participant-request-card'}>
      <div className="request-card-title">
        <span aria-hidden="true">✦</span>
        <div>
          <small>요청 내용</small>
          <strong>{card.title}</strong>
        </div>
      </div>
      {!compact && <p>{card.description}</p>}
      <dl>
        <div>
          <dt>지역</dt>
          <dd>{card.regionLabel}</dd>
        </div>
        <div>
          <dt>시간</dt>
          <dd>{formatWindow(card.startAt, card.endAt)}</dd>
        </div>
        <div>
          <dt>예상 소요</dt>
          <dd>{card.durationMinutes}분</dd>
        </div>
        <div>
          <dt>만날 곳</dt>
          <dd>{card.approximateLocation}</dd>
        </div>
      </dl>
    </div>
  )
}

function requesterCopy(view: ParticipantDemoView) {
  switch (view.requesterStage) {
    case 'preparing':
      return {
        heading: '요청을 안전하게 정리하고 있어요',
        description: '필요한 도움과 시간을 확인하고 있어요. 잠시만 기다려 주세요.'
      }
    case 'searching':
      return {
        heading: '도움을 요청할 이웃을 찾고 있어요',
        description: '가까이 있고 시간이 맞는 이웃에게 차례대로 요청하고 있어요.'
      }
    case 'matched':
      return { heading: '모든 도움이 연결됐어요', description: null }
    case 'partially_matched':
      return {
        heading: '안전한 도움만 연결됐어요',
        description:
          view.result?.userMessage ?? '진행 가능한 도움은 연결하고 위험한 요청은 제외했어요.'
      }
    case 'safety_excluded':
      return {
        heading: '안전을 위해 이 도움은 연결하지 않았어요',
        description: view.result?.userMessage ?? '일반 이웃이 수행하기 어려운 요청으로 확인됐어요.'
      }
    case 'unmatched':
      return {
        heading: '이번에는 도움을 줄 이웃을 찾지 못했어요',
        description: view.result?.userMessage ?? '허용된 범위에서 가능한 이웃을 모두 확인했어요.'
      }
    case 'failed':
      return {
        heading: '요청 처리를 안전하게 멈췄어요',
        description: '현재 연결 상태를 확인한 뒤 새 요청으로 다시 시작해 주세요.'
      }
  }
}

function requesterProgress(stage: RequesterDemoStage) {
  if (stage === 'preparing') return 1
  if (stage === 'searching') return 2
  return 3
}

function formatWindow(startAt: string, endAt: string) {
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Seoul'
  })
  return `${formatter.format(new Date(startAt))}–${formatter.format(new Date(endAt))}`
}

function formatDistance(distanceKm: number | null) {
  if (distanceKm === null) return '가까운 이웃'
  if (distanceKm < 1) return `${Math.round(distanceKm * 1_000)}m 거리`
  return `${distanceKm.toFixed(1)}km 거리`
}
