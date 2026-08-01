import type { Candidate } from '@30-minute-exchange/contracts'

import type { TaskRunView } from '../state/run-state.js'

interface TaskBoardProps {
  readonly tasks: readonly TaskRunView[]
}

export function TaskBoard({ tasks }: TaskBoardProps) {
  return (
    <section className="panel task-panel" aria-labelledby="task-heading">
      <div className="panel-heading">
        <div>
          <p className="step-label">TASKS & NEIGHBORS</p>
          <h2 id="task-heading">작업별 진행 상태</h2>
        </div>
        <span className="sequence-counter">{tasks.length} tasks</span>
      </div>

      <div className="task-list">
        {tasks.map((task) => (
          <article className="task-card" key={task.taskId}>
            <header>
              <div>
                <span className={`status-pill ${statusClass(task.status)}`}>{task.status}</span>
                <h3>{task.title}</h3>
                <p>{task.description}</p>
              </div>
              <span className="duration-mark">{task.durationMinutes}분</span>
            </header>

            <div className="decision-row">
              <Decision label="안전" value={safetyLabel(task.safetyLevel)} />
              <Decision label="정보" value={sufficiencyLabel(task.sufficiencyStatus)} />
              <Decision label="섭외" value={`${task.attempts.length}/3회`} />
            </div>

            <BundleAssignment task={task} />

            <DecisionReasons label="안전 근거" codes={task.safetyReasonCodes} />
            <DecisionReasons label="정보 근거" codes={task.sufficiencyReasonCodes} />

            {(task.blockGuidance ?? task.safetyGuidance) !== null && (
              <p className="guidance-copy">{task.blockGuidance ?? task.safetyGuidance}</p>
            )}

            {task.candidates.length > 0 && (
              <div className="candidate-stack">
                <div className="subheading-row">
                  <h4>후보 점수 근거</h4>
                  <span>40 · 25 · 20 · 15</span>
                </div>
                {task.candidates.map((candidate) => (
                  <CandidateScore
                    candidate={candidate}
                    attempt={task.attempts.find(
                      ({ candidateId }) => candidateId === candidate.candidateId
                    )}
                    key={candidate.candidateId}
                  />
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
      {tasks.length === 0 && <p className="empty-state">요청을 작은 작업으로 나누고 있습니다.</p>}
    </section>
  )
}

function Decision({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span>
      <small>{label}</small>
      <b>{value}</b>
    </span>
  )
}

function BundleAssignment({ task }: { readonly task: TaskRunView }) {
  const { assignment, bundle } = task
  if (bundle === null && assignment === null) return null

  return (
    <div className="bundle-row">
      {bundle !== null && (
        <>
          <span>묶음</span>
          <code>{bundle.bundleId}</code>
          <b>
            총 {bundle.totalActivityDurationMinutes}분 · 대기 {bundle.waitingMinutes}분
          </b>
          {bundle.companionTaskIds.length > 0 && (
            <small>다른 작업 {bundle.companionTaskIds.length}개와 함께</small>
          )}
        </>
      )}
      {assignment !== null && (
        <>
          <span>배정</span>
          <b>{assignment.candidateName ?? assignment.candidateId}</b>
          <small>
            {formatWindow(assignment.startAt)}–{formatWindow(assignment.endAt)}
          </small>
        </>
      )}
    </div>
  )
}

function formatWindow(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(value))
}

function DecisionReasons({
  label,
  codes
}: {
  readonly label: string
  readonly codes: readonly string[]
}) {
  if (codes.length === 0) return null
  return (
    <div className="decision-reasons">
      <span>{label}</span>
      <ul>
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CandidateScore({
  candidate,
  attempt
}: {
  readonly candidate: Candidate
  readonly attempt: TaskRunView['attempts'][number] | undefined
}) {
  const scores = [
    ['가용성', candidate.scoreBreakdown.availability, '40%'],
    ['거리', candidate.scoreBreakdown.distance, '25%'],
    ['경험', candidate.scoreBreakdown.experience, '20%'],
    ['신뢰도', candidate.scoreBreakdown.reliability, '15%']
  ] as const

  return (
    <article className="candidate-card">
      <div className="candidate-identity">
        <span className="candidate-rank">{candidate.rank}</span>
        <div>
          <strong>{candidate.displayName}</strong>
          <small>{candidate.distanceKm.toFixed(1)}km · 합성 프로필</small>
        </div>
        <b className="total-score">{Math.round(candidate.scoreBreakdown.weightedTotal * 100)}</b>
      </div>
      <div className="score-grid">
        {scores.map(([label, value, weight]) => (
          <label key={label}>
            <span>
              {label} <small>{weight}</small>
            </span>
            <progress max="1" value={value} aria-label={`${candidate.displayName} ${label} 점수`} />
            <b>{Math.round(value * 100)}</b>
          </label>
        ))}
      </div>
      {attempt !== undefined && (
        <p className={`attempt-result attempt-result--${attempt.outcome}`}>
          {attempt.attempt}번째 섭외 · {attemptLabel(attempt.outcome)}
        </p>
      )}
    </article>
  )
}

function safetyLabel(value: string | null) {
  return value === null ? '대기' : value === 'low' ? '진행 가능' : value === 'high' ? '제외' : value
}

function sufficiencyLabel(value: string | null) {
  return value === null ? '대기' : value === 'sufficient' ? '충분' : '보류'
}

function statusClass(status: string) {
  if (status.includes('완료') || status.includes('수락')) return 'status-pill--success'
  if (status.includes('제외') || status.includes('실패')) return 'status-pill--danger'
  if (status.includes('거절') || status.includes('무응답')) return 'status-pill--warning'
  return 'status-pill--active'
}

function attemptLabel(outcome: TaskRunView['attempts'][number]['outcome']) {
  return {
    pending: '응답 대기',
    accepted: '수락',
    rejected: '거절',
    cancelled: '취소',
    timed_out: '가상 10분 무응답'
  }[outcome]
}
