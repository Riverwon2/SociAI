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

function outreachCall(
  attempt: 1 | 2,
  seed = 'retry-path-v1',
  candidateId = `candidate_bundle_outreach_${attempt}`
): SendBundleOutreachCall {
  return {
    ...context,
    toolCallId: `call_bundle_outreach_${attempt}`,
    assignment: {
      ...context,
      assignmentId: `assignment_bundle_outreach_${attempt}`,
      bundleId: bundle.bundleId,
      candidateId,
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
  it('uses candidate-ID fixtures instead of the outreach attempt order', () => {
    const results = [
      sendBundleOutreach(outreachCall(2, 'retry-path-v1', 'candidate-alpha')),
      sendBundleOutreach(outreachCall(1, 'retry-path-v1', 'candidate-beta'))
    ]

    expect(results.map((result) => result.ok && result.data.outcome)).toEqual([
      'rejected',
      'accepted'
    ])
  })

  it('uses a deterministic fallback for a candidate absent from a known fixture', () => {
    const first = sendBundleOutreach(
      outreachCall(1, 'retry-path-v1', 'candidate-not-in-fixture')
    )
    const second = sendBundleOutreach(
      outreachCall(1, 'retry-path-v1', 'candidate-not-in-fixture')
    )

    expect(second).toEqual(first)
  })

  it('rejects an outreach attempt beyond the two-candidate bundle limit', () => {
    const secondAttempt = outreachCall(2)
    const thirdAttempt: SendBundleOutreachCall = {
      ...secondAttempt,
      assignment: { ...secondAttempt.assignment, attempt: 3 }
    }

    expect(() => sendBundleOutreach(thirdAttempt)).toThrow(RangeError)
  })

  it('returns a contract-valid response within the ten-second demo budget', () => {
    const result = sendBundleOutreach(outreachCall(1))

    expect(SendBundleOutreachResultSchema.parse(result)).toEqual(result)
    expect(result.ok && result.data.virtualElapsedSeconds).toBeLessThanOrEqual(10)
  })

  it('retries once after a ten-second timeout and then accepts', () => {
    const timeout = sendBundleOutreach(
      outreachCall(2, 'timeout-retry-path-v1', 'candidate-alpha')
    )
    const accepted = sendBundleOutreach(
      outreachCall(1, 'timeout-retry-path-v1', 'candidate-beta')
    )

    expect(timeout).toMatchObject({
      ok: true,
      data: { outcome: 'timed_out', virtualElapsedSeconds: 10 }
    })
    expect(accepted).toMatchObject({ ok: true, data: { outcome: 'accepted' } })
  })
})
