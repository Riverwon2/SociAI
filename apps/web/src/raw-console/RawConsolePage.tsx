import { useEffect, useMemo, useState } from 'react'
import {
  appendRawToolEvent,
  correlateRawToolEvents,
  createRawToolEventBuffer
} from '@30-minute-exchange/event-stream'

import { subscribeToRawEvents, type BroadcastChannelFactory } from './raw-event-channel.js'

export const MAX_VISIBLE_RAW_CORRELATIONS = 200

export function RawConsolePage({
  channelFactory
}: {
  readonly channelFactory?: BroadcastChannelFactory
} = {}) {
  const query = new URLSearchParams(window.location.search)
  const mode = query.get('mode') === 'live' ? 'live' : 'replay'
  const runId = query.get('runId') ?? '아직 실행되지 않음'
  const [buffer, setBuffer] = useState(() => createRawToolEventBuffer({ runId }))
  const correlations = useMemo(() => correlateRawToolEvents(buffer.items), [buffer.items])
  const visibleCorrelations = correlations.slice(-MAX_VISIBLE_RAW_CORRELATIONS)
  const hiddenCorrelationCount = correlations.length - visibleCorrelations.length

  useEffect(() => {
    if (
      mode !== 'live' ||
      runId === '아직 실행되지 않음' ||
      (channelFactory === undefined && typeof BroadcastChannel === 'undefined')
    ) {
      return
    }
    const subscription = subscribeToRawEvents(
      runId,
      (event) => setBuffer((current) => appendRawToolEvent(current, event)),
      channelFactory
    )
    return () => subscription.close()
  }, [channelFactory, mode, runId])

  return (
    <main className="raw-page">
      <header className="raw-header">
        <div>
          <p className="raw-kicker">OPENAI PROVIDER TRACE</p>
          <h1>Raw tool events</h1>
        </div>
        <span className={`mode-badge mode-badge--${mode}`}>{mode.toUpperCase()}</span>
      </header>

      <section className="raw-run-meta" aria-label="실행 메타데이터">
        <div>
          <span>RUN ID</span>
          <code>{runId}</code>
        </div>
        <div>
          <span>STREAM</span>
          <code>RawToolEvent · OpenAI</code>
        </div>
        <div>
          <span>STATUS</span>
          <code>{mode === 'live' ? `${buffer.items.length} events` : 'raw 비활성'}</code>
        </div>
      </section>

      {correlations.length === 0 ? (
        <RawEmptyState mode={mode} />
      ) : (
        <section className="raw-event-list" aria-label="OpenAI raw tool events">
          {hiddenCorrelationCount > 0 && (
            <p className="raw-render-notice" role="status">
              화면 성능을 위해 최근 {MAX_VISIBLE_RAW_CORRELATIONS}개 호출만 표시합니다. 수신한 raw
              이벤트는 버퍼에서 삭제하거나 변경하지 않습니다.
            </p>
          )}
          {visibleCorrelations.map((correlation) => (
            <article className="raw-correlation" key={correlation.toolCallId}>
              <header>
                <div>
                  <span>TOOL CALL ID</span>
                  <code>{correlation.toolCallId}</code>
                </div>
                <b>{correlation.status}</b>
              </header>
              {[...correlation.callEvents, ...correlation.resultEvents]
                .sort((left, right) => left.sequence - right.sequence)
                .map((event) => (
                  <div className="raw-payload-row" key={event.eventId}>
                    <aside>
                      <span>#{event.sequence}</span>
                      <b>{event.direction}</b>
                      <time dateTime={event.occurredAt}>{event.occurredAt}</time>
                    </aside>
                    <pre>{JSON.stringify(event.raw, null, 2)}</pre>
                  </div>
                ))}
            </article>
          ))}
        </section>
      )}

      <footer className="raw-footer">
        <span>payload는 변형·요약·필터링하지 않습니다.</span>
        <span>call ↔ result · toolCallId</span>
      </footer>
    </main>
  )
}

function RawEmptyState({ mode }: { readonly mode: 'live' | 'replay' }) {
  return (
    <section className="raw-empty-state">
      <span aria-hidden="true">{'{ }'}</span>
      <h2>
        {mode === 'live'
          ? '실제 SDK 이벤트 연결을 기다립니다.'
          : 'Replay에는 raw 로그를 만들지 않습니다.'}
      </h2>
      <p>
        {mode === 'live'
          ? '서버의 실제 OpenAI 스트림이 연결되면 provider payload를 수정하지 않고 이곳에 표시합니다.'
          : '가짜 OpenAI payload를 보여주지 않기 위해 정규화된 fixture 이벤트만 주 화면에서 재생합니다.'}
      </p>
    </section>
  )
}

