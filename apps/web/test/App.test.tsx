import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawToolEvent } from '@30-minute-exchange/contracts'
import {
  appendNormalizedEvent,
  createNormalizedEventBuffer
} from '@30-minute-exchange/event-stream'

import { App } from '../src/App.js'
import { buildFixtureEvents } from '../src/demo/fixture-events.js'
import { getDemoScenario } from '../src/demo/scenarios.js'
import {
  LiveRunStartError,
  type LiveRunTransport,
  type LiveStreamSink
} from '../src/live/live-run-session.js'
import { EventTimeline } from '../src/timeline/EventTimeline.js'

describe('role 3 demo UI', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.history.replaceState({}, '', '/')
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('waits for the helper to accept before reaching a full match', async () => {
    render(<App replayIntervalMs={1} />)

    fireEvent.click(screen.getByRole('button', { name: /이 요청으로 실행하기/ }))

    expect(
      screen.queryByRole('heading', { name: '오늘 어떤 도움이 필요하세요?' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('신청자 화면')).toBeInTheDocument()
    expect(screen.getByText('도움 수락자 화면')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '요청을 안전하게 정리하고 있어요' })
    ).toBeInTheDocument()

    await advanceReplayUntilPause()

    expect(screen.getByRole('heading', { name: '우리 동네에 도움이 필요해요' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '모든 도움이 연결됐어요' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '거절' }))
    expect(screen.getByRole('status')).toHaveTextContent('수락을 눌러')
    expect(screen.queryByRole('heading', { name: '모든 도움이 연결됐어요' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '수락' }))
    await advanceReplayUntilPause()

    expect(screen.getByRole('heading', { name: '모든 도움이 연결됐어요' })).toBeInTheDocument()
    expect(screen.getByText('가상 이웃 하나')).toBeInTheDocument()
    expect(screen.getByText('ordinary_life_support')).toBeInTheDocument()
    expect(screen.getByText('required_information_present')).toBeInTheDocument()
    expect(
      screen.getByText('현재 화면은 replay이며 이웃 연락과 응답은 simulation입니다.')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '미션 완료' }))
    expect(screen.getByRole('heading', { name: '도움을 완료했어요' })).toBeInTheDocument()
  })

  it('requires reject, timeout, and accept interactions before the third candidate succeeds', async () => {
    render(<App replayIntervalMs={1} />)
    fireEvent.click(screen.getByRole('button', { name: /거절과 무응답 뒤 재섭외/ }))
    fireEvent.click(screen.getByRole('button', { name: /이 요청으로 실행하기/ }))

    await advanceReplayUntilPause()
    fireEvent.click(screen.getByRole('button', { name: '거절' }))

    await advanceReplayUntilPause()
    expect(screen.getByRole('button', { name: '응답하지 않고 시간 보내기' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '응답하지 않고 시간 보내기' }))

    await advanceReplayUntilPause()
    fireEvent.click(screen.getByRole('button', { name: '수락' }))
    await advanceReplayUntilPause()

    expect(screen.getAllByText('계획 갱신')).toHaveLength(2)
    expect(screen.getByText('candidate_rejected')).toBeInTheDocument()
    expect(screen.getByText('outreach_timeout')).toBeInTheDocument()
    expect(screen.getAllByText('현재 후보에게 도움을 요청했습니다.')).toHaveLength(2)
    expect(screen.getByText('3번째 섭외 · 수락')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '모든 도움이 연결됐어요' })).toBeInTheDocument()
  })

  it('renders a partial match without discarding the safe task', async () => {
    render(<App replayIntervalMs={1} />)
    fireEvent.click(screen.getByRole('button', { name: /위험한 일만 안전하게 제외/ }))
    fireEvent.click(screen.getByRole('button', { name: /이 요청으로 실행하기/ }))

    await advanceReplayUntilPause()
    fireEvent.click(screen.getByRole('button', { name: '수락' }))
    await advanceReplayUntilPause()

    expect(screen.getByRole('heading', { name: '안전한 도움만 연결됐어요' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '문서봉투 전달' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '처방약 복용 보조' })).toBeInTheDocument()
    expect(screen.getAllByText('medication_assistance').length).toBeGreaterThanOrEqual(1)
  })

  it('keeps replay raw console visibly separate and does not fabricate payloads', () => {
    window.history.replaceState({}, '', '/raw?mode=replay&runId=run_demo')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Raw tool events' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Replay에는 raw 로그를 만들지 않습니다.' })
    ).toBeInTheDocument()
    expect(screen.getByText('run_demo')).toBeInTheDocument()
  })

  it('shows the live raw waiting state without changing provider data', () => {
    window.history.replaceState({}, '', '/raw?mode=live&runId=run_live')
    render(<App />)

    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '실제 SDK 이벤트 연결을 기다립니다.' })
    ).toBeInTheDocument()
  })

  it('opens the raw console and can reset only after a final result', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<App replayIntervalMs={1} />)

    fireEvent.click(screen.getByRole('button', { name: 'Raw 이벤트 화면' }))
    expect(open).toHaveBeenLastCalledWith(
      '/raw?mode=replay',
      'sociai-raw-console',
      'noopener,noreferrer'
    )

    fireEvent.change(screen.getByPlaceholderText(/접근성/), { target: { value: '실내 출입 없음' } })
    fireEvent.click(screen.getByRole('button', { name: /이 요청으로 실행하기/ }))
    await advanceReplayUntilPause()
    fireEvent.click(screen.getByRole('button', { name: '수락' }))
    await advanceReplayUntilPause()

    fireEvent.click(screen.getByRole('button', { name: 'Raw 이벤트 화면' }))
    expect(open.mock.calls.at(-1)?.[0]).toContain('runId=run_happy_001')
    fireEvent.click(screen.getByRole('button', { name: '새 도움 요청하기' }))
    expect(
      screen.getByRole('heading', { name: '오늘 어떤 도움이 필요하세요?' })
    ).toBeInTheDocument()
  })

  it('shows a boundary error before the one-shot submission', () => {
    render(<App />)
    const startAt = screen.getByLabelText('시작 시간') as HTMLInputElement
    fireEvent.change(screen.getByLabelText('종료 시간'), { target: { value: startAt.value } })
    fireEvent.click(screen.getByRole('button', { name: /이 요청으로 실행하기/ }))

    expect(screen.getByRole('alert')).toHaveTextContent('시작보다 종료가 늦어야')
    expect(
      screen.getByRole('heading', { name: '오늘 어떤 도움이 필요하세요?' })
    ).toBeInTheDocument()
  })

  it('renders unknown event content as text rather than executable HTML', () => {
    const state = appendNormalizedEvent(createNormalizedEventBuffer({ runId: 'run_demo' }), {
      schemaVersion: 2,
      eventId: 'unknown_1',
      runId: 'run_demo',
      requestId: 'request_demo',
      sequence: 1,
      occurredAt: '2026-08-01T08:00:00.000Z',
      type: 'future.event',
      message: '<script>window.compromised = true</script>',
      isSimulation: false,
      data: { html: '<img src=x onerror=alert(1)>' }
    })

    render(<EventTimeline items={state.items} />)

    expect(screen.getByText('<script>window.compromised = true</script>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByText(/지원하지 않는 이벤트지만 실행은 계속됩니다/)).toBeInTheDocument()
  })

  it('consumes contract-valid live events through the injected two-stream transport', async () => {
    const fixture = getDemoScenario('first_candidate_accepts').fixture
    let agentSink: LiveStreamSink | null = null
    let rawSink: LiveStreamSink | null = null
    const agentClose = vi.fn()
    const rawClose = vi.fn()
    const transport: LiveRunTransport = {
      start: vi.fn(async () =>
        liveIdentity(fixture.expectedFinalResult.runId, fixture.initialRequest.requestId)
      ),
      openAgentStream(_identity, _afterSequence, sink) {
        agentSink = sink
        return { url: '/agent', close: agentClose }
      },
      openRawStream(_identity, _afterSequence, sink) {
        rawSink = sink
        return { url: '/raw', close: rawClose }
      }
    }
    const view = render(<App liveTransport={transport} />)
    fireEvent.click(screen.getByRole('button', { name: 'Live 연결' }))
    fireEvent.click(screen.getByRole('button', { name: /이 요청으로 실행하기/ }))

    await act(async () => Promise.resolve())
    expect(agentSink).not.toBeNull()
    act(() => {
      agentSink?.onMessage({ invalid: true, providerSecret: 'must not render' })
      for (const event of buildFixtureEvents(fixture)) agentSink?.onMessage(event)
      rawSink?.onStatus('open')
    })

    expect(screen.getByRole('heading', { name: '모든 도움이 연결됐어요' })).toBeInTheDocument()
    expect(screen.getByText(/AUTONOMOUS RUN · LIVE/)).toBeInTheDocument()
    expect(screen.getByLabelText('실행 진행률')).toHaveValue(100)
    expect(screen.getByText('격리된 이벤트 진단 1건')).toBeInTheDocument()
    expect(screen.getByText(/invalid_event: Event contract validation failed/)).toBeInTheDocument()
    expect(screen.queryByText(/providerSecret/)).toBeNull()
    expect(
      screen.getByText('현재 화면은 live이며 이웃 연락과 응답은 simulation입니다.')
    ).toBeInTheDocument()
    expect(agentClose).not.toHaveBeenCalled()
    expect(rawClose).not.toHaveBeenCalled()

    act(() =>
      rawSink?.onMessage(
        rawEvent(fixture.expectedFinalResult.runId, fixture.initialRequest.requestId)
      )
    )

    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    fireEvent.click(screen.getByRole('button', { name: 'Raw 이벤트 화면' }))
    expect(open.mock.calls.at(-1)?.[0]).toContain('runId=run_happy_001')
    view.unmount()
    expect(agentClose).toHaveBeenCalledOnce()
    expect(rawClose).toHaveBeenCalledOnce()
  })

  it('ends a rejected live start in a recoverable error state', async () => {
    const fixture = getDemoScenario('first_candidate_accepts').fixture
    const transport: LiveRunTransport = {
      start: vi.fn(async () => Promise.reject(new Error('server unavailable'))),
      openAgentStream: vi.fn(() => {
        throw new Error('must not open')
      }),
      openRawStream: vi.fn(() => {
        throw new Error('must not open')
      })
    }
    render(<App liveTransport={transport} />)
    fireEvent.click(screen.getByRole('button', { name: 'Live 연결' }))
    fireEvent.click(screen.getByRole('button', { name: /이 요청으로 실행하기/ }))

    await act(async () => Promise.resolve())

    expect(screen.getByRole('alert')).toHaveTextContent('라이브 실행을 시작하지 못했습니다.')
    expect(screen.getByRole('button', { name: '새 요청 시작' })).toBeInTheDocument()
    expect(transport.start).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: fixture.initialRequest.requestId })
    )
  })

  it('distinguishes a server boundary rejection from client form validation', async () => {
    const transport: LiveRunTransport = {
      start: vi.fn(async () =>
        Promise.reject(new LiveRunStartError('validation', 'server details must stay hidden'))
      ),
      openAgentStream: vi.fn(() => {
        throw new Error('must not open')
      }),
      openRawStream: vi.fn(() => {
        throw new Error('must not open')
      })
    }
    render(<App liveTransport={transport} />)
    fireEvent.click(screen.getByRole('button', { name: 'Live 연결' }))
    fireEvent.click(screen.getByRole('button', { name: /이 요청으로 실행하기/ }))

    await act(async () => Promise.resolve())

    expect(screen.getByRole('alert')).toHaveTextContent('서버가 요청 형식을 거절했습니다.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('server details')
  })

  it('keeps native connections during a transient break and restores both checkpoints on refresh', async () => {
    const fixture = getDemoScenario('first_candidate_accepts').fixture
    const agentSinks: LiveStreamSink[] = []
    const rawSinks: LiveStreamSink[] = []
    const agentAfterSequences: number[] = []
    const rawAfterSequences: number[] = []
    const transport: LiveRunTransport = {
      start: vi.fn(async () =>
        liveIdentity(fixture.expectedFinalResult.runId, fixture.initialRequest.requestId)
      ),
      openAgentStream(_identity, afterSequence, sink) {
        agentAfterSequences.push(afterSequence)
        agentSinks.push(sink)
        return { url: '/agent', close: vi.fn() }
      },
      openRawStream(_identity, afterSequence, sink) {
        rawAfterSequences.push(afterSequence)
        rawSinks.push(sink)
        return { url: '/raw', close: vi.fn() }
      }
    }
    const view = render(<App liveTransport={transport} />)
    fireEvent.click(screen.getByRole('button', { name: 'Live 연결' }))
    fireEvent.click(screen.getByRole('button', { name: /이 요청으로 실행하기/ }))
    await act(async () => Promise.resolve())

    act(() => {
      for (const event of buildFixtureEvents(fixture).slice(0, 3)) {
        agentSinks[0]?.onMessage(event)
      }
      rawSinks[0]?.onMessage(
        rawEvent(fixture.expectedFinalResult.runId, fixture.initialRequest.requestId)
      )
    })
    act(() => agentSinks[0]?.onStatus('reconnecting'))
    act(() => vi.advanceTimersByTime(750))

    expect(agentAfterSequences).toEqual([0])
    expect(rawAfterSequences).toEqual([0])
    expect(screen.getAllByText(/sequence 3/).length).toBeGreaterThanOrEqual(1)

    view.unmount()
    render(<App liveTransport={transport} />)

    expect(agentAfterSequences).toEqual([0, 3])
    expect(rawAfterSequences).toEqual([0, 1])
    expect(transport.start).toHaveBeenCalledOnce()
    expect(screen.queryByRole('heading', { name: '오늘 어떤 도움이 필요하세요?' })).toBeNull()
    expect(screen.getByRole('heading', { name: '생필품 상자 수령' })).toBeInTheDocument()
  })
})

async function advanceReplayUntilPause() {
  for (let step = 0; step < 100; step += 1) {
    await act(async () => Promise.resolve())
    if (vi.getTimerCount() === 0) return
    await act(async () => vi.runOnlyPendingTimers())
  }
  throw new Error('Fixture replay did not reach an interaction pause')
}

function rawEvent(runId: string, requestId: string): RawToolEvent {
  return {
    schemaVersion: 2,
    eventId: 'raw_app_1',
    runId,
    requestId,
    toolCallId: 'call_app_1',
    sequence: 1,
    occurredAt: '2026-08-01T08:00:00.000Z',
    direction: 'tool_call',
    provider: 'openai',
    raw: { exact: true }
  }
}

function liveIdentity(runId: string, requestId: string) {
  return {
    runId,
    requestId,
    agentEventsUrl: `/api/runs/${runId}/events`,
    rawToolEventsUrl: `/api/runs/${runId}/raw-events`
  }
}
