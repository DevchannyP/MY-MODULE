# Workflow OS — Work Packet Operating Protocol

이 파일은 MY-MODULE 저장소의 기본 운영 프로토콜이다.
에이전트는 "거대한 할 일 목록"을 순차 실행하지 않고, Work Packet 사이클을 반복한다.

## 역할

나는 MY-MODULE 저장소의 설계·구현·검증을 끝까지 닫는 실행 에이전트다.
목표는 계약 중심 아키텍처를 유지하면서, 한 번에 하나의 Work Packet을 완료하는 것이다.

## 불변 원칙

1. `requirements/requirements.yaml`은 단일 입력 진실원이다.
2. Stage A→B→C→D→E 의미는 유지하되, 실행 단위는 항상 Work Packet이다.
3. 모듈 간 직접 코드 참조는 금지하고 계약 파일만 읽는다.
4. 도메인 코어는 UI/DB/프레임워크 지식을 가지지 않는다.
5. 품질 게이트 FAIL이면 완료로 선언하지 않는다.
6. 구조 판단은 ADR 또는 memory/worklog 증적 없이 지나가지 않는다.
7. 상태는 대화가 아니라 `memory/` 파일에 남긴다.

## 세션 시작 순서 (v2 — Context Budget Protocol)

**핵심 원칙: 세션 오픈 시 2개 파일만 읽는다. 나머지는 스케줄러가 안내한다.**

1. `memory/checkpoint.yaml` — tier_reads 전용 (이 파일만 읽으면 다음 단계를 안다)
2. `memory/current-wp.yaml` — 진행 중 WP 컨텍스트
3. `npm run wp:next` 실행 — DAG 스케줄러가 의존성 해소된 WP 목록 출력
4. `npm run wp:gaps` 실행 — 미구현 요구사항 gap 확인
5. 스케줄러 출력에서 최우선 WP 선택 → 해당 WP의 `context_budget.tier_reads`만 추가 읽기
6. WP 실행 (7단계 사이클)
7. 세션 종료 전 `npm run wp:gaps --gen` 실행 → 신규 gap WP를 wp-queue.yaml에 추가

**금지사항:**
- `memory/wp-queue.yaml` 전체를 세션 시작 시 읽지 않는다 (스케줄러 출력으로 대체).
- WP의 `context_budget.skip_if_capability`에 있는 능력이 `current-state.yaml`에 이미 있으면 해당 파일을 읽지 않는다.
- WP `context_budget.context_reads`는 그 WP를 실제로 실행할 때만 읽는다.

`memory/project/*`는 레거시 호환 입력이다.
새 세션 계획과 handoff는 root `memory/*.yaml`을 기준으로 한다.

## Context Budget 규칙

각 WP의 `context_budget` 필드는 읽기 우선순위를 지정한다:

```yaml
context_budget:
  tier_reads:          # 이 WP 실행 전 반드시 읽는 파일 (최소 세트)
    - memory/checkpoint.yaml
    - memory/current-wp.yaml
  context_reads:       # 이 WP를 실행할 때만 읽는 파일 (지연 로딩)
    - requirements/requirements.yaml
  skip_if_capability:  # working_capabilities에 이미 있으면 읽기 건너뜀
    - quality-gate-ci
  estimated_turns: 3   # 대략적 에이전트 턴 수
  max_new_files: 4     # 이 WP에서 생성 가능한 최대 파일 수
  max_modified_files: 8 # 이 WP에서 수정 가능한 최대 파일 수
```

**에이전트는 `context_reads` 파일을 WP 실행 중 필요할 때만 읽어야 한다.**
불필요한 선행 읽기는 컨텍스트 창을 낭비하고 토큰 효율을 저하시킨다.

## DAG WP 스케줄러 명령

```
npm run wp:next        # DAG 해소 후 즉시 실행 가능한 WP 목록 출력
npm run wp:status      # 전체 DAG 상태 (done/ready/blocked)
npm run wp:validate    # DAG 참조 무결성 검사 (CI에서도 실행)
npm run wp:gaps        # 미구현 requirements gap 보고서
npm run wp:gaps:gen    # gap → skeleton WP YAML 자동 생성
npm run wp:health      # DORA 기반 세션 건강 지표
npm run wp:health:trend # 세션별 추세 분석
```

`계속` 입력 시: `npm run wp:next` 출력에서 최상위 WP를 선택한다.
직접 WP ID를 지정하는 방식은 스케줄러 없이 의존성을 무시할 수 있으므로 지양한다.

## Self-Healing State (desired_state 조정)

`memory/current-state.yaml`의 `desired_state`는 달성해야 할 capability 목록이다.
세션 시작 시 `npm run wp:gaps` 가 이를 읽어 미달성 항목을 gap으로 보고한다.

새로운 요구사항이 생기면:
1. `desired_state`에 새 capability_id와 설명을 추가한다.
2. 다음 세션에서 `npm run wp:gaps --gen` 이 자동으로 WP 스켈레톤을 생성한다.
3. 생성된 WP를 `wp-queue.yaml`의 적절한 capability 그룹에 추가한다.

이 루프가 "자기개선 사이클"이다. 사람이 WP를 수작업으로 발명할 필요가 없어진다.

## Work Packet 사이클

각 Work Packet은 아래 7단계를 정확히 따른다.

### 1. Define

- `goal`은 한 문장이어야 한다.
- `done_when`은 2~3개의 관측 가능한 조건이어야 한다.
- `scope_out`, `fail_if`, `rollback`을 먼저 적는다.

### 2. Decompose

- 깊이는 3레벨 이하로 제한한다.
- 하위작업은 최대 7개다.
- 순서는 `read → modify → wire → validate → document → evidence → state`를 따른다.

### 3. Contract

- 입력 계약: 읽어야 하는 파일과 기대 구조
- 구조 계약: 디렉터리/네이밍/아키텍처 규칙
- 런타임 계약: 변경 후에도 살아 있어야 하는 명령
- 증적 계약: 남겨야 하는 YAML/ADR/worklog

입력 계약이 깨져 있으면 현재 WP를 중단하고 선행 WP로 분리한다.

### 4. Execute

각 하위작업은 다음 순서로 진행한다.

1. 관련 파일을 끝까지 읽는다.
2. 영향 반경을 확인한다.
3. 최소 변경을 적용한다.
4. 참조를 연결한다.
5. 가장 빠른 관련 검증을 실행한다.

### 5. Validate

세 층으로 검증한다.

- Layer 1: 구문/스키마
- Layer 2: 계약/구성
- Layer 3: 시나리오/상태

Layer 1 또는 Layer 2가 실패하면 Work Packet은 완료가 아니다.

### 6. Evidence

모든 Work Packet은 `worklog/YYYY-MM-DD_WP-NN.yaml`을 남긴다.

필수 항목:

- `wp_id`
- `goal`
- `completed`
- `files_created`
- `files_modified`
- `validation`
- `risks`
- `decisions`

### 7. State Update

각 Work Packet 종료 시 아래를 갱신한다.

- `memory/current-state.yaml`
- `memory/wp-queue.yaml`
- `memory/current-wp.yaml`
- 필요 시 `memory/next-actions.yaml`
- 세션 종료 시 `memory/checkpoint.yaml`

## Work Packet 타입

- `policy`: requirements, schema, validator, repo-wide rules
- `domain`: 하나의 도메인 내부 변경
- `shell`: master-shell, registry, navigation, flags
- `executor`: stage runner, status CLI, dry-run, orchestrator
- `governance`: CI, PR template, CODEOWNERS, enforcement docs

타입별 제약:

- `policy`: validator 업데이트와 실제 검증을 반드시 포함한다.
- `domain`: 하나의 도메인만 수정한다.
- `shell`: `validate:composition` 같은 조합 검증을 포함한다.
- `executor`: 구조화된 출력과 `--dry-run`을 우선한다.
- `governance`: 참조하는 스크립트가 실제 존재해야 한다.

## 중단 규칙

다음 중 하나면 현재 WP를 partial로 닫고 새 WP를 만든다.

- 8개 초과 파일 생성
- 12개 초과 파일 수정
- scope 밖 수정이 필요해짐
- 선행 조건이 깨져 새로운 WP가 필요함
- 현재 턴 용량의 약 30%를 한 WP에 사용함

## 사용자 입력 해석

- `계속`: `memory/wp-queue.yaml`의 최고 우선순위 pending WP를 선택한다.
- Stage 관련 요청: 해당 Stage 의미를 가진 WP로 분해해서 처리한다.
- 검토/보고 요청: root `memory/`와 관련 증적을 읽고 답한다.

직접 Stage A~E를 일괄 실행하는 방식은 레거시다.
항상 Work Packet으로 정의한 뒤 진행한다.

## 검증 기준선

변경 종류에 따라 가능한 범위에서 아래 명령을 사용한다.

- `npm run validate:requirements`
- `npm run test:contract`
- `npm run validate:composition`
- `npm run lint`
- `npm test`
- `npm run test:e2e-smoke`
- `npm run check:observability`
- `npm run test:rollback`
- `npm run wp:validate`         ← v2 추가: DAG 참조 무결성 (WP queue 변경 후 필수)
- `npm run wp:gaps`             ← v2 추가: requirements gap (세션 종료 전 항상 실행)

## 종료 보고

세션 종료 시 아래 순서로 정리한다.

1. `memory/checkpoint.yaml` 갱신
2. 완료/부분 완료/미시작 WP 구분
3. 검증 명령과 결과 기록
4. 다음 세션 시작 순서와 첫 WP 지정

모든 결과는 "코드 + 검증 + 문서 + 상태"가 함께 닫혀야 한다.
