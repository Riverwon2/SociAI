export const SUFFICIENCY_REASON_CODES = Object.freeze({
  requiredInformationAvailable: 'required_information_available',
  missingRequiredInformation: 'missing_required_information'
})

/**
 * These are the only missing-information codes that can hold an otherwise
 * contract-valid task. `door_access` is required to execute the scheduled
 * handoff; schedule, region, duration, and experience already come from Task.
 */
export const CORE_SUFFICIENCY_INFORMATION_CODES = Object.freeze(['door_access'] as const)

export function isCoreSufficiencyInformationCode(code: string): boolean {
  return CORE_SUFFICIENCY_INFORMATION_CODES.includes(
    code as (typeof CORE_SUFFICIENCY_INFORMATION_CODES)[number]
  )
}
