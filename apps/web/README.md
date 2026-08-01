# `@30-minute-exchange/web`

30분 교환소의 one-shot 요청, 실행 타임라인, 작업·후보 상태, 최종 결과와 raw 전용 두 번째 화면을 제공한다.

## 로컬 실행

```bash
pnpm --filter @30-minute-exchange/contracts build
pnpm --filter @30-minute-exchange/event-stream build
pnpm --filter @30-minute-exchange/web dev
```

fixture replay는 세 공용 JSON fixture에서 계약-valid `AgentEvent`를 생성해 화면을 검증한다. replay raw 이벤트는 만들지 않으며 `/raw`에는 명확한 비활성 안내가 표시된다.

## Live 연결 경계

`src/live/live-run-session.ts`의 `LiveRunTransport`가 서버별 adapter 경계다. 프론트의 나머지 코드는 주소나 서버 프레임워크를 알지 않는다.

`src/live/browser-live-run-transport.ts`는 확정된 브라우저용 HTTP/SSE 구현이다. `POST /api/runs`가 반환한 `202 Accepted` 본문을 `RunAcceptedResponseSchema`로 검증한 뒤 응답의 `agentEventsUrl`과 `rawToolEventsUrl`을 그대로 사용한다. 정규화 스트림은 `agent_event`, raw 스트림은 `raw_tool_event`라는 named SSE 이벤트만 소비한다.

서버 구현이 준비되면 다음을 adapter에 연결한다.

1. `InitialRequest`를 한 번 보내고 `schemaVersion`, `runId`, 동일한 `requestId`, `status: accepted`, 두 스트림 URL을 받는 시작 요청
2. `AgentEvent` 정규화 스트림
3. `RawToolEvent` raw 스트림
4. 각 스트림의 마지막 연속 `sequence` 이후 독립적인 재연결

두 번째 화면은 브라우저 `BroadcastChannel`을 통해 주 화면이 실제로 받은 raw 이벤트를 전달받는다. 늦게 열리면 같은 실행의 메모리 내 snapshot을 요청한다. localStorage에는 raw payload를 저장하지 않는다.

raw 원본은 브라우저 버퍼에서 보존하되 DOM에는 최근 200개 `toolCallId` 묶음만 표시한다. 이는 장시간 실행에서 화면이 멈추는 것을 막기 위한 렌더링 제한이며 payload 삭제·요약·필터링이 아니다.

진행 중인 live 실행은 새로고침 복구를 위해 `sessionStorage`에 실행 ID, 두 스트림 URL, 정규화 이벤트 이력과 두 스트림의 마지막 연속 `sequence`만 체크포인트로 남긴다. raw provider payload는 저장하지 않으며, 완료 또는 사용자의 새 요청 시작 시 체크포인트를 지운다. 복구 시 기존 실행 생성 API를 다시 호출하지 않고 각 URL에 스트림별 `afterSequence`를 넣어 다시 연다. 최초 연결은 `afterSequence=0`이다.

일시적인 네트워크 단절에서는 `EventSource`를 닫아 새로 만들지 않는다. 동일한 객체의 브라우저 기본 재연결을 사용해야 마지막 SSE `id`가 `Last-Event-ID` 헤더로 자동 전달된다. `request.completed` 뒤에도 raw 스트림에서 늦게 도착하는 이벤트를 자르지 않도록 두 연결은 새 요청, 명시적 초기화 또는 화면 종료 때 닫는다.

## 검증

```bash
pnpm --filter @30-minute-exchange/web test
pnpm --filter @30-minute-exchange/web test:coverage
pnpm --filter @30-minute-exchange/web typecheck
pnpm --filter @30-minute-exchange/web build
pnpm test:e2e
```

E2E는 첫 후보 수락, 거절·timeout·재섭외, 혼합 위험 부분 성공, raw/replay 분리, 키보드 순서와 심각한 자동 접근성 위반을 검사한다.
