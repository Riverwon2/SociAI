import { Fragment } from 'react'
import type { AgentEvent } from '@30-minute-exchange/contracts'
import type { ConsumableAgentEvent } from '@30-minute-exchange/event-stream'

import { deriveTimelineDisplayGroups, type TimelineDisplayGroup } from './timeline-groups.js'

interface EventTimelineProps {
  readonly items: readonly ConsumableAgentEvent[]
}

const eventLabels: Record<AgentEvent['type'], string> = {
  'request.created': '요청 접수',
  'plan.created': '초기 계획',
  'task.created': '작업 분해',
  'safety.checked': '안전 확인',
  'sufficiency.checked': '정보 확인',
  'task.held': '작업 보류',
  'bundles.planned': '작업 묶음 계획',
  'assignments.planned': '이웃 배정 계획',
  'candidates.ranked': '후보 정렬',
  'bundle.candidates.ranked': '묶음 후보 정렬',
  'outreach.sent': '섭외 발송',
  'neighbor.replied': '이웃 응답',
  'outreach.timed_out': '응답 만료',
  'plan.updated': '계획 갱신',
  'match.confirmed': '매칭 확정',
  'task.blocked': '안전 제외',
  'tool.failed': '도구 오류',
  'request.completed': '실행 완료'
}

export function EventTimeline({ items }: EventTimelineProps) {
  const groupStarts = new Map(
    deriveTimelineDisplayGroups(items).flatMap((group) => {
      const firstItem = group.items[0]
      return firstItem === undefined ? [] : [[firstItem.eventId, group] as const]
    })
  )

  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-heading">
      <div className="panel-heading">
        <div>
          <p className="step-label">LIVE TRACE</p>
          <h2 id="timeline-heading">에이전트 실행 타임라인</h2>
        </div>
        <span className="sequence-counter">{items.length} events</span>
      </div>

      <ol className="timeline-list" aria-live="polite">
        {items.map((item) => (
          <Fragment key={item.eventId}>
            <TimelineGroupHeader group={groupStarts.get(item.eventId)} />
                <li
                  className={`timeline-item ${item.type === 'plan.updated' ? 'timeline-item--plan' : ''}`}
                  key={item.eventId}
                  data-event-type={item.type}
                  data-sequence={item.sequence}
                >
                  <span className="timeline-sequence">
                    {String(item.sequence).padStart(2, '0')}
                  </span>
                  <span className="timeline-dot" aria-hidden="true" />
                  <div className="timeline-content">
                    <div className="timeline-meta">
                      <strong>
                        {item.kind === 'known' ? eventLabels[item.event.type] : '알 수 없는 이벤트'}
                      </strong>
                      <time dateTime={item.occurredAt}>{formatTime(item.occurredAt)}</time>
                      {item.isSimulation && <span className="tiny-badge">SIMULATION</span>}
                    </div>
                    <p>{item.message}</p>
                    {item.kind === 'known' && item.event.type === 'plan.updated' && (
                      <PlanUpdateDetails data={item.event.data} />
                    )}
                    {item.kind === 'unknown' && (
                      <p className="unknown-event-copy">
                        <code>{item.type}</code> — 지원하지 않는 이벤트지만 실행은 계속됩니다.
                      </p>
                    )}
                  </div>
                </li>
          </Fragment>
        ))}
      </ol>
      {items.length === 0 && <p className="empty-state">첫 이벤트를 기다리고 있습니다.</p>}
    </section>
  )
}

function TimelineGroupHeader({ group }: { readonly group: TimelineDisplayGroup | undefined }) {
  if (group === undefined || group.kind === 'run') return null

  return (
    <li
      className="timeline-group-header"
      data-timeline-group={group.key}
      data-bundle-ids={group.bundleIds.join(',') || undefined}
    >
      <span>{group.kind === 'task' ? 'TASK' : 'BUNDLE'}</span>
      {group.bundleIds.map((bundleId) => (
        <code key={bundleId}>{bundleId}</code>
      ))}
      {group.assignmentIds.map((assignmentId) => (
        <code className="timeline-assignment-id" key={assignmentId}>
          {assignmentId}
        </code>
      ))}
    </li>
  )
}

function PlanUpdateDetails({
  data
}: {
  readonly data: Extract<AgentEvent, { type: 'plan.updated' }>['data']
}) {
  return (
    <div className="plan-update-card">
      <div>
        <span>트리거</span>
        <p>
          <code>{data.trigger}</code>
        </p>
      </div>
      <div>
        <span>관찰</span>
        <p>{data.observation}</p>
      </div>
      <div>
        <span>이전 행동</span>
        <p>{data.previousAction}</p>
      </div>
      <div>
        <span>다음 행동</span>
        <p>{data.nextAction}</p>
      </div>
      <footer>
        <b>REV.{data.revision}</b>
        <code>{data.policyApplied}</code>
        <span>추가 입력 없음</span>
      </footer>
    </div>
  )
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(value))
}
