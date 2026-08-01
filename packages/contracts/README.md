# `@30-minute-exchange/contracts`

A/B/C가 공유하는 Zod 런타임 스키마와 `z.infer` 타입의 단일 원본이다.

## 사용

```ts
import {
  InitialRequestSchema,
  type InitialRequest,
  parseAgentEventSafely
} from '@30-minute-exchange/contracts'

const request: InitialRequest = InitialRequestSchema.parse(untrustedInput)
const event = parseAgentEventSafely(untrustedEvent)
```

- producer는 전송 전에 `parse`로 출력 계약을 검증한다.
- consumer는 외부 입력에 `safeParse`를 사용해 오류를 명시적으로 처리한다.
- raw 이벤트의 `raw` 값에는 변환을 적용하지 않는다.
- 후보 응답 정책은 `Candidate`에 넣지 않고 scenario fixture의 `responseSequence`에 둔다.

## 예제 fixture

- `examples/first-candidate-accepts.json`
- `examples/reject-timeout-accept.json`
- `examples/mixed-risk-partial-match.json`

세 fixture는 A의 오케스트레이터 테스트, B의 결정론 테스트, C의 UI fixture와 E2E에서 동일하게 사용한다.

`expectedRawToolCorrelations`는 call/result 순서와 `toolCallId`만 정의한다. 실제 `RawToolEvent.raw` replay fixture는 A가 공식 SDK의 라이브 실행에서 캡처한 payload만 추가하며, 계약을 맞추기 위한 가짜 provider payload를 만들지 않는다.
