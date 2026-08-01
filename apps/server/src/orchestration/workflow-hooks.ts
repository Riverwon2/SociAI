export const WorkflowHookStage = {
  inputValidation: 'input.validation',
  taskDecomposition: 'task.decomposition',
  safetyCheck: 'safety.check',
  sufficiencyCheck: 'sufficiency.check',
  bundlePlanning: 'bundle.planning',
  candidateSearch: 'candidate.search',
  outreach: 'outreach',
  matchConfirmation: 'match.confirmation',
  finalOutput: 'final.output'
} as const

export type WorkflowHookStage = (typeof WorkflowHookStage)[keyof typeof WorkflowHookStage]
export type WorkflowHookPhase = 'before' | 'after' | 'error'
export type WorkflowHook = Readonly<{
  sequence: number
  occurredAt: string
  stage: WorkflowHookStage
  phase: WorkflowHookPhase
  data: Readonly<Record<string, unknown>>
}>
export type WorkflowHookSink = (event: WorkflowHook) => void
export type WorkflowHookEmitter = Readonly<{
  emit: (
    stage: WorkflowHookStage,
    phase: WorkflowHookPhase,
    data: Readonly<Record<string, unknown>>
  ) => void
}>

export function createWorkflowHookEmitter({
  onHook,
  occurredAt = new Date().toISOString()
}: Readonly<{
  onHook?: WorkflowHookSink
  occurredAt?: string
}>) {
  let sequence = 0

  return {
    emit: (
      stage: WorkflowHookStage,
      phase: WorkflowHookPhase,
      data: Readonly<Record<string, unknown>>
    ): void => {
      sequence += 1
      onHook?.({ sequence, occurredAt, stage, phase, data })
    }
  }
}

export function writeWorkflowHookToConsole(event: WorkflowHook): void {
  console.log(JSON.stringify({ workflowHook: event }))
}
