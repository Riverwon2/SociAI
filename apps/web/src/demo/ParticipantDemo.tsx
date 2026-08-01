import { useState, type ReactNode } from 'react'

import type { FixtureReplayDecision } from './fixture-replay-plan.js'
import type {
  HelperConnectionView,
  ParticipantDemoView,
  RequesterDemoStage
} from './participant-demo-model.js'

export type { FixtureReplayDecision }

interface ParticipantDemoProps {
  readonly view: ParticipantDemoView
  readonly mode: 'live' | 'replay'
  readonly pendingDecisions: ReadonlyMap<string, FixtureReplayDecision>
  readonly replayFeedback: string | null
  readonly onFixtureDecision: (taskId: string, decision: FixtureReplayDecision) => void
  readonly completedTaskIds: readonly string[]
  readonly onMissionComplete: (taskId: string) => void
  readonly thanksMessages: Readonly<Record<string, string>>
  readonly onSendThanks: (taskId: string, message: string) => void
  readonly onReset: () => void
}

export function ParticipantDemo({
  view,
  mode,
  pendingDecisions,
  replayFeedback,
  onFixtureDecision,
  completedTaskIds,
  onMissionComplete,
  thanksMessages,
  onSendThanks,
  onReset
}: ParticipantDemoProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const isSplit = view.helpers.length > 1
  const selected = view.helpers.find((helper) => helper.taskId === selectedTaskId) ?? null
  const helper = isSplit ? selected : (view.helpers[0] ?? null)
  const requesterOnly = view.clarificationResults.length > 0 && view.helpers.length === 0
  // Every helper keeps its own screen at all times. Selecting one only changes
  // which connection the requester panel is looking at.
  const shownHelpers: readonly (HelperConnectionView | null)[] = requesterOnly
    ? []
    : view.helpers.length > 0
      ? view.helpers
      : [null]
  const isGrid = shownHelpers.length > 1

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

      <div
        className={`participant-split ${isGrid ? 'is-grid' : ''} ${requesterOnly ? 'is-requester-only' : ''}`}
      >
        <article
          className="participant-screen requester-screen"
          aria-labelledby="requester-heading"
        >
          <ScreenChrome label="신청자 화면" tone="requester" />
          <div className="requester-content" aria-live="polite">
            {isSplit && selected !== null && (
              <button
                className="helper-back-button"
                type="button"
                onClick={() => setSelectedTaskId(null)}
              >
                ← 도우미 목록으로
              </button>
            )}
            <RequesterBody
              view={view}
              helpers={helper === null ? view.helpers : [helper]}
              thanksHelper={helper}
              isSplit={isSplit}
              thanksMessages={thanksMessages}
              completedTaskIds={completedTaskIds}
              onSendThanks={onSendThanks}
            >
              {isSplit && selected === null && (
                <HelperDirectory
                  helpers={view.helpers}
                  pendingDecisions={pendingDecisions}
                  completedTaskIds={completedTaskIds}
                  thanksMessages={thanksMessages}
                  onSelect={setSelectedTaskId}
                />
              )}
            </RequesterBody>
            {view.result !== null && (
              <button className="participant-reset" type="button" onClick={onReset}>
                새 도움 요청하기
              </button>
            )}
          </div>
        </article>

        {shownHelpers.map((item, index) => (
          <article
            className={`participant-screen helper-screen helper-slot--${index + 1} ${
              item !== null && item.taskId === selectedTaskId ? 'is-focused' : ''
            }`}
            aria-labelledby={`helper-heading-${index}`}
            key={item?.taskId ?? 'helper-waiting'}
          >
            <ScreenChrome
              label={isSplit ? `도움 수락자 ${index + 1} 화면` : '도움 수락자 화면'}
              tone="helper"
              {...(item?.candidateName == null
                ? {}
                : { profile: `${item.candidateName}님의 화면` })}
            />
            <div className="helper-content" aria-live="polite">
              <HelperPanel
                helper={item}
                headingId={`helper-heading-${index}`}
                mode={mode}
                pendingDecision={item === null ? null : (pendingDecisions.get(item.taskId) ?? null)}
                replayFeedback={replayFeedback}
                onFixtureDecision={onFixtureDecision}
                missionCompleted={item !== null && completedTaskIds.includes(item.taskId)}
                onMissionComplete={onMissionComplete}
                thanksMessage={item === null ? null : (thanksMessages[item.taskId] ?? null)}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function RequesterBody({
  view,
  helpers,
  thanksHelper,
  isSplit,
  thanksMessages,
  completedTaskIds,
  onSendThanks,
  children
}: {
  readonly view: ParticipantDemoView
  readonly helpers: readonly HelperConnectionView[]
  readonly thanksHelper: HelperConnectionView | null
  readonly isSplit: boolean
  readonly thanksMessages: Readonly<Record<string, string>>
  readonly completedTaskIds: readonly string[]
  readonly onSendThanks: (taskId: string, message: string) => void
  readonly children?: ReactNode
}) {
  const requester = requesterCopy(view)
  // The thank-you box belongs to one connection, so it only appears once that
  // helper is selected. The directory itself never shows it.
  const thanksTarget =
    thanksHelper !== null && completedTaskIds.includes(thanksHelper.taskId) ? thanksHelper : null

  return (
    <>
      <CareFace stage={view.requesterStage} />
      <div className="requester-message">
        <span className="eyebrow">도움 신청 현황</span>
        <h2 id="requester-heading">{requester.heading}</h2>
        {requester.description !== null && <p>{requester.description}</p>}
        <MatchedNeighbors helpers={helpers} isSplit={isSplit} />
      </div>
      {view.clarificationResults.length > 0 && (
        <div className="clarification-requester-results" aria-label="정보 확인 대화 의향 결과">
          {view.clarificationResults.map((result) => (
            <div className={`clarification-result is-${result.outcome}`} key={result.taskId}>
              <span aria-hidden="true">{result.outcome === 'conversation_agreed' ? '✓' : '–'}</span>
              <div>
                <small>정보 확인 대화 의향 · 실제 매칭 아님</small>
                <p>{result.requesterMessage}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {children}
      {thanksTarget !== null && (
        <ThanksPanel
          helper={thanksTarget}
          thanksMessage={thanksMessages[thanksTarget.taskId] ?? null}
          onSendThanks={onSendThanks}
        />
      )}
      {/* The directory already carries per-connection status on a split request. */}
      {thanksTarget === null && !isSplit && <RequesterProgress stage={view.requesterStage} />}
    </>
  )
}

function MatchedNeighbors({
  helpers,
  isSplit
}: {
  readonly helpers: readonly HelperConnectionView[]
  readonly isSplit: boolean
}) {
  // A split request already lists every connection in the directory, so repeating
  // them here only makes the requester screen taller.
  if (isSplit) return null
  const matched = helpers.filter(({ matchedCandidateName }) => matchedCandidateName !== null)
  if (matched.length === 0) return null

  return (
    <div className="matched-neighbor-stack">
      {matched.map((item) => (
        <div className="matched-neighbor" key={item.taskId}>
          <span aria-hidden="true">♥</span>
          <p>
            <strong>{item.matchedCandidateName}님</strong>이 도움을 수락했어요.
          </p>
        </div>
      ))}
    </div>
  )
}

function HelperDirectory({
  helpers,
  pendingDecisions,
  completedTaskIds,
  thanksMessages,
  onSelect
}: {
  readonly helpers: readonly HelperConnectionView[]
  readonly pendingDecisions: ReadonlyMap<string, FixtureReplayDecision>
  readonly completedTaskIds: readonly string[]
  readonly thanksMessages: Readonly<Record<string, string>>
  readonly onSelect: (taskId: string) => void
}) {
  return (
    <div className="helper-directory">
      <p className="helper-directory-title">
        {helpers.some(({ candidate }) => candidate !== null)
          ? `도우미 ${helpers.length}명과 따로 연결됐어요`
          : `도우미 ${helpers.length}명에게 나눠 요청해요`}
      </p>
      <p className="helper-directory-note">
        같은 시각에 겹친 일이라 이웃 여러 명에게 나눠 요청했어요. 눌러서 각 연결을 확인하세요.
      </p>
      <ul className="helper-directory-list">
        {helpers.map((helper, index) => (
          <li key={helper.taskId}>
            <button type="button" onClick={() => onSelect(helper.taskId)}>
              <span className="helper-directory-index">도우미 {index + 1}</span>
              <span className="helper-directory-body">
                <strong>{helper.candidateName ?? '연결 중'}</strong>
                <small>{helper.taskTitle}</small>
              </span>
              <span
                className={`helper-directory-status ${directoryStatusClass(helper, pendingDecisions, completedTaskIds, thanksMessages)}`}
              >
                {directoryStatusLabel(helper, pendingDecisions, completedTaskIds, thanksMessages)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function directoryStatusLabel(
  helper: HelperConnectionView,
  pendingDecisions: ReadonlyMap<string, FixtureReplayDecision>,
  completedTaskIds: readonly string[],
  thanksMessages: Readonly<Record<string, string>>
): string {
  if (thanksMessages[helper.taskId] !== undefined) return '감사 전달됨'
  if (completedTaskIds.includes(helper.taskId)) return '도움 완료'
  if (pendingDecisions.has(helper.taskId)) return '응답 필요'
  if (helper.stage === 'mission') return '수락됨'
  if (helper.stage === 'rerouting') return '재섭외 중'
  return '응답 대기'
}

function directoryStatusClass(
  helper: HelperConnectionView,
  pendingDecisions: ReadonlyMap<string, FixtureReplayDecision>,
  completedTaskIds: readonly string[],
  thanksMessages: Readonly<Record<string, string>>
): string {
  const label = directoryStatusLabel(helper, pendingDecisions, completedTaskIds, thanksMessages)
  if (label === '응답 필요') return 'is-waiting-action'
  if (label === '재섭외 중') return 'is-rerouting'
  if (label === '응답 대기') return 'is-idle'
  return 'is-done'
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

function ThanksPanel({
  helper,
  thanksMessage,
  onSendThanks
}: {
  readonly helper: HelperConnectionView
  readonly thanksMessage: string | null
  readonly onSendThanks: (taskId: string, message: string) => void
}) {
  const [draft, setDraft] = useState('')
  const recipient = `${helper.candidateName ?? '이웃'} · ${helper.taskTitle}`

  if (thanksMessage !== null) {
    return (
      <div className="thanks-panel thanks-panel--sent" role="status">
        <p className="thanks-title">감사의 마음을 전했어요</p>
        <small className="thanks-recipient">{recipient}</small>
        <blockquote>{thanksMessage}</blockquote>
        <small>수락자 화면으로 전달되었습니다.</small>
      </div>
    )
  }

  return (
    <form
      className="thanks-panel"
      onSubmit={(event) => {
        event.preventDefault()
        const message = draft.trim()
        if (message !== '') onSendThanks(helper.taskId, message)
      }}
    >
      <p className="thanks-title">도움이 완료되었습니다!</p>
      <small className="thanks-recipient">받는 사람 · {recipient}</small>
      <label>
        <span>감사의 메시지를 남겨주세요!</span>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="따뜻한 한마디를 남겨보세요"
          maxLength={200}
        />
      </label>
      <button type="submit" disabled={draft.trim() === ''}>
        메시지 보내기
      </button>
    </form>
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
  helper,
  headingId,
  mode,
  pendingDecision,
  replayFeedback,
  onFixtureDecision,
  missionCompleted,
  onMissionComplete,
  thanksMessage
}: {
  readonly helper: HelperConnectionView | null
  readonly headingId: string
  readonly mode: 'live' | 'replay'
  readonly pendingDecision: FixtureReplayDecision | null
  readonly replayFeedback: string | null
  readonly onFixtureDecision: (taskId: string, decision: FixtureReplayDecision) => void
  readonly missionCompleted: boolean
  readonly onMissionComplete: (taskId: string) => void
  readonly thanksMessage: string | null
}) {
  if (helper === null || helper.stage === 'waiting' || helper.requestCard === null) {
    return (
      <div className="helper-waiting">
        <span className="helper-radar" aria-hidden="true">
          <i />
        </span>
        <p className="eyebrow">우리 동네 도움</p>
        <h2 id={headingId}>새로운 도움 요청을 기다리고 있어요</h2>
        <p>가까운 곳에서 가능한 요청이 오면 이 화면에 알려드릴게요.</p>
      </div>
    )
  }

  if (helper.stage === 'mission') {
    return (
      <div className="helper-mission">
        <span className="mission-heart" aria-hidden="true">
          ♥
        </span>
        <p className="eyebrow">도움 연결 완료</p>
        <h2 id={headingId}>
          {missionCompleted ? '도움을 완료했어요' : '따뜻한 도움을 수락했어요'}
        </h2>
        <p>
          {missionCompleted
            ? '따뜻한 세상을 만드는 데 함께해 주셔서 감사합니다.'
            : '약속한 시간에 미션을 수행한 뒤 아래 완료 버튼을 눌러주세요.'}
        </p>
        {thanksMessage === null ? (
          <RequestSummary card={helper.requestCard} compact />
        ) : (
          <div className="thanks-received" role="status">
            <span aria-hidden="true">♥</span>
            <div>
              <small>신청자가 보낸 감사 메시지</small>
              <p>{thanksMessage}</p>
            </div>
          </div>
        )}
        <button
          className="mission-complete-button"
          type="button"
          onClick={() => onMissionComplete(helper.taskId)}
          disabled={missionCompleted}
        >
          {missionCompleted ? '미션 완료됨' : '미션 완료'}
        </button>
        <small className="demo-action-note">화면 데모용 동작 · 서버에는 전송되지 않습니다.</small>
      </div>
    )
  }

  if (helper.stage === 'rerouting') {
    return (
      <div className="helper-rerouting">
        <span aria-hidden="true">↻</span>
        <p className="eyebrow">다음 이웃 연결 중</p>
        <h2 id={headingId}>
          {helper.previousOutcome === 'timed_out'
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
      </div>
      <h2 id={headingId}>우리 동네에 도움이 필요해요</h2>
      <RequestSummary card={helper.requestCard} />
      <div className="helper-actions" aria-label="도움 요청 응답">
        <button
          className="helper-action-reject"
          type="button"
          disabled={mode !== 'replay' || pendingDecision === null}
          onClick={() => onFixtureDecision(helper.taskId, 'rejected')}
        >
          거절
        </button>
        <button
          className="helper-action-accept"
          type="button"
          disabled={mode !== 'replay' || pendingDecision === null}
          onClick={() => onFixtureDecision(helper.taskId, 'accepted')}
        >
          수락
        </button>
      </div>
      {mode === 'replay' && pendingDecision === 'timed_out' && (
        <button
          className="helper-timeout-action"
          type="button"
          onClick={() => onFixtureDecision(helper.taskId, 'timed_out')}
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
        {fixtureActionNote(mode, pendingDecision, helper.attempt)}
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
  readonly card: NonNullable<HelperConnectionView['requestCard']>
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
        {card.distanceKm !== null && (
          <b className="request-card-distance">{formatDistance(card.distanceKm)}</b>
        )}
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
    case 'clarification':
      return {
        heading: '정보 확인 대화 의향을 확인했어요',
        description: '작업은 정보 보류 상태이며, 실제 대화나 매칭은 아직 시작되지 않았어요.'
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

function formatDistance(distanceKm: number) {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1_000)}m`
  return `${distanceKm.toFixed(1)}km`
}
