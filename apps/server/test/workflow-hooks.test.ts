import { describe, expect, it } from 'vitest'

import { createWorkflowHookEmitter } from '../src/orchestration/workflow-hooks.js'

describe('workflow hooks', () => {
  it('emits ordered before and after records without exposing a raw payload field', () => {
    const observed: unknown[] = []
    const hooks = createWorkflowHookEmitter({
      occurredAt: '2026-08-01T09:00:00.000Z',
      onHook: (event) => observed.push(event)
    })

    hooks.emit('task.decomposition', 'before', { requestId: 'request_demo_001' })
    hooks.emit('task.decomposition', 'after', { taskCount: 2 })

    expect(observed).toEqual([
      {
        sequence: 1,
        occurredAt: '2026-08-01T09:00:00.000Z',
        stage: 'task.decomposition',
        phase: 'before',
        data: { requestId: 'request_demo_001' }
      },
      {
        sequence: 2,
        occurredAt: '2026-08-01T09:00:00.000Z',
        stage: 'task.decomposition',
        phase: 'after',
        data: { taskCount: 2 }
      }
    ])
    expect(JSON.stringify(observed)).not.toContain('raw')
  })
})
