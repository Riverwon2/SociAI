import type { ActivityRegion } from '@30-minute-exchange/contracts'

import { MAX_DISTANCE_KM, roundScore } from './ranking-policy.js'

const EARTH_RADIUS_KM = 6_371

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function haversineDistanceKm(
  left: NonNullable<ActivityRegion['center']>,
  right: NonNullable<ActivityRegion['center']>
): number {
  const latitudeDelta = toRadians(right.latitude - left.latitude)
  const longitudeDelta = toRadians(right.longitude - left.longitude)
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(left.latitude)) *
      Math.cos(toRadians(right.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

export function calculateDistanceKm(
  taskRegion: ActivityRegion,
  candidateRegion: ActivityRegion
): number | null {
  if (taskRegion.center !== undefined && candidateRegion.center !== undefined) {
    return roundScore(haversineDistanceKm(taskRegion.center, candidateRegion.center))
  }

  const sameCode =
    taskRegion.regionCode !== undefined && taskRegion.regionCode === candidateRegion.regionCode
  return sameCode || taskRegion.label === candidateRegion.label ? 0 : null
}

export function calculateDistanceScore(distanceKm: number): number {
  return roundScore(Math.max(0, 1 - distanceKm / MAX_DISTANCE_KM))
}
