import { describe, expect, it } from 'vitest'

import type { FallbackPolicy } from '@30-minute-exchange/contracts'

import { findCandidates } from '../src/ranking/find-candidates.js'
import { chooseFallbackAction, selectNextCandidate } from '../src/policies/fallback-policy.js'
import { candidatesCall } from './fixtures.js'

const noFallback: FallbackPolicy = {
  allowTimeAdjustment: false,
  allowPartialCompletion: false,
  allowScopeReduction: false
}

describe('fallback policy', () => {
  it('시도하지 않은 최고 순위 후보를 선택한다', () => {
    const result = findCandidates(candidatesCall())
    if (!result.ok) throw new Error('Expected candidates')

    expect(selectNextCandidate(result.data.candidates, new Set())?.rank).toBe(1)
    expect(selectNextCandidate(result.data.candidates, new Set(['candidate_alpha']))?.rank).toBe(2)
  })

  it('후보와 fallback을 우선순위대로 하나만 선택한다', () => {
    expect(chooseFallbackAction(true, noFallback)).toBe('next_candidate')
    expect(chooseFallbackAction(false, { ...noFallback, allowTimeAdjustment: true })).toBe(
      'adjust_time'
    )
    expect(chooseFallbackAction(false, { ...noFallback, allowScopeReduction: true })).toBe(
      'reduce_scope'
    )
    expect(chooseFallbackAction(false, noFallback)).toBe('unmatched')
  })
})
