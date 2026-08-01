import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  appendNormalizedEvent,
  createNormalizedEventBuffer
} from '@30-minute-exchange/event-stream'

import { EventTimeline } from '../src/timeline/EventTimeline.js'

describe('clarification event timeline', () => {
  it('shows the requester-facing response as held and not matched', () => {
    let events = createNormalizedEventBuffer({ runId: 'run_clarification_001' })
    events = appendNormalizedEvent(events, {
      schemaVersion: 2,
      eventId: 'event_clarification_invited_001',
      runId: 'run_clarification_001',
      requestId: 'request_clarification_001',
      taskId: 'task_clarification_001',
      sequence: 1,
      occurredAt: '2026-08-01T09:00:00.000Z',
      type: 'clarification.invited',
      message: '정보 확인 대화 의향을 물었습니다.',
      isSimulation: true,
      data: {
        toolCallId: 'tool_call_clarification_001',
        candidateId: 'candidate_001'
      }
    })
    events = appendNormalizedEvent(events, {
      schemaVersion: 2,
      eventId: 'event_clarification_responded_001',
      runId: 'run_clarification_001',
      requestId: 'request_clarification_001',
      taskId: 'task_clarification_001',
      sequence: 2,
      occurredAt: '2026-08-01T09:00:01.000Z',
      type: 'clarification.responded',
      message: '가상 이웃 하나의 대화 의향을 확인했습니다.',
      isSimulation: true,
      data: {
        candidateId: 'candidate_001',
        outcome: 'conversation_agreed',
        taskStatus: 'held',
        requesterMessage: '가상 이웃 하나: 정보 확인 대화에 동의했습니다.',
        isSimulation: true
      }
    })

    render(<EventTimeline items={events.items} />)

    expect(screen.getByText('정보 확인 대화 요청')).toBeInTheDocument()
    expect(screen.getByText('정보 확인 대화 응답')).toBeInTheDocument()
    expect(screen.getByText('대화 동의')).toBeInTheDocument()
    expect(screen.getByText('가상 이웃 하나: 정보 확인 대화에 동의했습니다.')).toBeInTheDocument()
    expect(screen.getByText('작업 상태: 정보 보류 · 실제 매칭 아님')).toBeInTheDocument()
  })
})
