export const RANKING_POLICY_VERSION = 'candidate-ranking-v1'
export const MAX_DISTANCE_KM = 5

export function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
