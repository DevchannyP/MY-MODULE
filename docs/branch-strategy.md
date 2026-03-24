# Branch Strategy

이 문서는 이 저장소에서 실제로 운영 가능한 보수적 브랜치 전략을 정의한다.
목표는 세 가지다.

1. `main`을 항상 기준 안정 상태로 유지한다.
2. 오류 수정과 기능 개발을 분리해 추적 가능하게 만든다.
3. 레거시 성격의 코어 저장소에서 큰 충돌과 무근거 병합을 줄인다.

## 1. 브랜치 역할

- `main`
  배포 가능 또는 기준 안정 상태만 둔다.
  직접 push 금지, PR 병합만 허용한다.
- `develop`
  다음 통합 기준선이다.
  여러 `feature/*`, `fix/*`를 모아 사전 검증한다.
  팀 운영이 안정되기 전까지는 direct push 금지 또는 제한된 maintainer만 허용한다.
- `feature/*`
  일반 기능 개선, planner surface 개선, 비차단성 구조 보강에 사용한다.
- `fix/*`, `bugfix/*`
  저장/조회/실행/검증 오류처럼 실제 결함 수정에 사용한다.
- `hotfix/*`
  이미 안정 기준선으로 본 `main`에 긴급 반영해야 하는 결함 수정에 사용한다.
- `release/*`
  배포 직전 문서, 증적, 버전, 환경 점검만 수행하는 안정화 브랜치다.
- `recovery/*`
  롤백, 복구 스크립트, 긴급 복원 작업을 분리할 때 사용한다.
- `sandbox/*`
  고위험 실험, 탐색, 검증용이다. 안정 브랜치로 직접 병합하지 않는다.

## 2. 왜 이 저장소에 맞는가

- 이 저장소는 앱 한 개가 아니라 코어 조합기, planner, 계약, memory, evidence가 함께 움직인다.
- 기능 추가보다 "기준선 유지"가 더 중요하므로 `main`과 `develop`을 분리하는 편이 안전하다.
- 오류 수정은 기능 개발과 섞이면 원인 추적이 어려워지므로 `fix/*` 계열로 분리하는 것이 적합하다.
- `sandbox/*`와 `recovery/*`를 별도 계층으로 두면 실험과 복구가 운영 브랜치를 오염시키지 않는다.

## 3. 브랜치 이름 규칙

권장 패턴:

```text
feature/core-<short-topic>
fix/core-<short-topic>
bugfix/core-<short-topic>
hotfix/core-<short-topic>
release/<yyyy-mm-dd>-<short-topic>
recovery/<yyyy-mm-dd>-<short-topic>
sandbox/<short-topic>
```

예시:

```text
fix/core-project-status-context-budget
feature/core-planner-first-screen
release/2026-03-25-governance-baseline
```

Work Packet을 같이 드러내고 싶으면 브랜치명보다 커밋, PR 제목, worklog에서 남기는 방식을 우선한다.

## 4. 작업 흐름

1. `main` 또는 `develop` 최신 상태에서 새 작업 브랜치를 만든다.
2. 한 브랜치에는 하나의 설명 가능한 목적만 담는다.
3. 코드, contract, memory, docs 영향을 함께 확인한다.
4. 기준 검증을 통과시킨다.
5. 원격 브랜치로 push 한다.
6. PR에서 변경 이유, 영향 범위, 검증 결과, rollback 포인트를 설명한다.
7. 리뷰와 required checks 통과 후 병합한다.

## 5. 병합 기준

- `main` 병합 기준
  - 기준 검증 통과
  - 최소 1인 리뷰
  - rollback 설명 가능
  - release evidence 필요 시 생성
- `develop` 병합 기준
  - lint, contract, requirements, composition, 핵심 테스트 통과
  - 다른 기능 브랜치와 충돌 가능성이 낮음
  - 다음 통합 기준선으로 유지 가능

## 6. 직접 push 가능 범위

- `main`
  직접 push 금지
- `develop`
  기본은 PR-only
  예외적으로 운영 책임자 1인만 제한 허용 가능
- `feature/*`, `fix/*`, `bugfix/*`, `hotfix/*`, `release/*`, `recovery/*`, `sandbox/*`
  작성자 push 가능
  단, 보호 브랜치가 아니어도 PR 없이 `main`으로 바로 병합하지 않는다

## 7. PR 기준

PR에는 아래 네 가지가 반드시 있어야 한다.

1. 왜 바꾸는가
2. 어떤 파일과 흐름이 바뀌는가
3. 어떤 검증을 통과했는가
4. 위험과 rollback 방법은 무엇인가

문서만 바꿔도, 코드와 문서의 불일치가 해소되는지 설명해야 한다.

## 8. 충돌 위험을 줄이는 운영 방식

- 기능 브랜치보다 작은 `fix/*` 단위로 자주 나눈다.
- 한 PR에 unrelated generated artifacts를 섞지 않는다.
- root `memory/*.yaml`을 먼저 맞추고, 레거시 `memory/project/*`는 필요 시만 갱신한다.
- 장시간 열린 브랜치는 병합 전에 `main` 또는 `develop` 기준으로 재검증한다.
- 대규모 구조개편은 `sandbox/*`에서 먼저 검증한다.

## 9. 보수적 운영 포인트

- 레거시 호환 계층이 있으므로 "안 쓰는 것 같음" 수준의 삭제는 금지한다.
- CRUD 차단 오류, 계약 드리프트, planner/status truth surface 오류를 우선한다.
- 브랜치 전략은 속도보다 설명 가능성과 복구 가능성을 우선한다.
