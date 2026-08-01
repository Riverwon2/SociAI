import { roundScore } from './ranking-policy.js'

function normalizeTag(tag: string): string {
  return tag.normalize('NFKC').trim().toLocaleLowerCase('ko-KR')
}

export function calculateExperienceScore(
  requiredExperience: readonly string[],
  experienceTags: readonly string[]
): number {
  if (requiredExperience.length === 0) return 1

  const available = new Set(experienceTags.map(normalizeTag))
  const matched = requiredExperience.filter((tag) => available.has(normalizeTag(tag))).length
  return roundScore(matched / requiredExperience.length)
}
