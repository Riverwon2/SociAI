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
pnpm verify
```

라이브 OpenAI 경로를 구현할 때 루트 `.env`에 `OPENAI_API_KEY`와 필요한 모델 설정을 입력합니다. `.env`는 커밋하지 않습니다.

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=
```
