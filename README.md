# Workflow OS - my-module

MY-MODULE은 계약 중심 Workflow OS 저장소다.
`requirements/requirements.yaml`을 입력 진실원으로 유지하면서, 저장소 변경은 Stage 단위가 아니라 Work Packet 사이클로 운영한다.

## 운영 모델

이 저장소의 기본 실행 단위는 Work Packet이다.

1. `memory/wp-queue.yaml`에서 다음 작업을 선택한다.
2. `memory/current-wp.yaml`에 목표, 범위, 검증, 롤백을 먼저 적는다.
3. 코드/문서/검증/상태를 한 사이클 안에서 함께 닫는다.
4. 결과를 `worklog/`와 `memory/`에 남긴다.

Stage A→B→C→D→E는 여전히 아키텍처 의미와 품질 판정 기준으로 유지된다.
다만 실행 방식은 "Stage 일괄 실행"이 아니라 "Stage 의미를 가진 Work Packet 반복"이다.

## 빠른 시작

### 1. 현재 상태 읽기

- `memory/checkpoint.yaml`
- `memory/wp-queue.yaml`
- `memory/current-state.yaml`
- `memory/current-wp.yaml`

### 2. 입력 진실원 확인

- `requirements/requirements.yaml`
- `requirements/constraints.yaml`

### 3. 검증 기준선 실행

```bash
npm run validate:requirements
npm run lint
```

## 현재 검증된 기반

- `task-management`, `billing` 도메인 계약과 구현이 존재한다.
- `test:contract`, `validate:composition`, `type-check`, `scan:dependencies`, `test:e2e-smoke` 기준선이 존재한다.
- `validate:requirements`는 더 이상 parse-only가 아니라 실제 구조/경로/quality gate 기준을 검증한다.
- `stage:a`~`stage:e`는 echo-only가 아니라 현재 상태를 읽는 dry-run executor다.
- GitHub Actions에는 `requirements-validation.yml`, `quality-gates.yml`, `release-evidence.yml`, `deployment-smoke.yml`이 존재한다.

## 현재 수동/잔여 영역

- 일부 자동화와 문서는 여전히 `memory/project/*`를 레거시 fallback 입력으로 참조한다.
- 배포 환경 smoke는 실행 가능한 runner, environment registry, provisioning policy, audit template 경로가 있지만, 원격 GitHub environment의 live audit evidence와 로그/ingress 확인은 아직 operator-collected다.
- 현재 root memory 기준의 알려진 low-severity runtime gap은 `KI-RUN-001` 하나다.

## 현재 운영 기준

- queue가 비어 있으면 `memory/current-wp.yaml`을 새 packet 정의로 교체한 뒤 시작한다.
- `npm run wp:next`와 `npm run wp:reconcile`이 현재 backlog truth surface다.
- release evidence는 자동화되어 있고, deployment smoke는 environment-bound on-demand workflow로 실행한다.
- remote deployment environment provisioning은 `master-shell/operations/deployment-environment-provisioning.yaml`과 generated audit template로 기준선을 관리한다.

## 저장소 구조

```text
my-module/
├── requirements/          # 입력 진실원과 제약
├── domains/               # 도메인 구현 및 계약
├── master-shell/          # 조합/레지스트리/플래그/관측성
├── scripts/               # 검증기와 생성기
├── docs/                  # reference / how-to / adr / explanation
├── memory/                # root session state + stage snapshots + legacy project memory
├── worklog/               # Work Packet evidence
├── artifacts/             # 생성된 품질/공급망 증적
└── .github/               # 거버넌스 파일
```

## 핵심 규칙

| 규칙 | 설명 |
|------|------|
| C001 | 모듈 간 직접 코드 참조 금지 |
| C002 | 도메인 코어는 UI/DB/프레임워크/네트워크를 모름 |
| C003 | 모든 모듈은 최소 1개의 public contract를 가진다 |
| C004 | 구조 판단은 ADR 또는 동등한 증적을 남긴다 |
| C005 | 품질 게이트 FAIL이면 완료 선언 불가 |

## 관련 문서

- `CLAUDE.md`
- `docs/reference/memory-schema.md`
- `docs/reference/quality-gates.md`
- `memory/current-state.yaml`
- `memory/wp-queue.yaml`
- `memory/checkpoint.yaml`
