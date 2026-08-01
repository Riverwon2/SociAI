export const SAFETY_REASON_CODES = Object.freeze({
  ordinaryLifeSupport: 'ordinary_life_support',
  indoorEntryRequiresVerification: 'indoor_entry_requires_verification',
  heavyItemRequiresVerification: 'heavy_item_requires_verification',
  medicationAssistance: 'medication_assistance',
  medicalProcedure: 'medical_procedure',
  cashHandling: 'cash_handling',
  unsupervisedChildCare: 'unsupervised_child_care',
  emergencySituation: 'emergency_situation'
})

export type SafetyReasonCode = (typeof SAFETY_REASON_CODES)[keyof typeof SAFETY_REASON_CODES]
