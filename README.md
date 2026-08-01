# 30분 교환소

한 번의 자연어 요청을 안전한 지역 생활지원 태스크로 분해하고, 결정론적 정책과 이웃 응답 시뮬레이터를 호출해 최종 결과까지 수행하는 로컬 돌봄 운영 에이전트입니다.

## 병렬 개발 시작점

- A는 `apps/server`에서 오케스트레이션, OpenAI, 실행 상태, 도구 어댑터와 서버 이벤트 발행을 담당합니다.
- B는 `packages/decisions`, `packages/simulator`에서 안전·충분성·랭킹과 결정론적 시뮬레이션을 담당합니다.
- C는 `packages/contracts`, `packages/event-stream`, `apps/web`, `tests/e2e`에서 공용 계약, 이벤트 전송 유틸, UI와 데모를 담당합니다.
- 모든 영역은 `@30-minute-exchange/contracts`만 공유 타입의 원본으로 사용합니다.

공통 규약은 [협업 계약](docs/engineering/collaboration-contract.md), 공개 스키마와 fixture 사용법은 [contracts README](packages/contracts/README.md)를 참고합니다.

## 공통 명령

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm test:e2e
pnpm verify
```

## 프론트엔드 데모

```bash
pnpm --filter @30-minute-exchange/web dev
```

- 주 화면은 `/`에서 one-shot 요청, 작업 상태, 후보 점수, 계획 갱신과 최종 결과를 표시합니다.
- raw 전용 두 번째 화면은 `/raw`이며 주 화면의 **Raw 이벤트 화면** 버튼으로 엽니다.
- 서버가 연결되기 전 fixture replay에서는 가짜 OpenAI raw payload를 만들지 않습니다.
- 브라우저 live adapter는 `POST /api/runs`와 응답에 포함된 두 SSE URL을 사용하며 정규화 이벤트와 raw 이벤트를 별도로 소비합니다. 서버 route가 아직 없으면 시작 오류를 안전하게 표시합니다.

현재 3번 영역의 상세 사용법은 [웹 README](apps/web/README.md), 실시간 이벤트 소비 규칙은 [event-stream README](packages/event-stream/README.md), 발표 순서는 [라이브 데모 런북](docs/demo/live-demo-runbook.md)을 참고합니다.

라이브 OpenAI 경로를 구현할 때 루트 `.env`에 `OPENAI_API_KEY`와 필요한 모델 설정을 입력합니다. `.env`는 커밋하지 않습니다.

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=
```
