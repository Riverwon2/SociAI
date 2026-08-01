import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject
} from 'react'
import type { DemoScenarioFixture, InitialRequest } from '@30-minute-exchange/contracts'

import { buildFixtureEvents } from './demo/fixture-events.js'
import {
  createReplayProgress,
  pendingDecisions,
  planFixtureReplay,
  takeAutoStep,
  takeDecisionStep,
  type FixtureReplayDecision,
  type FixtureReplayPlan,
  type FixtureReplayProgress
} from './demo/fixture-replay-plan.js'
import { ParticipantDemo } from './demo/ParticipantDemo.js'
import { deriveParticipantDemoView } from './demo/participant-demo-model.js'
import { demoScenarios, getDemoScenario } from './demo/scenarios.js'
import {
  checkpointFromRunState,
  createLiveRunCheckpointStore,
  restoreLiveRunState,
  type LiveRunCheckpointStore
} from './live/live-run-checkpoint.js'
import {
  connectLiveRunStreams,
  LiveRunStartError,
  startLiveRun,
  type LiveRunIdentity,
  type LiveRunConnections,
  type LiveRunTransport
} from './live/live-run-session.js'
import { RawConsolePage } from './raw-console/RawConsolePage.js'
import { createRawEventPublisher, type RawEventPublisher } from './raw-console/raw-event-channel.js'
import { RequestPanel } from './request/RequestPanel.js'
import { FinalResultPanel } from './results/FinalResultPanel.js'
import { TaskBoard } from './results/TaskBoard.js'
import {
  createInitialRunState,
  deriveTaskViews,
  runReducer,
  type RunAction,
  type RunState
} from './state/run-state.js'
import { EventTimeline } from './timeline/EventTimeline.js'

export interface AppProps {
  readonly replayIntervalMs?: number
  readonly liveTransport?: LiveRunTransport
}

export function App({ replayIntervalMs = 300, liveTransport }: AppProps) {
  if (window.location.pathname === '/raw') return <RawConsolePage />
  return <MainApp replayIntervalMs={replayIntervalMs} liveTransport={liveTransport} />
}

function MainApp({
  replayIntervalMs,
  liveTransport
}: {
  readonly replayIntervalMs: number
  readonly liveTransport: LiveRunTransport | undefined
}) {
  const [scenarioId, setScenarioId] = useState<DemoScenarioFixture['scenarioId']>(
    demoScenarios[0]?.fixture.scenarioId ?? 'first_candidate_accepts'
  )
  const checkpointStore = useMemo(createBrowserCheckpointStore, [])
  const restoredCheckpoint = useMemo(
    () => (liveTransport === undefined ? null : (checkpointStore?.read() ?? null)),
    [checkpointStore, liveTransport]
  )
  const [run, dispatch] = useReducer(runReducer, restoredCheckpoint, (checkpoint) =>
    checkpoint === null ? createInitialRunState() : restoreLiveRunState(checkpoint)
  )
  const [replayPlan, setReplayPlan] = useState<FixtureReplayPlan | null>(null)
  const [replayProgress, setReplayProgress] = useState<FixtureReplayProgress | null>(null)
  const [replayFeedback, setReplayFeedback] = useState<string | null>(null)
  const [executionMode, setExecutionMode] = useState<'live' | 'replay'>(
    restoredCheckpoint === null ? 'replay' : 'live'
  )
  const liveConnections = useRef<LiveRunConnections | null>(null)

  const replayDecisions = useMemo(
    () =>
      replayPlan === null || replayProgress === null
        ? new Map<string, FixtureReplayDecision>()
        : pendingDecisions(replayPlan, replayProgress),
    [replayPlan, replayProgress]
  )

  useEffect(() => {
    if (replayPlan === null || replayProgress === null) return
    const step = takeAutoStep(replayPlan, replayProgress)
    if (step === null) return
    const timer = window.setTimeout(
      () => {
        if (step.event.type === 'outreach.sent') setReplayFeedback(null)
        dispatch({ type: 'agent.received', value: step.event })
        setReplayProgress((current) => (current === replayProgress ? step.progress : current))
      },
      Math.max(0, replayIntervalMs)
    )
    return () => window.clearTimeout(timer)
  }, [replayIntervalMs, replayPlan, replayProgress])

  useRawEventPublisher(run)

  useEffect(() => {
    if (liveTransport === undefined || restoredCheckpoint === null || run.phase !== 'running') {
      return
    }
    liveConnections.current = openLiveConnections(
      restoredCheckpoint.identity,
      liveTransport,
      dispatch,
      restoredCheckpoint
    )
  }, [liveTransport, restoredCheckpoint])

  useEffect(() => {
    if (run.phase === 'failed') {
      liveConnections.current?.close()
      liveConnections.current = null
    }
    if (checkpointStore === null) return
    if (run.phase === 'complete' || run.phase === 'draft') {
      checkpointStore.clear()
      return
    }
    const checkpoint = checkpointFromRunState(run)
    if (checkpoint !== null) checkpointStore.write(checkpoint)
  }, [checkpointStore, run])

  useEffect(
    () => () => {
      liveConnections.current?.close()
    },
    []
  )

  const startFixture = (request: InitialRequest) => {
    const scenario = getDemoScenario(scenarioId)
    try {
      checkpointStore?.clear()
      const plan = planFixtureReplay(buildFixtureEvents(scenario.fixture, request))
      dispatch({
        type: 'run.started',
        mode: 'replay',
        runId: scenario.fixture.expectedFinalResult.runId,
        requestId: request.requestId,
        scenario: scenario.fixture
      })
      setReplayPlan(plan)
      setReplayProgress(createReplayProgress(plan))
      setReplayFeedback(null)
    } catch {
      dispatch({ type: 'run.failed', message: '데모 실행을 준비하지 못했습니다.' })
    }
  }

  const reset = () => {
    liveConnections.current?.close()
    liveConnections.current = null
    checkpointStore?.clear()
    setReplayPlan(null)
    setReplayProgress(null)
    setReplayFeedback(null)
    dispatch({ type: 'run.reset' })
  }

  const respondToFixture = (taskId: string, decision: FixtureReplayDecision) => {
    if (replayPlan === null || replayProgress === null) return
    const expected = replayDecisions.get(taskId)
    if (expected === undefined) return
    if (decision !== expected) {
      setReplayFeedback(fixtureMismatchMessage(expected))
      return
    }
    const step = takeDecisionStep(replayPlan, replayProgress, taskId, decision)
    if (step === null) return
    dispatch({ type: 'agent.received', value: step.event })
    setReplayProgress(step.progress)
    setReplayFeedback(null)
  }

  const submit = (request: InitialRequest) => {
    if (executionMode === 'live' && liveTransport !== undefined) {
      checkpointStore?.clear()
      void startLiveExecution(request, liveTransport, dispatch, liveConnections)
      return
    }
    startFixture(request)
  }

  return (
    <div className="site-shell">
      <SiteHeader onOpenRaw={() => openRawConsole(run)} />
      <main>
        {run.phase === 'draft' ? (
          <RequestPanel
            selectedScenarioId={scenarioId}
            executionMode={executionMode}
            liveAvailable={liveTransport !== undefined}
            onScenarioChange={setScenarioId}
            onExecutionModeChange={setExecutionMode}
            onSubmitRequest={submit}
          />
        ) : (
          <RunWorkspace
            run={run}
            pendingDecisions={replayDecisions}
            replayFeedback={replayFeedback}
            onFixtureDecision={respondToFixture}
            onReset={reset}
          />
        )}
      </main>
      <SiteFooter />
    </div>
  )
}

async function startLiveExecution(
  request: InitialRequest,
  transport: LiveRunTransport,
  dispatch: Dispatch<RunAction>,
  connections: MutableRefObject<LiveRunConnections | null>
) {
  try {
    const identity = await startLiveRun(request, transport)
    dispatch({
      type: 'run.started',
      mode: 'live',
      runId: identity.runId,
      requestId: identity.requestId,
      liveStreamUrls: {
        agentEventsUrl: identity.agentEventsUrl,
        rawToolEventsUrl: identity.rawToolEventsUrl
      },
      scenario: null
    })
    connections.current = openLiveConnections(identity, transport, dispatch, {
      agentAfterSequence: 0,
      rawAfterSequence: 0
    })
  } catch (error) {
    dispatch({
      type: 'run.failed',
      message:
        error instanceof LiveRunStartError && error.category === 'validation'
          ? '서버가 요청 형식을 거절했습니다. 입력 경계를 확인한 뒤 새 요청으로 시작해 주세요.'
          : '라이브 실행을 시작하지 못했습니다.'
    })
  }
}

function openLiveConnections(
  identity: LiveRunIdentity,
  transport: LiveRunTransport,
  dispatch: Dispatch<RunAction>,
  afterSequence: { readonly agentAfterSequence: number; readonly rawAfterSequence: number }
) {
  return connectLiveRunStreams(
    identity,
    transport,
    {
      onAgentEvent: (event) => dispatch({ type: 'agent.received', value: event }),
      onRawEvent: (event) => dispatch({ type: 'raw.received', value: event }),
      onStatus: (stream, status) => {
        if (stream === 'agent') {
          dispatch(
            status === 'failed'
              ? { type: 'run.failed', message: '연결을 복구하지 못해 안전하게 종료했습니다.' }
              : { type: 'connection.changed', status }
          )
        }
      },
      onIssue: (stream, message) =>
        dispatch({ type: 'stream.issue', message: `${stream}: ${message}` })
    },
    { agent: afterSequence.agentAfterSequence, raw: afterSequence.rawAfterSequence }
  )
}

function createBrowserCheckpointStore(): LiveRunCheckpointStore | null {
  try {
    return createLiveRunCheckpointStore(window.sessionStorage)
  } catch {
    return null
  }
}

function useRawEventPublisher(run: RunState) {
  const publisher = useRef<RawEventPublisher | null>(null)
  const publishedCount = useRef(0)
  const publishedRunId = useRef<string | null>(null)

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    publisher.current = createRawEventPublisher()
    return () => publisher.current?.close()
  }, [])

  useEffect(() => {
    if (run.mode !== 'live' || publisher.current === null) return
    if (publishedRunId.current !== run.raw.runId) {
      publishedRunId.current = run.raw.runId
      publishedCount.current = 0
    }
    for (const event of run.raw.items.slice(publishedCount.current))
      publisher.current.publish(event)
    publishedCount.current = run.raw.items.length
  }, [run.mode, run.raw.items])
}

function SiteHeader({ onOpenRaw }: { readonly onOpenRaw: () => void }) {
  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="30분 교환소 홈">
        <span className="brand-mark">30</span>
        <span>
          <strong>30분 교환소</strong>
          <small>SociAI local care agent</small>
        </span>
      </a>
      <div className="header-actions">
        <span className="simulation-notice">DEMO · SYNTHETIC DATA</span>
        <button className="raw-console-button" type="button" onClick={onOpenRaw}>
          <span className="pulse-dot" aria-hidden="true" />
          Raw 이벤트 화면
        </button>
      </div>
    </header>
  )
}

function RunWorkspace({
  run,
  pendingDecisions: replayDecisions,
  replayFeedback,
  onFixtureDecision,
  onReset
}: {
  readonly run: RunState
  readonly pendingDecisions: ReadonlyMap<string, FixtureReplayDecision>
  readonly replayFeedback: string | null
  readonly onFixtureDecision: (taskId: string, decision: FixtureReplayDecision) => void
  readonly onReset: () => void
}) {
  const tasks = useMemo(() => deriveTaskViews(run.normalized), [run.normalized])
  const participantView = useMemo(() => deriveParticipantDemoView(run), [run])
  const [completedTaskIds, setCompletedTaskIds] = useState<readonly string[]>([])
  const [thanksMessages, setThanksMessages] = useState<Readonly<Record<string, string>>>({})
  const expectedCount =
    run.scenario?.expectedEventTypes.length ??
    (run.result === null ? run.normalized.items.length + 1 : run.normalized.items.length)
  const planUpdates = run.normalized.items.filter(({ type }) => type === 'plan.updated').length
  const progress = Math.round((run.normalized.items.length / expectedCount) * 100)

  return (
    <div className="workspace-shell">
      <ParticipantDemo
        view={participantView}
        mode={run.mode}
        pendingDecisions={replayDecisions}
        replayFeedback={replayFeedback}
        onFixtureDecision={onFixtureDecision}
        completedTaskIds={completedTaskIds}
        onMissionComplete={(taskId) =>
          setCompletedTaskIds((current) =>
            current.includes(taskId) ? current : [...current, taskId]
          )
        }
        thanksMessages={thanksMessages}
        onSendThanks={(taskId, message) =>
          setThanksMessages((current) => ({ ...current, [taskId]: message }))
        }
        onReset={onReset}
      />

      {run.failureMessage !== null && (
        <div className="run-error" role="alert">
          <strong>실행을 안전하게 종료했습니다.</strong>
          <p>{run.failureMessage}</p>
          <button type="button" onClick={onReset}>
            새 요청 시작
          </button>
        </div>
      )}

      <details className="run-operations">
        <summary>
          <span>
            <strong>진행 과정 자세히 보기</strong>
            <small>안전 판단, 후보 선택과 계획 변경 기록</small>
          </span>
          <b>
            {Math.min(progress, 100)}% · sequence {run.normalized.latestSequence}
          </b>
        </summary>
        <div className="run-operations-content">
          <section className="run-overview" aria-labelledby="run-heading">
            <div>
              <p className="section-kicker">AUTONOMOUS RUN · {run.mode.toUpperCase()}</p>
              <h2 id="run-heading">요청을 끝까지 처리하고 있어요.</h2>
              <p>요청자에게 다시 묻지 않고, 허용된 범위 안에서 다음 행동을 선택합니다.</p>
            </div>
            <div className="run-progress-card">
              <div>
                <span>진행률</span>
                <b>{Math.min(progress, 100)}%</b>
              </div>
              <progress max="100" value={progress} aria-label="실행 진행률" />
              <small>
                sequence {run.normalized.latestSequence} · {run.connectionStatus}
              </small>
            </div>
          </section>

          <section className="metric-row" aria-label="실행 요약">
            <Metric value={tasks.length} label="분해된 작업" />
            <Metric
              value={tasks.reduce((sum, task) => sum + task.candidates.length, 0)}
              label="검토 후보"
            />
            <Metric value={planUpdates} label="계획 변경" highlight />
            <Metric
              value={run.normalized.issues.length + run.streamIssues.length}
              label="격리된 오류"
            />
          </section>

          <RunDiagnostics run={run} />

          <div className="workspace-grid">
            <EventTimeline items={run.normalized.items} />
            <TaskBoard tasks={tasks} />
          </div>

          {run.result !== null && (
            <FinalResultPanel result={run.result} mode={run.mode} onReset={onReset} technicalView />
          )}
        </div>
      </details>
    </div>
  )
}

function fixtureMismatchMessage(expected: FixtureReplayDecision) {
  let label = '응답 시간 넘기기'
  if (expected === 'accepted') label = '수락'
  if (expected === 'rejected') label = '거절'
  return `이 fixture에는 ${label} 응답이 기록되어 있어요. ${label}을 눌러 다음 장면을 확인해 주세요.`
}

function RunDiagnostics({ run }: { readonly run: RunState }) {
  const diagnostics = [
    ...run.normalized.issues.map((issue) => `${issue.code}: ${issue.message}`),
    ...run.raw.issues.map((issue) => `raw.${issue.code}: ${issue.message}`),
    ...run.streamIssues
  ]
  if (diagnostics.length === 0) return null
  return (
    <details className="run-diagnostics">
      <summary>격리된 이벤트 진단 {diagnostics.length}건</summary>
      <ul>
        {diagnostics.map((diagnostic, index) => (
          <li key={`${index}-${diagnostic}`}>
            <code>{diagnostic}</code>
          </li>
        ))}
      </ul>
      <p>원본 payload와 provider 오류 세부 내용은 이 사용자 화면에 표시하지 않습니다.</p>
    </details>
  )
}

function Metric({
  value,
  label,
  highlight = false
}: {
  readonly value: number
  readonly label: string
  readonly highlight?: boolean
}) {
  return (
    <div className={highlight ? 'metric metric--highlight' : 'metric'}>
      <b>{String(value).padStart(2, '0')}</b>
      <span>{label}</span>
    </div>
  )
}

function openRawConsole(run: RunState) {
  const runId = run.normalized.runId ?? run.scenario?.expectedFinalResult.runId ?? ''
  const query = new URLSearchParams({ mode: run.mode, ...(runId === '' ? {} : { runId }) })
  window.open(`/raw?${query.toString()}`, 'sociai-raw-console', 'noopener,noreferrer')
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>30분 교환소 · 무료·비의료 생활지원 운영 에이전트</p>
      <p>현재 이웃 프로필, 섭외, 응답과 매칭 확정은 simulation입니다.</p>
    </footer>
  )
}
