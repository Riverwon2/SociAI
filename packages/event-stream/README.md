# `@30-minute-exchange/event-stream`

정규화된 `AgentEvent`와 실제 OpenAI `RawToolEvent`를 서로 분리해 소비하는 순수 TypeScript 유틸이다. React나 서버 패키지에 의존하지 않는다.

## 책임

- Zod 계약을 통과한 이벤트만 known 이벤트로 수용
- 미래의 알 수 없는 정규화 이벤트를 안전한 unknown 항목으로 보존
- `sequence` 기준 정렬, eventId/sequence 중복 제거와 충돌 격리
- sequence gap과 마지막 연속 sequence 계산
- raw payload 내용의 무변형 보존
- `toolCallId`별 call/result 상관관계 계산
- 재연결 주소에 마지막 `sequence` 추가
- 계약-valid replay의 순차 재생

## 기본 사용

```ts
import {
  appendNormalizedEvent,
  createNormalizedEventBuffer
} from '@30-minute-exchange/event-stream'

let buffer = createNormalizedEventBuffer({ runId: 'run_001' })
buffer = appendNormalizedEvent(buffer, untrustedSsePayload)

const nextSequenceToResumeAfter = buffer.resumeAfterSequence
```

`latestSequence`가 아니라 `resumeAfterSequence`를 재연결 기준으로 사용한다. 예를 들어 1번과 3번 이벤트만 도착했다면 3번을 표시할 수는 있지만, 2번을 다시 받아야 하므로 재개 기준은 1이다.

## Raw 이벤트

`appendRawToolEvent`는 envelope를 검증하고 `raw` 값을 변경하지 않는다. `correlateRawToolEvents`는 같은 `toolCallId`의 이벤트를 `complete`, `waiting_for_result`, `orphan_result`로 묶는다. 일반 이벤트와 raw 이벤트는 서로 다른 버퍼와 SSE 연결을 사용한다.

## 재연결 방식

`buildResumeUrl`은 최초 연결에도 `afterSequence=0`을 넣고, 새로고침 복구에는 마지막 연속 `sequence`를 넣는다. 정규화/raw 스트림은 각자의 값을 사용한다.

일시 단절에서는 연결을 다시 만들지 않고 동일한 브라우저 `EventSource`의 기본 재연결을 유지한다. 서버가 보낸 SSE `id`는 브라우저가 `Last-Event-ID`로 자동 전달한다. 반면 화면 새로고침은 새로운 `EventSource`이므로 session 체크포인트에서 복원한 `resumeAfterSequence`를 query로 보낸다.
