import type { FinalResult } from '@30-minute-exchange/contracts'

interface FinalResultPanelProps {
  readonly result: FinalResult
  readonly mode: 'live' | 'replay'
  readonly onReset: () => void
  readonly technicalView?: boolean
}

const resultLabels: Record<FinalResult['status'], string> = {
  fully_matched: '모든 도움이 연결됐어요',
  partially_matched: '안전한 도움만 연결됐어요',
  safety_excluded: '안전을 위해 매칭하지 않았어요',
  unmatched: '이번에는 이웃을 찾지 못했어요'
}

const taskResultLabels: Record<FinalResult['taskResults'][number]['status'], string> = {
  matched: '성사',
  safety_excluded: '안전 제외',
  unmatched: '미성사',
  held: '정보 보류',
  failed: '실행 실패'
}

export function FinalResultPanel({
  result,
  mode,
  onReset,
  technicalView = false
}: FinalResultPanelProps) {
  return (
    <section
      className={`result-panel result-panel--${result.status}`}
      aria-labelledby="result-heading"
    >
      <div className="result-icon" aria-hidden="true">
        {result.status === 'fully_matched'
          ? '✓'
          : result.status === 'partially_matched'
            ? '◐'
            : '!'}
      </div>
      <div className="result-copy">
        <p className="step-label">FINAL OUTCOME · {result.status}</p>
        <h2 id="result-heading">
          {technicalView ? '최종 처리 결과' : resultLabels[result.status]}
        </h2>
        <p>{result.userMessage}</p>
        <ul className="task-result-list">
          {result.taskResults.map((task) => (
            <li key={task.taskId}>
              <span>{taskResultLabels[task.status]}</span>
              <p>{task.userMessage}</p>
              {task.reasonCodes.length > 0 && (
                <ul className="task-result-reasons" aria-label="결과 근거 코드">
                  {task.reasonCodes.map((code) => (
                    <li key={code}>
                      <code>{code}</code>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
      <aside className="execution-boundary">
        <h3>실행 경계</h3>
        <Boundary label="OpenAI 해석" value={result.executionBoundary.openaiInterpretation} />
        <Boundary label="안전 정책" value={result.executionBoundary.safetyPolicy} />
        <Boundary label="후보 랭킹" value={result.executionBoundary.candidateRanking} />
        <Boundary label="이웃 섭외" value={result.executionBoundary.outreach} />
        <Boundary label="이웃 응답" value={result.executionBoundary.neighborResponse} />
        <Boundary label="매칭 확정" value={result.executionBoundary.matchConfirmation} />
        <p>
          현재 화면은 {mode}이며 이웃 연락과 응답은 {result.executionBoundary.neighborResponse}
          입니다.
        </p>
        <button type="button" className="secondary-action" onClick={onReset}>
          새 요청 시작
        </button>
      </aside>
    </section>
  )
}

function Boundary({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

