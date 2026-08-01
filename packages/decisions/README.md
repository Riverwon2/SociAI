# Decisions

2번 담당자의 결정론적 판단 영역이다.

- `safety/`: 태스크별 안전 수준과 행동
- `sufficiency/`: 정보 충분성 판정
- `ranking/`: 후보 필터와 40/25/20/15 점수
- `policies/`: fallback과 최대 3명 재시도

서버나 프론트엔드에 의존하지 않는 순수 함수로 구현한다.
