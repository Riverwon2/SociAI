# Event Stream

3번 담당자의 A+C 통합 영역이다.

- `agent-events/`: 주 화면용 정규화 이벤트
- `raw-tool-events/`: 실제 OpenAI SDK payload 무변형 전달

두 스트림은 별도 계약과 전송 경로를 사용한다. 실행 메타데이터는 `RawToolEvent.raw` 밖에 둔다.

`apps/server`가 런타임 이벤트를 발행하고, 이 패키지는 공용 계약에 맞는 전송 유틸과 raw 보존 규칙을 제공한다.
