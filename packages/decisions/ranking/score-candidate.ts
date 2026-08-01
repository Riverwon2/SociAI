import {
  calculateCandidateScore,
  type CandidateProfile,
  type CandidateScoreBreakdown,
  type Task
} from '@30-minute-exchange/contracts'

import { calculateDistanceScore } from './distance-score.js'
import { calculateExperienceScore } from './experience-score.js'
import { roundScore } from './ranking-policy.js'

export function scoreCandidate(
  task: Task,
  profile: CandidateProfile,
  availability: number,
  distanceKm: number
): CandidateScoreBreakdown {
  const components = {
    availability,
    distance: calculateDistanceScore(distanceKm),
    experience: calculateExperienceScore(task.requiredExperience, profile.experienceTags),
    reliability: profile.reliabilityRate
  }

  return {
    ...components,
    weightedTotal: roundScore(calculateCandidateScore(components))
  }
}
