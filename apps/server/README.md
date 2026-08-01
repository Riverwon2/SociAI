# Server

1번 담당자의 소유 영역이다.

- `openai/`: 실제 OpenAI 요청 해석과 태스크 분해
- `orchestration/`: 실행 계획, 상태 전이, 재계획
- `runs/`: 요청·태스크 실행 상태와 API
- `aggregation/`: 태스크별 결과와 최종 결과 집계

공용 타입은 `packages/contracts`에서만 가져오고, 안전·랭킹·시뮬레이션은 2번 담당 패키지를 호출한다.

서버는 런타임에서 `AgentEvent`와 `RawToolEvent`를 발행하지만, 이벤트 스키마와 전송 유틸은 `packages/event-stream`을 따른다. `RawToolEvent.raw`는 서버에서도 수정하지 않는다.
