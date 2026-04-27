# Git 거버넌스 기준

이 문서는 Workflow OS 코어 저장소가 GitHub와 연결될 때 지켜야 할 최소 기준을 설명한다.

## 1. 왜 필요한가

이 저장소는 단순 앱이 아니라 "도메인 생성·조합·검증 코어"다.
그래서 코드만 맞다고 끝나지 않는다.
아래 네 가지가 항상 같이 움직여야 한다.

1. 코드
2. 계약
3. memory
4. worklog / release evidence

Git 거버넌스는 이 네 가지를 같은 타이밍에 묶어 주는 규칙이다.

## 2. 기본 규칙

### 브랜치

- 기준 안정 브랜치: `main`
- 다음 통합 기준선: `develop`
- 작업 브랜치: `feature/*`, `fix/*`, `bugfix/*`, `hotfix/*`, `release/*`, `recovery/*`, `sandbox/*`
- 저장소 권장 패턴: `feature/core-*`, `fix/core-*`, `docs/core-*`, `chore/core-*`

### 커밋

- 작은 단위로 자주 커밋한다.
- 커밋 메시지는 "왜 바꿨는지"가 보여야 한다.
- 커밋 예:
  - `feat(core): add release evidence generator`
  - `docs(vcs): add branch strategy and pr checklist`

### PR

PR에는 아래 내용이 빠지면 안 된다.

1. 변경 이유
2. 수정 파일
3. 검증 명령
4. memory/worklog 동기화 여부
5. 위험과 rollback 포인트
6. branch protection required checks 충족 여부
7. root memory 기준면 반영 여부

## 3. 작업 단위 커밋이 중요한 이유

초등학생 버전으로 설명하면 이렇다.

- 큰 상자에 모든 장난감을 한 번에 넣으면 나중에 찾기 어렵다.
- 장난감을 종류별로 나눠 담으면, 망가진 장난감이 어느 상자에 있는지 바로 찾을 수 있다.

Git 커밋도 같다.

- 커밋 1개 = 설명 가능한 작은 상자
- PR 1개 = 상자 여러 개를 묶은 배송
- `main` = 검수 끝난 창고

## 4. 코어 저장소 전용 체크리스트

- 코드만 바꾸지 않았는가
- contract가 같이 맞춰졌는가
- root current-state / next-actions / current-wp가 업데이트됐는가
- 레거시 `memory/project/*`는 정말 필요한 경우에만 보조 갱신했는가
- worklog에 이유와 검증이 남았는가
- release evidence를 생성했는가
- branch protection required checks 목록이 최신인가

## 5. 권장 흐름

1. `npm run operator:cockpit`으로 현재 packet, 브랜치, 커밋 readiness를 먼저 읽는다.
2. `main` 또는 `develop`에서 새 작업 브랜치를 만든다.
3. 작은 작업 단위로 수정한다.
4. `npm run commit:guard` 또는 `npm run commit:guard:verify`로 커밋 가능 상태를 먼저 확인한다.
5. 각 의미 단위마다 커밋한다.
4. 검증을 돌린다.
5. release evidence를 만든다.
6. PR을 생성한다.
7. 리뷰 후 `develop` 또는 `main`에 병합한다.
