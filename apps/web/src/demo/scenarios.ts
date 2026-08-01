import { DemoScenarioFixtureSchema, type DemoScenarioFixture } from '@30-minute-exchange/contracts'

import happyPath from '../../../../packages/contracts/examples/first-candidate-accepts.json' with { type: 'json' }
import mixedRisk from '../../../../packages/contracts/examples/mixed-risk-partial-match.json' with { type: 'json' }
import multiHelperSplit from '../../../../packages/contracts/examples/multi-helper-split.json' with { type: 'json' }
import retryPath from '../../../../packages/contracts/examples/reject-timeout-accept.json' with { type: 'json' }
import threeWayConflict from '../../../../packages/contracts/examples/three-way-conflict.json' with { type: 'json' }

export interface ScenarioPresentation {
  readonly eyebrow: string
  readonly title: string
  readonly description: string
  readonly accent: 'leaf' | 'sun' | 'plum' | 'sky'
}

export interface DemoScenario {
  readonly fixture: DemoScenarioFixture
  readonly presentation: ScenarioPresentation
}

const scenarioPresentations: Record<DemoScenarioFixture['scenarioId'], ScenarioPresentation> = {
  first_candidate_accepts: {
    eyebrow: '기본 흐름',
    title: '첫 이웃이 바로 수락',
    description: '가벼운 생필품을 관리실에서 현관 앞으로 옮겨요.',
    accent: 'leaf'
  },
  reject_timeout_accept: {
    eyebrow: '실시간 적응',
    title: '거절과 무응답 뒤 재섭외',
    description: '세 번째 이웃이 수락할 때까지 계획을 바꿔 실행해요.',
    accent: 'sun'
  },
  mixed_risk_partial_match: {
    eyebrow: '부분 성공',
    title: '위험한 일만 안전하게 제외',
    description: '약 복용 보조는 막고 문서 전달은 계속 연결해요.',
    accent: 'plum'
  },
  multi_helper_split: {
    eyebrow: '다중 이웃',
    title: '시간이 떨어진 일은 나눠서 배정',
    description: '한 번에 묶을 수 없는 두 작업을 이웃 두 명에게 나눠 맡겨요.',
    accent: 'sky'
  },
  three_way_conflict: {
    eyebrow: '시각 충돌',
    title: '같은 시각에 겹친 세 가지',
    description: '한 사람이 할 수 없는 세 요청을 이웃 세 명에게 동시에 보내요.',
    accent: 'sun'
  }
}

const parsedFixtures = [happyPath, retryPath, mixedRisk, multiHelperSplit, threeWayConflict].map(
  (value) => DemoScenarioFixtureSchema.parse(value)
)

export const demoScenarios: readonly DemoScenario[] = parsedFixtures.map((fixture) => ({
  fixture,
  presentation: scenarioPresentations[fixture.scenarioId]
}))

export function getDemoScenario(scenarioId: DemoScenarioFixture['scenarioId']): DemoScenario {
  const scenario = demoScenarios.find(({ fixture }) => fixture.scenarioId === scenarioId)
  if (scenario === undefined) throw new Error(`Unknown demo scenario: ${scenarioId}`)
  return scenario
}
