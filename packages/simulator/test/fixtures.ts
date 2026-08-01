import {
  SCHEMA_VERSION,
  type Candidate,
  type SendOutreachCall,
  type Task
} from '@30-minute-exchange/contracts'

export const task: Task = {
  schemaVersion: SCHEMA_VERSION,
  runId: 'run_simulator_001',
  requestId: 'request_simulator_001',
  taskId: 'task_simulator_001',
  title: '재활용품 분리배출',
  description: '가벼운 재활용품을 단지 배출장으로 옮긴다.',
  timeWindow: {
    startAt: '2026-08-01T10:00:00.000Z',
    endAt: '2026-08-01T11:00:00.000Z'
  },
  region: { label: '푸른솔동', approximateLocation: '푸른솔동 생활권' },
  requiredExperience: ['가벼운 생활 폐기물 이동'],
  estimatedDurationMinutes: 20,
  status: 'ready',
  missingInformation: []
}

export const candidate: Candidate = {
  schemaVersion: SCHEMA_VERSION,
  runId: task.runId,
  requestId: task.requestId,
  taskId: task.taskId,
  candidateId: 'candidate_simulator_001',
  displayName: '가상 이웃 하나',
  activityRegion: task.region,
  activityRadiusKm: 1,
  isAvailable: true,
  distanceKm: 0.4,
  experienceTags: ['가벼운 생활 폐기물 이동'],
  reliabilityRate: 0.96,
  scoreBreakdown: {
    availability: 1,
    distance: 0.92,
    experience: 1,
    reliability: 0.96,
    weightedTotal: 0.974
  },
  rank: 1,
  isSimulation: true
}

export function outreachCall(attempt: 1 | 2 | 3, seed = 'retry-path-v1'): SendOutreachCall {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: task.runId,
    requestId: task.requestId,
    taskId: task.taskId,
    toolCallId: `call_outreach_${attempt}`,
    task,
    candidate: { ...candidate, candidateId: `candidate_retry_00${attempt}`, rank: attempt },
    attempt,
    timeoutMinutes: 10,
    seed
  }
}
