# 30분 교환소

한 번의 자연어 요청을 안전한 지역 생활지원 태스크로 분해하고, 결정론적 정책과 이웃 응답 시뮬레이터를 호출해 최종 결과까지 수행하는 로컬 돌봄 운영 에이전트입니다.

## 병렬 개발 시작점

- A는 `apps/api`에서 오케스트레이션, OpenAI, 실행 상태, 도구 어댑터와 이벤트 전송을 담당합니다.
- B는 `packages/contracts`, `packages/decision-engine`, `packages/demo-data`를 담당합니다.
- C는 `apps/web`, `tests/e2e`, 데모 화면을 담당합니다.
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
```

라이브 OpenAI 경로를 구현할 때만 `.env.example`을 복사해 로컬 `.env`를 만들고 실제 키를 설정합니다. `.env`는 커밋하지 않습니다.
