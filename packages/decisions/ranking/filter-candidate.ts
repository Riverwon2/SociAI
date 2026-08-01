import type { CandidateProfile, Task } from '@30-minute-exchange/contracts'

import { calculateAvailabilityScore } from './availability-score.js'
import { calculateDistanceKm } from './distance-score.js'

export type CandidateEligibility = Readonly<{
  eligible: boolean
  availabilityScore: number
  distanceKm: number | null
  exclusionReasons: readonly string[]
}>

export function filterCandidate(task: Task, profile: CandidateProfile): CandidateEligibility {
  const availabilityScore = calculateAvailabilityScore(task, profile.availabilityWindows)
  const distanceKm = calculateDistanceKm(task.region, profile.activityRegion)
  const exclusionReasons: string[] = []

  if (availabilityScore === 0) exclusionReasons.push('availability_mismatch')
  if (distanceKm === null) exclusionReasons.push('distance_unknown')
  if (distanceKm !== null && distanceKm > profile.activityRadiusKm) {
    exclusionReasons.push('outside_activity_radius')
  }

  return {
    eligible: exclusionReasons.length === 0,
    availabilityScore,
    distanceKm,
    exclusionReasons
  }
}
