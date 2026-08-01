import { describe, expect, it } from 'vitest'

import {
  SCHEMA_VERSION,
  SendBundleOutreachResultSchema,
  type SendBundleOutreachCall
} from '@30-minute-exchange/contracts'

import { sendBundleOutreach } from '../src/index.js'

const context = {
  schemaVersion: SCHEMA_VERSION,
  runId: 'run_bundle_outreach_001',
  requestId: 'request_bundle_outreach_001'
} as const

const bundle: SendBundleOutreachCall['bundle'] = {
  ...context,
  bundleId: 'bundle_outreach_001',
  taskIds: ['task_bundle_outreach_001'],
  scheduledWindow: {
    startAt: '2026-08-01T10:00:00.000Z',
    endAt: '2026-08-01T10:20:00.000Z'
  },
  totalActivityDurationMinutes: 20,
  waitingMinutes: 0,
  requiredExperience: [],
  reasonCodes: ['single_task_bundle']
}

function outreachCall(attempt: 1 | 2 | 3, seed = 'retry-path-v1'): SendBundleOutreachCall {
  return {
    ...context,
    toolCallId: `call_bundle_outreach_${attempt}`,
    assignment: {
      ...context,
      assignmentId: `assignment_bundle_outreach_${attempt}`,
      bundleId: bundle.bundleId,
      candidateId: `candidate_bundle_outreach_${attempt}`,
      taskIds: bundle.taskIds,
      scheduledWindow: bundle.scheduledWindow,
      attempt,
      status: 'planned',
      isSimulation: true
    },
    bundle,
    timeoutSeconds: 10,
    seed
  }
}

describe('deterministic bundle outreach simulator', () => {
  it('uses fixture outcomes for the first candidate and its one retry', () => {
    const results = [1, 2, 3].map((attempt) =>
      sendBundleOutreach(outreachCall(attempt as 1 | 2 | 3))
    )

    expect(results.map((result) => result.ok && result.data.outcome)).toEqual([
      'rejected',
      'accepted',
      'accepted'
    ])
  })

  it('returns a contract-valid response within the ten-second demo budget', () => {
    const result = sendBundleOutreach(outreachCall(1))

    expect(SendBundleOutreachResultSchema.parse(result)).toEqual(result)
    expect(result.ok && result.data.virtualElapsedSeconds).toBeLessThanOrEqual(10)
  })

  it('retries once after a ten-second timeout and then accepts', () => {
    const timeout = sendBundleOutreach(outreachCall(1, 'timeout-retry-path-v1'))
    const accepted = sendBundleOutreach(outreachCall(2, 'timeout-retry-path-v1'))

    expect(timeout).toMatchObject({
      ok: true,
      data: { outcome: 'timed_out', virtualElapsedSeconds: 10 }
    })
    expect(accepted).toMatchObject({ ok: true, data: { outcome: 'accepted' } })
  })
})
