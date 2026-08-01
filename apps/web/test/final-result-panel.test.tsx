import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FinalResult } from '@30-minute-exchange/contracts'

import { getDemoScenario } from '../src/demo/scenarios.js'
import { FinalResultPanel } from '../src/results/FinalResultPanel.js'

describe('final result variants', () => {
  it.each([
    ['unmatched', '이번에는 이웃을 찾지 못했어요', '후보가 모두 거절했습니다.'],
    ['safety_excluded', '안전을 위해 매칭하지 않았어요', '일반 이웃 매칭에서 제외했습니다.']
  ] as const)('renders the server-provided %s result', (status, heading, userMessage) => {
    const base = getDemoScenario('first_candidate_accepts').fixture.expectedFinalResult
    const taskId = base.taskResults[0]?.taskId
    if (taskId === undefined) throw new Error('Fixture requires one task')
    const result: FinalResult = {
      ...base,
      status,
      taskResults: [
        {
          taskId,
          status,
          reasonCodes: [status === 'unmatched' ? 'candidates_exhausted' : 'safety_policy'],
          userMessage
        }
      ],
      userMessage
    }
    const onReset = vi.fn()

    render(<FinalResultPanel result={result} mode="replay" onReset={onReset} />)

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getAllByText(userMessage)).toHaveLength(2)
    expect(
      screen.getByText(status === 'unmatched' ? 'candidates_exhausted' : 'safety_policy')
    ).toBeInTheDocument()
    expect(
      screen.getByText('현재 화면은 replay이며 이웃 연락과 응답은 simulation입니다.')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '새 요청 시작' }))
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('keeps held and failed task outcomes distinct in an unmatched result', () => {
    const base = getDemoScenario('first_candidate_accepts').fixture.expectedFinalResult
    const result: FinalResult = {
      ...base,
      status: 'unmatched',
      taskResults: [
        {
          taskId: 'task_held',
          status: 'held',
          reasonCodes: ['missing_information'],
          userMessage: '정보가 부족해 보류했습니다.'
        },
        {
          taskId: 'task_failed',
          status: 'failed',
          reasonCodes: ['tool_failure'],
          userMessage: '도구 오류로 종료했습니다.'
        }
      ],
      userMessage: '두 작업을 안전하게 종료했습니다.'
    }

    render(<FinalResultPanel result={result} mode="live" onReset={vi.fn()} />)

    expect(screen.getByText('정보 보류')).toBeInTheDocument()
    expect(screen.getByText('실행 실패')).toBeInTheDocument()
    expect(screen.getByText('missing_information')).toBeInTheDocument()
    expect(screen.getByText('tool_failure')).toBeInTheDocument()
  })
})
