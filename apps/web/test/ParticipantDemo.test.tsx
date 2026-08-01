import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ParticipantDemo } from '../src/demo/ParticipantDemo.js'

describe('requester clarification result', () => {
  it.each([
    ['conversation_agreed', '가상 이웃 하나: 정보 확인 대화에 동의했습니다.'],
    ['rejected', '가상 이웃 하나: 정보 확인 대화를 거절했습니다.']
  ] as const)('shows only the requester message for %s', (outcome, requesterMessage) => {
    render(
      <ParticipantDemo
        view={{
          requesterStage: 'clarification',
          request: null,
          result: null,
          helpers: [],
          clarificationResults: [
            {
              taskId: 'task_held_001',
              candidateId: 'candidate_001',
              outcome,
              requesterMessage
            }
          ]
        }}
        mode="live"
        pendingDecisions={new Map()}
        replayFeedback={null}
        onFixtureDecision={vi.fn()}
        completedTaskIds={[]}
        onMissionComplete={vi.fn()}
        thanksMessages={{}}
        onSendThanks={vi.fn()}
        onReset={vi.fn()}
      />
    )

    expect(
      screen.getByRole('heading', { name: '정보 확인 대화 의향을 확인했어요' })
    ).toBeInTheDocument()
    expect(screen.getByText(requesterMessage)).toBeInTheDocument()
    expect(screen.getByText('정보 확인 대화 의향 · 실제 매칭 아님')).toBeInTheDocument()
    expect(screen.queryByText('도움 수락자 화면')).toBeNull()
    expect(screen.queryByRole('button', { name: '수락' })).toBeNull()
    expect(screen.queryByRole('button', { name: '거절' })).toBeNull()
  })
})
