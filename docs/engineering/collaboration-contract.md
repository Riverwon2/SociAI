# A/B/C 병렬 개발 공통 규약 v1

이 문서는 세 담당자가 독립적으로 구현한 코드를 첫 통합에서 별도 변환 없이 연결하기 위한 기준이다. 저장소 최상위 `AGENTS.md`가 이 문서보다 우선한다.

## 소유권

| 영역                                             | DRI | 책임                                                                       |
| ------------------------------------------------ | --- | -------------------------------------------------------------------------- |
| `apps/api`                                       | A   | OpenAI, 오케스트레이션, 실행 상태, 도구 어댑터, 결과 집계, SSE, raw 이벤트 |
| `packages/contracts`                             | B   | Zod 스키마, 타입 export, 예제 JSON, 계약 테스트                            |
| `packages/decision-engine`, `packages/demo-data` | B   | 안전·랭킹·응답 정책과 결정론 테스트                                        |
| `apps/web`, `tests/e2e`                          | C   | 입력·진행·결과·raw 화면, 스트림 소비, E2E                                  |

공용 계약은 B가 변경을 준비하고 A와 C가 API/UI 영향을 검토한다. 공용 파일 변경에는 예제 JSON과 계약 테스트를 반드시 함께 포함한다.

## 기술 기준

- pnpm workspace와 TypeScript strict mode를 사용한다.
- 공유 타입은 직접 작성하지 않고 Zod 스키마의 `z.infer`로 생성한다.
- HTTP, OpenAI 출력, 도구 입출력, SSE, fixture 등 모든 시스템 경계에서 런타임 검증을 수행한다.
- `any`, 암시적 상태 문자열, 공유 객체 직접 변경을 금지한다.
- 변경된 상태는 새 객체와 새 append-only 이벤트로 표현한다.
- 파일명은 kebab-case, 타입은 PascalCase, 함수와 변수는 camelCase를 사용한다.
- 함수는 한 책임을 가지며 50줄 미만, 파일은 800줄 미만을 유지한다.
- 시간은 ISO 8601 datetime, 기간은 minutes, 거리는 km, 점수는 0부터 1 사이로 표현한다.
- 실제 이름, 주소, 연락처, 건강 정보는 코드와 fixture에 넣지 않는다.

## 계약 원본

`packages/contracts`는 다음 스키마의 유일한 원본이다.

- `InitialRequest`
- `Task`
- `SafetyDecision`
- `Candidate`
- `AgentEvent`
- `RawToolEvent`
- `FinalResult`
- A와 B 사이의 도구 call/result envelope
- 세 대표 시나리오 fixture

다른 패키지는 `@30-minute-exchange/contracts`에서 import하고 동일한 이름의 interface나 enum을 다시 선언하지 않는다.

## 이벤트 규칙

- 이벤트 이름은 `task.created`, `safety.checked`와 같은 dot 형식만 사용한다.
- 이벤트는 append-only이며 `sequence` 오름차순으로 표시한다.
- `AgentEvent`는 화면 표시용 정규화 스트림이다.
- `RawToolEvent.raw`는 OpenAI payload를 이름 변경, 필터링, 요약, 장식하지 않고 그대로 보존한다.
- call/result는 같은 `toolCallId`를 사용한다.
- 알 수 없는 `AgentEvent`는 consumer가 `safeParse` 실패로 무시하고 UI를 유지한다.
- 거절, timeout, 후보 소진, 안전 차단, 부분 성공, 도구 실패에서는 다음 행동보다 `plan.updated`를 먼저 발행한다.
- `plan.updated.data.userInputRequired`는 항상 `false`다.

## A와 B의 도구 경계

| 도구              | 구현 책임              | 핵심 동작                                       |
| ----------------- | ---------------------- | ----------------------------------------------- |
| `check_safety`    | B                      | `Task`를 `SafetyDecision`으로 판정              |
| `find_candidates` | B                      | 빈 배열도 정상 결과로 반환하고 점수 근거를 포함 |
| `send_outreach`   | B simulator, A adapter | 고정 seed에서 수락·거절·timeout을 결정          |
| `confirm_match`   | A                      | 수락 후보를 멱등하게 확정                       |

모든 도구는 `runId`, `requestId`, `taskId`, `toolCallId`를 포함한다. 시스템 오류는 `ToolError`로, 후보 없음·거절·timeout 같은 비즈니스 결과는 정상 data로 반환한다.

## 변경 호환성

1. 기존 필드를 삭제하거나 이름을 바꾸지 않는다.
2. 먼저 optional 필드를 추가하고 소비자가 대응한 뒤 필수화한다.
3. 호환되지 않는 변경은 `schemaVersion`을 증가시킨다.
4. 변경자는 RED 계약 테스트, 구현, 세 JSON fixture 갱신을 한 변경 단위로 제출한다.
5. 계약 변경 후 A의 adapter typecheck와 C의 fixture parsing을 확인한다.

## 보안 경계

- `.env`와 모든 로컬 변형은 커밋하지 않고 `.env.example`에는 키 이름만 둔다.
- 서버는 시작 시 필요한 환경 변수를 검증하며 토큰, 전체 요청 본문, raw 이벤트를 일반 로그에 출력하지 않는다.
- API adapter는 스키마 검증 전에 요청 본문 크기를 제한하고, 실행별 이벤트 버퍼와 SSE 재연결 보관량에 상한을 둔다.
- `helpDescription`, `optionalNotes`, tool result는 신뢰할 수 없는 데이터이며 프롬프트나 시스템 명령으로 실행하지 않는다.
- C는 사용자 문구와 `RawToolEvent.raw`를 텍스트로만 렌더링하고 HTML로 주입하지 않는다.
- raw payload를 보존해야 하므로 실제 개인정보가 라이브 데모 입력에 들어오지 않도록 입력 화면과 런북에서 명시적으로 경고한다.
- 사용자에게는 일반 오류만 표시하고 세부 스택과 provider 오류는 서버 진단 로그에만 남긴다.

## 테스트와 통합 게이트

- RED → GREEN → IMPROVE 순서를 지킨다.
- 단위·계약·통합·E2E 전체에서 80% 이상 커버리지를 유지한다.
- G1: 계약 테스트와 세 fixture가 통과한다.
- G2: A가 B의 실제 함수를 변환 없이 호출한다.
- G3: 요청 하나가 API와 두 이벤트 스트림을 거쳐 완료된다.
- G4: 세 대표 시나리오와 두 화면의 라이브 리허설이 통과한다.
- 게이트가 실패하면 새 기능을 멈추고 해당 경계를 먼저 복구한다.

커밋 전에는 테스트, diff, 비밀정보, 시뮬레이션 표시와 `2026-08-01 14:00 Asia/Seoul` 이후의 커밋 시각을 확인한다. push, PR, 배포는 별도 승인 후 진행한다.
