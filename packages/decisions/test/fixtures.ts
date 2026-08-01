import { SCHEMA_VERSION, type CandidateProfile, type Task } from '@30-minute-exchange/contracts'

export const identifiers = {
  runId: 'run_decisions_001',
  requestId: 'request_decisions_001',
  taskId: 'task_decisions_001'
} as const

export const task: Task = {
  schemaVersion: SCHEMA_VERSION,
  ...identifiers,
  title: '문서 전달',
  description: '문서봉투를 주민센터 민원함에 전달한다.',
  timeWindow: {
    startAt: '2026-08-01T08:00:00.000Z',
    endAt: '2026-08-01T09:00:00.000Z'
  },
  region: {
    label: '새봄동',
    approximateLocation: '새봄동 주민센터 인근',
    regionCode: 'KR-DEMO-001',
    center: { latitude: 37.5, longitude: 127 }
  },
  requiredExperience: ['문서 전달'],
  estimatedDurationMinutes: 20,
  status: 'created',
  missingInformation: []
}

const fullAvailability = [task.timeWindow]

export const candidateProfiles: readonly CandidateProfile[] = [
  {
    schemaVersion: SCHEMA_VERSION,
    candidateId: 'candidate_alpha',
    displayName: '가상 이웃 하나',
    activityRegion: {
      label: '새봄동',
      approximateLocation: '새봄동 생활권',
      regionCode: 'KR-DEMO-001',
      center: { latitude: 37.5, longitude: 127.004 }
    },
    activityRadiusKm: 1,
    availabilityWindows: fullAvailability,
    experienceTags: ['문서 전달'],
    reliabilityRate: 0.95,
    isSimulation: true
  },
  {
    schemaVersion: SCHEMA_VERSION,
    candidateId: 'candidate_beta',
    displayName: '가상 이웃 둘',
    activityRegion: {
      label: '새봄동',
      approximateLocation: '새봄동 생활권',
      regionCode: 'KR-DEMO-001',
      center: { latitude: 37.5, longitude: 127.008 }
    },
    activityRadiusKm: 3,
    availabilityWindows: fullAvailability,
    experienceTags: ['생활 지원'],
    reliabilityRate: 0.9,
    isSimulation: true
  },
  {
    schemaVersion: SCHEMA_VERSION,
    candidateId: 'candidate_unavailable',
    displayName: '가상 이웃 셋',
    activityRegion: {
      label: '새봄동',
      approximateLocation: '새봄동 생활권',
      center: { latitude: 37.5, longitude: 127.002 }
    },
    activityRadiusKm: 1,
    availabilityWindows: [
      {
        startAt: '2026-08-01T10:00:00.000Z',
        endAt: '2026-08-01T11:00:00.000Z'
      }
    ],
    experienceTags: ['문서 전달'],
    reliabilityRate: 1,
    isSimulation: true
  }
]

export function safetyCall(targetTask: Task = task) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ...identifiers,
    toolCallId: 'call_safety_001',
    task: targetTask
  }
}

export function candidatesCall(profiles: readonly CandidateProfile[] = candidateProfiles) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ...identifiers,
    toolCallId: 'call_candidates_001',
    task,
    candidateProfiles: [...profiles]
  }
}
