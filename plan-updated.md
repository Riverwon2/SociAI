# 30분 교환소 구현 계획

이 문서는 `summary.md`를 제품 요구사항의 최우선 기준으로 삼는다. `AGENTS.md`는 구현·안전·검증 규칙으로 적용하며, 두 문서가 다르게 읽힐 경우 해커톤 MVP의 사용자 문제와 데모 범위는 `summary.md`를 따른다.

## 1. 목표

이동에 제약이 있는 1인 가구가 당일 필요한 30분 이내의 무료·비의료 생활지원을 한 번만 요청하면, 시스템이 안전한 태스크를 분리하고 적합한 이웃 후보에게 순서대로 섭외해 최종 매칭 결과를 만든다.

핵심은 사람을 추천하는 화면이 아니라 다음 행동까지 실행하는 운영 에이전트다.

- 요청자는 실행 중 추가 질문을 받지 않는다.
- 후보의 수락·거절은 시스템이 관찰하는 응답 이벤트다.
- 거절·무응답 시 사전 승인된 범위 안에서 다음 대안을 자동 실행한다.
- 위험한 태스크만 제외하고 안전한 태스크는 계속 진행한다.
- 모든 후보가 실패하면 `unmatched`를 정직하게 반환한다.

## 2. MVP 범위

### 반드시 구현

- 필수 선택 사항과 자연어 설명을 한 번에 제출하는 `InitialRequest`
- 실제 OpenAI API 또는 공식 SDK를 사용한 요청 해석과 태스크 분해
- 태스크별 결정론적 안전 판정과 정보 충분성 검사
- 지역·가용 시간·거리·경험·신뢰도 기반 후보 필터링과 랭킹
- 결정론적 후보 응답 시뮬레이터와 가상 시계
- 거절·무응답 후 최대 3명까지 자동 재섭외
- 부분 성공을 보존하는 태스크별 결과 집계
- 정규화 이벤트 화면과 별도의 raw 도구 이벤트 화면
- 세 대표 시나리오의 라이브 데모와 재현 가능한 테스트

### MVP에서 제외

- 유료 요청, 실제 결제와 외부 정산
- 실제 메시징, 실제 연락처 교환
- 실제 지도 제공자 연동
- 실제 신원 확인과 기관 배차
- 의료행위, 현금 대리, 아동 단독 돌봄의 일반 이웃 매칭
- 시간 크레딧, 온기 여정, 후기, 공개 성공 사례의 실제 운영

제외 기능을 화면에 보여줄 경우 반드시 `simulation`으로 표시한다. Replay 데이터는 라이브 OpenAI raw 실행으로 표현하지 않는다.

## 3. 최초 입력 계약

`InitialRequest`는 한 번에 다음 정보를 받는다.

| 항목 | 규칙 |
| --- | --- |
| 도움 내용 | 자연어, 필수 |
| 희망 시간 | 당일 시간 범위, 필수 |
| 활동 지역 | 대략적인 지역, 필수 |
| 최대 활동 시간 | 30분 이하, 필수 |
| 시간 조정 | 사전 허용 여부 |
| 부분 완료 | 사전 허용 여부 |
| 범위 축소 | 사전 허용 여부 |
| 비용 | MVP에서는 `none`으로 고정 |
| 결제 방식 | MVP에서는 `not_applicable`로 고정 |
| 추가 사항 | 접근성·물품 무게·실내 출입 여부 등, 선택 |

필수 값이 유효하지 않거나 무료·비의료·30분 범위를 벗어나면 중간 질문 없이 안전한 최종 결과를 반환한다.

정확한 주소와 연락처는 매칭 확정 전 후보에게 전달하지 않는다. 데모에는 가상 인물·지역·연락처만 사용한다.

## 4. 지원 결과 상태

- `fully_matched`
- `partially_matched`
- `safety_excluded`
- `unmatched`

계약에는 영문 enum을 사용하고 UI에서만 한국어로 번역한다.

## 5. 의도적인 실행 파이프라인

```text
InitialRequest
  │
  ├─ 1. 경계 입력 검증
  ├─ 2. OpenAI 요청 해석·태스크 분해
  ├─ 3. 태스크별 결정론적 안전 판정
  ├─ 4. 태스크별 정보 충분성 검사
  ├─ 5. 후보 필터링·랭킹
  ├─ 6. 최고 순위 후보에게 섭외
  ├─ 7. 결정론적 응답 이벤트 관찰
  ├─ 8. 실패 원인에 따른 계획 갱신
  ├─ 9. 매칭 확정과 태스크 결과 집계
  └─ 10. 요청 최종 결과 생성
```

이 순서는 다음 이유로 유지한다.

1. 잘못된 입력이 OpenAI나 도구 실행으로 넘어가는 것을 막는다.
2. OpenAI가 자연어를 작은 태스크로 분해해야 태스크별 안전 판정이 가능하다.
3. 안전 정책은 후보 검색 전에 실행해 위험한 태스크가 이웃에게 노출되지 않게 한다.
4. 필수 정보가 부족하면 해당 태스크만 보류하고 다른 태스크를 보존한다.
5. 후보 점수 근거를 확정한 뒤에만 섭외한다.
6. 거절·타임아웃 뒤에는 반드시 `plan.updated`를 먼저 발행한다.
7. 태스크별 성공과 실패를 독립 집계해 부분 성공을 보존한다.

OpenAI는 해석, 계획·재계획, 사용자 안내 문구를 담당한다. 안전 정책, 정보 충분성, 점수, 타이머, 상태 전이, 후보 응답은 결정론적 코드가 담당한다.

요청 설명과 모든 도구 결과는 신뢰할 수 없는 데이터로 취급한다. 프롬프트에는 prompt injection, 모순된 입력, 누락 정보, 빈 후보군, 도구 오류, 잘못된 구조화 출력에 대한 처리 규칙을 포함하며, 모델 출력은 스키마 검증을 통과해야만 다음 단계로 전달한다.

## 6. 안전과 fallback 정책

### 안전 수준과 행동

| 수준 | 행동 |
| --- | --- |
| `low` | 일반 후보 탐색 진행 |
| `conditional` | 결정론적으로 조건을 확인한 경우에만 진행 |
| `high` | 해당 태스크의 일반 이웃 매칭 차단 |
| `emergency` | 해당 태스크 매칭 중단과 긴급 안내 |

`SafetyLevel`과 `SafetyAction`은 별도 필드로 유지한다. 정보 부족은 안전 수준이 아니라 `SufficiencyDecision`으로 표현한다.

### 실패 후 행동

실패할 때 한 번에 하나의 변수만 변경한다.

1. 다음 후보
2. 사전 허용된 시간 조정
3. 사전 허용된 범위 축소

`fallbackPolicy`가 허용하지 않은 변경은 사용자에게 질문하지 않는다. 가능한 후보와 허용된 fallback을 모두 소진하면 해당 태스크를 `unmatched`로 종료한다.

후보당 가상 10분을 기다리며 최대 3명까지만 시도한다.

## 7. 후보 점수와 시뮬레이터

데모 점수는 다음 공식으로 계산하고 구성 요소를 UI에 표시한다.

```text
총점 = 가용성 40% + 거리 25% + 관련 경험 20% + 신뢰도 15%
```

- 같은 입력과 seed는 같은 후보 순서를 만든다.
- 동점 처리 기준은 `candidateId` 오름차순으로 고정한다.
- 후보 응답은 시나리오 설정과 고정 seed로 결정한다.
- 무응답은 즉시 결과로 반환하지 않고 가상 시계가 10분에 도달할 때 `outreach.timed_out`을 발행한다.

## 8. 공용 계약

`packages/contracts`를 유일한 계약 원본으로 사용한다. TypeScript 타입과 런타임 검증은 같은 Zod 스키마에서 파생한다.

먼저 잠글 계약:

- `InitialRequest`
- `Task`
- `SafetyDecision`
- `SufficiencyDecision`
- `Candidate`
- `AgentEvent`
- `RawToolEvent`
- `FinalResult`

공통 식별자:

- `runId`
- `requestId`
- 선택적 `taskId`
- 도구 호출·결과 연결용 `toolCallId`
- 단조 증가하는 `sequence`
- `schemaVersion`

계약 변경 규칙:

- 모든 API와 도구 경계에서 런타임 검증
- 이벤트는 append-only
- UI 정렬은 시각이 아니라 `sequence` 기준
- 필드 삭제·이름 변경 금지, optional 필드 추가 우선
- 호환 불가능한 변경은 `schemaVersion` 증가
- 예제 JSON과 계약 테스트를 같은 변경에서 수정
- 알 수 없는 이벤트가 프론트를 중단시키지 않게 처리

## 9. 이벤트와 관측성

두 스트림을 절대 합치지 않는다.

### AgentEvent

주 화면에서 사용하는 정규화된 이벤트다.

```text
request.created
plan.created
task.created
safety.checked
candidates.ranked
outreach.sent
neighbor.replied / outreach.timed_out
plan.updated
match.confirmed / task.blocked
tool.failed
request.completed
```

모든 `plan.updated`는 다음 필드를 포함한다.

- `revision`
- `trigger`
- `observation`
- `previousAction`
- `nextAction`
- `policyApplied`
- `userInputRequired: false`

### RawToolEvent

심사위원용 두 번째 화면에서 사용하는 실제 OpenAI SDK 이벤트다.

- provider payload 전체를 `raw`에 그대로 보존한다.
- 필드 이름 변경, 필터링, 요약, 장식, 조작을 금지한다.
- `runId`, `sequence`, `toolCallId` 같은 실행 메타데이터는 `raw` 밖에 둔다.
- 실제 개인 데이터는 raw 경로에 넣지 않는다.
- 가짜 raw 로그를 만들지 않는다.

## 10. 프로젝트 구조

```text
AGENT_24/
├─ apps/
│  ├─ server/                    # 1번: A
│  │  ├─ openai/                 # 실제 OpenAI 요청 해석·태스크 분해
│  │  ├─ orchestration/          # 실행 계획, 상태 전이, 재계획
│  │  ├─ runs/                   # run/task 상태와 API
│  │  └─ aggregation/            # 태스크 결과와 최종 결과 집계
│  └─ web/                       # 3번: C
│     ├─ request/                # one-shot 입력
│     ├─ timeline/               # AgentEvent 화면
│     ├─ raw-console/            # 별도 RawToolEvent 화면
│     └─ results/                # 태스크별·전체 최종 결과
├─ packages/
│  ├─ contracts/                 # 3번: A+C, 공용 Zod 계약
│  ├─ decisions/                 # 2번: B
│  │  ├─ safety/                 # 안전 판정
│  │  ├─ sufficiency/            # 정보 충분성
│  │  ├─ ranking/                # 후보 필터·점수
│  │  └─ policies/               # fallback·재시도 정책
│  ├─ simulator/                 # 2번: B
│  │  ├─ scenarios/              # 세 대표 시나리오
│  │  ├─ virtual-clock/          # 가상 10분 타이머
│  │  └─ synthetic-data/         # 가상 요청자·후보 데이터
│  └─ event-stream/              # 3번: A+C
│     ├─ agent-events/           # 정규화 이벤트
│     └─ raw-tool-events/        # 원본 SDK 이벤트 전달
├─ tests/
│  └─ e2e/                       # 3번 주도, 세 시나리오 검증
├─ summary.md                    # 제품 요구사항 최우선 기준
├─ AGENTS.md                     # 구현·안전·검증 지침
└─ plan-updated.md               # 본 실행 계획
```

의존 방향은 단방향으로 유지한다.

```text
apps/server ──→ contracts, decisions, simulator, event-stream
apps/web    ──→ contracts
decisions   ──→ contracts
simulator   ──→ contracts
event-stream──→ contracts
```

`packages/*`는 `apps/*`를 import하지 않는다. `decisions`, `simulator`, `event-stream`은 서로 직접 의존하지 않고 오케스트레이터가 조합한다.

## 11. 3명 역할 분담

### 1번: A, AI·오케스트레이션

소유 영역: `apps/server`

- 서버 실행 환경과 요청 API
- 실제 OpenAI API/SDK 연결
- 자연어 요청 해석과 태스크 분해
- run/task 상태와 도구 디스패치
- 서버 런타임의 `AgentEvent`·`RawToolEvent` 발행
- 거절·타임아웃·안전 차단 후 재계획
- `plan.updated` 생성
- 태스크별 결과와 최종 결과 집계
- OpenAI 통합 테스트와 프롬프트 eval

1번은 B의 정책을 다시 구현하거나 프론트용 타입을 별도로 만들지 않는다. 이벤트 발행은 1번 서버 책임이지만, 이벤트 계약·전송 유틸·프론트 표시 규칙은 3번의 `packages/event-stream`과 `packages/contracts`를 따른다.

### 2번: B, 결정·검증

소유 영역: `packages/decisions`, `packages/simulator`

- 태스크별 안전 정책
- 정보 충분성 검사
- 후보 필터와 40/25/20/15 점수
- 고정 seed와 가상 시계
- 수락·거절·무응답 시뮬레이터
- fallback과 최대 3명 재시도 정책
- 합성 데이터와 단위·결정론 테스트

2번의 구현은 서버 없이 실행 가능한 순수 함수로 제공한다.

### 3번: A+C, 통합·프론트엔드·데모

소유 영역: `packages/contracts`, `packages/event-stream`, `apps/web`, `tests/e2e`

- 공용 Zod 계약과 예제 JSON
- `AgentEvent`와 `RawToolEvent` 분리 계약·전송 유틸
- raw payload 무변형 보존
- one-shot 입력과 상태 타임라인
- 후보 점수 근거와 `plan.updated` 표시
- raw 이벤트 전용 두 번째 화면
- replay와 `simulation` 표시
- 세 대표 시나리오 E2E와 라이브 데모 운영

계약의 기술적 편집자는 3번이지만 계약 변경은 세 명 모두 승인한다.

## 12. 담당자 간 인터페이스

| 제공자 | 소비자 | 계약 |
| --- | --- | --- |
| 3번 | 1번 | 검증된 `InitialRequest`와 공용 스키마 |
| 1번 | 2번 | `Task`, 후보 목록, 시나리오·seed |
| 2번 | 1번 | `SafetyDecision`, `SufficiencyDecision`, 후보 순위, 응답 이벤트 |
| 1번 | 3번 | `AgentEvent`, `RawToolEvent`, `FinalResult` |

B의 최소 함수:

```text
checkSafety(task) -> SafetyDecision
checkSufficiency(task, availableFacts) -> SufficiencyDecision
rankCandidates(task, candidates) -> RankedCandidate[]
simulateOutreach(scenario, candidate, seed, clock) -> ResponseEvent
```

## 13. 세 대표 데모 시나리오

### 시나리오 1: 생필품 수령

- 다리 부상으로 2주간 외출이 어려운 67세 1인 가구
- 오늘 오후 6시 전, 도보 10분 거리 관리실의 가벼운 생필품 상자를 현관 앞까지 전달
- 최대 30분, 비용 없음
- 첫 후보 수락
- 최종 결과 `fully_matched`

### 시나리오 2: 분리배출

- 휠체어를 사용하며 혼자 거주하는 54세 1인 가구
- 오늘 오후 8시 전, 현관 앞의 가벼운 재활용품을 단지 배출장까지 이동
- 최대 20분, 비용 없음, 실내 출입 없음
- 첫 후보 거절, 두 번째 후보 10분 무응답, `plan.updated`, 세 번째 후보 수락
- 최종 결과 `fully_matched`

### 시나리오 3: 문서 전달과 약 복용 보조

- 일시적인 허리 부상으로 거동이 불편한 72세 1인 가구
- 문서봉투를 도보 8분 거리 주민센터 민원함에 전달
- 약 복용 보조 요청은 의료행위 가능성으로 차단
- 문서 전달은 첫 후보 수락
- 문서 전달 `fully_matched`, 약 복용 보조 `safety_excluded`
- 전체 결과 `partially_matched`

세 시나리오의 입력, 후보, 응답 순서, 예상 이벤트, 최종 결과를 계약-valid fixture로 함께 관리한다.

## 14. 실제 구현과 simulation 경계

### 실제 실행

- 입력 검증
- 실제 OpenAI 요청 해석과 태스크 분해
- 실제 도구 호출과 결과 수신
- 결정론적 안전·랭킹·타이머 코드
- 거절·타임아웃 후 실제 오케스트레이션 재계획
- 두 이벤트 스트림의 실시간 전송
- 최종 결과 집계

### Simulation

- 요청자와 이웃 프로필
- 후보 응답과 메시지 전달
- 가상 시계
- 채팅, 지도, 크레딧, 후기 상태

Simulation은 미래 실제 어댑터와 같은 계약을 사용하지만 화면에서 명확히 표시한다.

## 15. 실패 처리

| 실패 | 처리 |
| --- | --- |
| OpenAI 호출 실패 | 실제 오류 이벤트 발행, 완료된 태스크 보존, 안전한 최종 상태 반환 |
| OpenAI 구조화 출력 오류 | 스키마 검증 후 최대 1회 재시도, 다시 실패하면 안전 종료 |
| 안전 도구 오류 | 영향받은 태스크만 중단하고 다른 태스크 계속 진행 |
| 후보 없음 | 허용된 fallback 실행 또는 `unmatched` |
| 후보 거절 | `plan.updated` 후 다음 후보 |
| 후보 무응답 | 가상 10분 후 timeout, `plan.updated` 후 다음 후보 |
| 이벤트 스트림 재연결 | 마지막 `sequence` 다음부터 재개 |
| 알 수 없는 이벤트 | UI에서 unknown 상태로 표시하고 실행 지속 |

오류 시 준비된 replay를 보여줄 수 있지만 반드시 replay로 표시한다. Replay raw 데이터를 라이브 OpenAI 로그로 주장하지 않는다.

## 16. 병렬 협업 계획

### T+0~1h: 착수와 계약 v0 동결

- README, manifest, lockfile, CI, 기존 계약·테스트, git 상태 확인
- 세 대표 fixture와 결과 상태 확정
- 공용 계약, 이벤트 이름, ID, sequence 규칙 확정
- 실제 실행과 simulation 경계 확정

T+1h 이후에는 optional 필드 추가만 허용한다. 필드 삭제나 이름 변경은 세 명 합의와 전체 소비자 수정을 요구한다.

### T+1~5h: 독립 병렬 구현

- 1번은 typed stub으로 오케스트레이션 작성
- 2번은 순수 함수와 단위 테스트 작성
- 3번은 계약-valid fixture로 두 화면 작성

### T+5~8h: 시나리오 1 수직 통합

- stub을 실제 B 함수로 교체
- fixture 이벤트를 실제 스트림으로 교체
- 실제 OpenAI 호출과 raw 화면 확인
- 시나리오 1을 10회 반복

### T+8~13h: 시나리오 2

- 거절·타임아웃·가상 시계
- `plan.updated` 선행 순서
- 세 번째 후보 수락

### T+13~16h: 시나리오 3

- 태스크 분해
- 의료 가능 태스크 차단
- 안전 태스크 계속 진행
- 부분 결과 집계

### T+16~20h: 전체 검증

- 형식, lint, typecheck, unit, integration, E2E, build
- 커버리지, 의존성 audit, secret scan, `git diff --check`
- jailbreak, 희소 입력, 잘못된 도구 출력, 후보 없음, 도구 실패 eval

### T+20~24h: 동결과 리허설

- 핵심 기능 동결
- 두 화면을 사용하는 라이브 데모 반복
- 네트워크·API 오류 시 안전 종료 확인
- 발표 역할과 실제·simulation 설명 연습

## 17. 테스트 소유권

### 1번

- OpenAI tool calling 통합 테스트
- 요청부터 최종 결과까지 이벤트 순서
- `plan.updated`가 다음 행동보다 먼저 발생하는지 검증
- 부분 성공 보존과 도구 실패 처리

### 2번

- 안전 규칙과 정보 충분성
- 후보 점수 구성과 동점 처리
- 가상 시계, 타임아웃, 최대 3명
- 같은 seed의 동일 결과

### 3번

- 모든 계약과 예제 JSON
- `toolCallId` call/result 상관관계
- raw payload 무변형
- 알 수 없는 이벤트 처리
- 세 대표 시나리오 E2E와 추가 질문 없음

80% 이상 커버리지를 유지하되 의미 없는 assertion은 만들지 않는다.

## 18. 완료 기준

- [ ] 실제 OpenAI 호출이 핵심 실행 경로에 있다.
- [ ] 한 번 제출한 뒤 최종 결과까지 사용자 추가 입력이 없다.
- [ ] 세 대표 시나리오가 라이브로 동작한다.
- [ ] 거절·타임아웃 후 `plan.updated`가 먼저 발생한다.
- [ ] 위험 태스크가 안전 태스크의 성공을 취소하지 않는다.
- [ ] 후보 점수 네 구성 요소가 화면에 표시된다.
- [ ] `AgentEvent`와 `RawToolEvent`가 분리되어 있다.
- [ ] raw provider payload가 변경되지 않는다.
- [ ] 모든 demo 데이터가 가상임을 표시한다.
- [ ] 같은 seed가 같은 정규화 이벤트와 결과를 만든다.
- [ ] replay와 live가 명확히 구분된다.
- [ ] 요구된 검증을 실행하고 미실행 항목을 보고한다.

## 19. Git과 전달 규칙

- 커밋은 `2026-08-01 14:00 Asia/Seoul` 이후에만 생성한다.
- 커밋 직전 공식 규정과 현재 KST를 다시 확인한다.
- 커밋 메시지는 `<type>: <description>` 형식을 사용한다.
- 전체 diff, 테스트 결과, 비밀정보 노출을 검토한 뒤 커밋한다.
- push, PR, 배포, 외부 메시지는 명시적인 승인을 받은 범위에서만 수행한다.
- 최종 보고에는 변경 내용, 파이프라인 순서의 이유, 통과한 검사, simulation 범위, 남은 데모 위험을 기록한다.
