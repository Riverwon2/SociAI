import type { DemoScenarioFixture } from '@30-minute-exchange/contracts'

import { getDemoScenario } from '../src/demo/scenarios.js'

export function createClarificationFixture(): DemoScenarioFixture {
  const base = getDemoScenario('first_candidate_accepts').fixture
  const task = base.tasks[0]
  if (task === undefined) throw new Error('Clarification test requires one task')

  return {
    ...base,
    tasks: [
      {
        ...task,
        status: 'held',
        missingInformation: [{ code: 'item_weight', message: '물품 무게 정보가 필요합니다.' }]
      }
    ],
    responseSequence: [],
    expectedEventTypes: [
      'request.created',
      'plan.created',
      'task.created',
      'safety.checked',
      'sufficiency.checked',
      'task.held',
      'clarification.invited',
      'clarification.responded',
      'request.completed'
    ],
    expectedFinalResult: {
      ...base.expectedFinalResult,
      status: 'unmatched',
      taskResults: [
        {
          taskId: task.taskId,
          status: 'held',
          reasonCodes: ['required_information_missing'],
          userMessage: '정보 확인 대화 의향만 확인하고 작업을 보류했습니다.'
        }
      ],
      userMessage: '작업은 정보 보류 상태입니다.'
    }
  }
}
