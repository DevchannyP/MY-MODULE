# Workflow OS — 프롬프트 하네스 완전 분석 & 최고 품질 개선 계획

> 작성일: 2026-04-19 | 하네스 버전: v0.2.0 → v0.3.0 목표  
> 대상 독자: 오케스트레이터, 운영자, 에이전트 자신  
> 이 문서는 저장소 전체를 스캔한 뒤 도출한 단일 진실원이다.

---

## 목차

1. [저장소 전체 지도](#1-저장소-전체-지도)
2. [아키텍처 핵심 개념 사전](#2-아키텍처-핵심-개념-사전)
3. [구성요소 심층 해부](#3-구성요소-심층-해부)
   - 3.1 프롬프트 하네스 시스템
   - 3.2 Stage A~E 생명주기
   - 3.3 Work Packet DAG
   - 3.4 계약 주도 아키텍처
   - 3.5 도메인 구현 패턴
   - 3.6 Master Shell
   - 3.7 서버 배선
   - 3.8 이벤트 버스 & 아웃박스
   - 3.9 테스트 피라미드
   - 3.10 메모리 계층 (L0/L1/L2)
   - 3.11 스크립트 생태계
   - 3.12 CI/CD & 공급망 보안
4. [현재 상태 종합 점수표](#4-현재-상태-종합-점수표)
5. [하네스 성능 병목 진단](#5-하네스-성능-병목-진단)
6. [개선 계획 — 우선순위별](#6-개선-계획--우선순위별)
   - 6.1 P0 — 즉시 수정 (세션 0비용 손실)
   - 6.2 P1 — 단기 강화 (v0.2.1)
   - 6.3 P2 — 중기 혁신 (v0.3.0)
   - 6.4 P3 — 장기 고도화 (v1.0.0)
7. [실행 로드맵 & 작업 패킷 목록](#7-실행-로드맵--작업-패킷-목록)
8. [검증 기준 (개선 완료 조건)](#8-검증-기준-개선-완료-조건)

---

## 1. 저장소 전체 지도

```
my-module/                              # Workflow OS 코어 플랫폼 루트
│
├── CLAUDE.md                           # 에이전트 운영 프로토콜 v3.0 (10원칙 + Stage 모델 + 위임 규칙)
├── README.md                           # 프로젝트 개요
├── package.json                        # 133개 npm 스크립트 (test/validate/generate/wp:* 등)
│
├── requirements/                       # 단일 입력 진실원 (requirements/*.yaml)
│   ├── requirements.yaml               # 메인 모듈 정의 (Stage A-E 생명주기 명세)
│   ├── harness-engineering.yaml        # AI 하네스 v0.2.0 명세 (FR-001~042 + NFR 확장)
│   ├── constraints.yaml                # 전역 제약 및 전제 조건
│   ├── nfr.yaml                        # 비기능 요구사항 (성능, 보안, 가용성)
│   ├── glossary.yaml                   # 유비쿼터스 언어 사전
│   ├── billing.yaml                    # 청구 도메인 요구사항
│   ├── video.yaml                      # 비디오 도메인 요구사항
│   ├── domain-map.yaml                 # 도메인 간 의존 관계 지도
│   └── validation-profiles.yaml        # 패킷 유형별 검증 레시피
│
├── contracts/                          # 중앙 인터페이스 계약 허브
│   ├── events/
│   │   ├── registry.yaml              # 중앙 이벤트 카탈로그 (AsyncAPI 패턴, 8개 이벤트)
│   │   └── envelope.schema.json       # CloudEvents 표준 래퍼
│   ├── system-api/
│   │   ├── capability.yaml            # 8개 시스템 역량 (health, flags, catalog, audit 등)
│   │   └── openapi.yaml
│   ├── harness/
│   │   └── provider-adapter.yaml      # AI 제공자 라우팅 계약 (KI-HARNESS-001)
│   └── ui-shell/                      # Master UI 표면 계약
│
├── domains/                            # 3개 Bounded Context 구현체
│   ├── productivity/task-tracking/     # 할일 관리 (CRUD + 상태 머신)
│   │   ├── contract/                  # capability.yaml, openapi.yaml, ui-contract.yaml, events.schema.json
│   │   ├── src/
│   │   │   ├── domain/               # Task 엔티티 + TaskStatus 값 객체 + TaskDomainService
│   │   │   ├── application/          # 5개 유스케이스 + TaskRepository 포트
│   │   │   ├── infrastructure/       # SQLite/InMemory/Postgres 어댑터 + OutboxPoller
│   │   │   └── interface/            # TaskController.js (5 HTTP 엔드포인트)
│   │   └── tests/                    # 8계층 테스트 (domain/app/infra/interface/integration/smoke/adversarial/property)
│   │
│   ├── billing/                        # 청구 (Invoice + Payment + Exception)
│   │   ├── contracts/                 # 3개 bounded context 계약
│   │   ├── src/                       # 동일 Clean Architecture 구조
│   │   └── tests/                     # 133/133 PASS
│   │
│   └── video/                          # 비디오 호스팅 + 트랜스코딩
│       ├── contract/
│       ├── src/
│       └── tests/
│
├── src/                                # 플랫폼 인프라 코어
│   ├── shared/                        # 도메인 간 공유 유틸리티
│   │   ├── EventBus.js               # 프로세스 전역 옵저버 버스 (Singleton)
│   │   ├── EventBusPublisher.js       # 도메인 이벤트 어댑터
│   │   ├── ProblemDetails.js          # RFC 7807 에러 응답
│   │   ├── RateLimiter.js            # 라우트별 속도 제한
│   │   ├── IdempotencyStore.js        # 요청 중복 제거
│   │   ├── QueryValidation.js         # 입력 스키마 검증
│   │   └── uiRuntimeContracts.js      # Master UI 런타임 계약 (최근 수정됨)
│   │
│   ├── infrastructure/
│   │   ├── FeatureFlagProvider.js     # flags.yaml 기반 피처 플래그 (OpenFeature 호환)
│   │   ├── HarnessRuntimeRouter.js    # AI 모델 티어 라우팅 (Frontier/Standard/Mini)
│   │   ├── ai/
│   │   │   ├── HarnessProviderAdapter.js    # Claude API 폴백 전략 (KI-HARNESS-001)
│   │   │   ├── NullHarnessProvider.js       # 제공자 미사용 스텁
│   │   │   └── OpenAIResponsesProvider.js   # OpenAI 호환 레이어
│   │   ├── SystemApiController.js     # System OS 엔드포인트
│   │   └── telemetry.js               # OpenTelemetry 계측 (최근 수정됨)
│   │
│   ├── server/
│   │   └── createServer.js            # HTTP 서버 배선 (~2000줄, 최근 수정됨)
│   │
│   ├── frontend/
│   │   └── renderDynamicUi.js         # Master UI 동적 HTML 생성
│   │
│   └── tests/
│       └── smoke/                     # 14개 서버 연결 검증 스모크 테스트 (최근 수정됨)
│
├── master-shell/                       # 조합 & 운영 플랫폼
│   ├── plugin-registry/registry.yaml  # 3개 플러그인 (task-management, billing, system-api)
│   ├── navigation/nav.yaml            # 메뉴 구조
│   ├── feature-flags/flags.yaml       # 런타임 토글 (safe-default: false)
│   ├── observability/config.yaml      # 대시보드 + 알림 정의
│   ├── operations/
│   │   ├── deployment-environments.yaml
│   │   ├── rollback-playbook.yaml
│   │   └── deployment-environment-provisioning.yaml
│   └── catalog/                       # 15개 카탈로그 파일
│
├── scripts/                            # 40개 이상 운영/코드생성 스크립트
│   ├── run_stage.js                   # Stage A-E 생명주기 드라이런 실행기
│   ├── orchestrate.js                 # DAG 기반 병렬 실행 계획기
│   ├── session_bootstrap.js           # 현재 상태 + 다음 액션 로드
│   ├── project_status.js              # 실시간 프로젝트 대시보드
│   ├── validate-contracts.js          # 계약 드리프트 감지
│   ├── architecture-fitness.js        # 경계 제약 검증기
│   ├── health-dashboard.js            # 게이트 통과율 + 변경 실패 메트릭
│   ├── branch_bootstrap.js            # Git 워크플로우 설정
│   ├── verified_auto_commit_guard.js  # 안전한 자동 커밋 (게이트 확인 후)
│   ├── operator_cockpit.js            # 운영자 조종 콘솔
│   ├── resolve_validation_profile.js  # 패킷 유형별 검증 프로파일 해석기
│   ├── planning_studio_api.py         # Planning Studio API (최근 수정됨)
│   ├── generate_release_evidence.py   # 릴리즈 증거 생성기 (최근 수정됨)
│   ├── generate-mindmap.js            # 마인드맵 생성 (최근 수정됨)
│   └── db-migrate.js                  # SQLite→Postgres 마이그레이션 러너
│
├── memory/                             # 3계층 지식 영속화
│   ├── L0-hot/                        # 세션 에페머럴 (현재 상태/다음 액션/실패 패턴)
│   ├── L1-warm/                       # Stage 스냅샷 (도메인별 A-E)
│   ├── L2-cold/                       # 레거시 폴백 (드물게 사용)
│   ├── project/                       # 크로스-세션 교훈, 리스크 레지스터
│   ├── reflections/                   # 도메인별 학습 로그 (Stage+Attempt 기반)
│   ├── checkpoint.yaml                # 운영자 인계 상태
│   ├── wp-queue.yaml                  # Work Packet DAG + 상태
│   ├── current-wp.yaml                # 활성 패킷 세부정보
│   └── knowledge-graph.yaml           # ADR/결정 교차 참조
│
├── worklog/                            # 실행된 Work Packet 증적
│   ├── reports/                       # 12개 완료 도메인 Stage 보고서
│   └── learning-reports/              # 패킷별 지식 합성
│
├── artifacts/                          # 생성된 산출물
│   ├── release-evidence/              # SBOM, 출처, 증거 JSON (최근 수정됨)
│   ├── promotion-pipeline/            # 컨텍스트 잠금, 패킷 계층 구조
│   ├── decision-apply/                # 180개 이상 히스토리 결정 + 컨텍스트
│   ├── evals/harness/                 # 제공자 호출 이력
│   ├── deployment-smoke/              # 환경 검증 결과
│   ├── mindmap/index.html             # 마인드맵 (최근 수정됨)
│   └── index.html                     # Master UI (5레인 칸반 + 나선형 시각화)
│
├── docs/                               # 아키텍처 & 운영 문서
│   ├── adr/                           # 13개 Architecture Decision Records
│   ├── explanation/                   # 장문 설명 (하네스 v-next, 조합 전략 등)
│   ├── how-to/                        # 반복 가능한 절차
│   ├── reference/                     # 데이터 사전, 검증 프로파일, 품질 게이트
│   ├── harness/
│   │   ├── CONTINUOUS_PROMPT.md       # 세션 재진입 프로토콜 (canonical)
│   │   └── HARNESS_MASTER_IMPROVEMENT_PLAN.md  ← 이 문서
│   ├── tutorial/
│   ├── db/                            # 마이그레이션 전략
│   ├── branch-strategy.md
│   ├── development-guide.md
│   ├── release-checklist.md
│   └── troubleshooting.md
│
├── templates/                          # 도메인 스캐폴딩 아키타입
├── security/                           # 보안 정책 + 레드팀 자료
├── data/                               # 픽스처 & 샘플 데이터
├── logs/                               # 런타임 로그
└── .github/workflows/                  # CI/CD (품질 게이트, 릴리즈 증거 등)
```

---

## 2. 아키텍처 핵심 개념 사전

| 용어 | 정의 | 위치 |
|------|------|------|
| **Bounded Context** | 단일 언어 + 단일 책임을 갖는 도메인 경계 | `domains/*/` |
| **계약(Contract)** | 도메인 간 유일한 공개 인터페이스 (capability, openapi, events) | `contracts/`, `domains/*/contract/` |
| **Port** | 유스케이스가 의존하는 추상 인터페이스 (Repository, EventPublisher) | `*/application/ports/` |
| **Adapter** | Port를 구현하는 인프라 구현체 (SQLite, InMemory, Postgres) | `*/infrastructure/` |
| **Invariant (INV-*)** | 도메인 불변 조건 — 위반 시 예외 발생 | `domains/*/src/domain/entities/` |
| **Work Packet (WP)** | DAG 기반 최소 실행 단위. depends_on으로 순서 결정 | `memory/wp-queue.yaml` |
| **Intake Packet** | 모든 요청을 6필드로 정규화한 구조 (goal/context/constraints/done_when/work_mode/verification) | `requirements/harness-engineering.yaml` |
| **Stage A~E** | 분석→설계→배선→구현→적대 검증의 5단계 생명주기 | `CLAUDE.md`, `scripts/run_stage.js` |
| **Memory L0/L1/L2** | 세션 에페머럴(hot)/Stage 스냅샷(warm)/아카이브(cold)의 3계층 | `memory/` |
| **Reflexion Loop** | 실패 즉시 발동하는 자기반성 + 학습 사이클 | `memory/reflections/` |
| **CoVe** | Chain-of-Verification: "이 테스트가 INV를 정말 검증하는가?" | `memory/stageD/*-cove.yaml` |
| **Dual-Observer** | Stage 완료 보고를 독립적으로 재검증하는 에이전트 | `CLAUDE.md § Dual-Observer` |
| **Feature Flag** | 런타임 토글 — safe-default:false, 플래그 off → 404 | `master-shell/feature-flags/flags.yaml` |
| **Outbox Pattern** | 이벤트 신뢰성: 유스케이스→OutboxRepository→OutboxPoller→외부 | `*/infrastructure/OutboxPoller.js` |
| **RFC 7807** | Problem Details JSON — 모든 에러 응답 표준 | `src/shared/ProblemDetails.js` |
| **CloudEvents** | 이벤트 봉투 표준 (type, source, id, version) | `contracts/events/envelope.schema.json` |
| **HarnessRuntimeRouter** | 모드별 AI 모델 티어 선택기 (Research→Frontier, Build→Mini) | `src/infrastructure/HarnessRuntimeRouter.js` |

---

## 3. 구성요소 심층 해부

### 3.1 프롬프트 하네스 시스템

하네스는 이 저장소의 핵심 혁신이다. 세션마다 긴 지시를 반복하지 않고 동일한 짧은 프롬프트로 정확한 실행을 보장하는 운영 계약이다.

#### 3.1.1 현재 하네스 아키텍처 (v0.2.0)

```
사용자 입력 ("계속" / 자유형식)
        │
        ▼
[CLAUDE.md 운영 프로토콜]  ←  [requirements/harness-engineering.yaml]
        │                              │
        │  운영 원칙 10가지              │  FR-001~042 + NFR 확장
        │  단일 키워드 실행표             │  Intake Packet 명세
        │  서브에이전트 위임 규칙         │  Mode Router
        │  자율 실행 vs 멈춤 규칙        │  보안 정책
        │
        ▼
[세션 부트스트랩]
  ├── memory/L0-hot/current-state.yaml  (현재 저장소 상태)
  ├── memory/L0-hot/next-actions.yaml   (우선순위 큐)
  ├── memory/L0-hot/failure-patterns.yaml (반복 실패 패턴)
  ├── memory/current-wp.yaml            (활성 Work Packet)
  └── memory/wp-queue.yaml              (전체 DAG)
        │
        ▼
[Intake Packet 재구성] — FR-001
  goal / context / constraints / done_when / work_mode / verification
        │
        ▼
[Mode Router] — HarnessRuntimeRouter.js
  Research → Frontier(Opus)
  Build    → Mini(Haiku)
  Debug    → Standard(Sonnet)
  Operate  → Mini(Haiku)
  Policy   → Frontier(Opus)
        │
        ▼
[서브에이전트 위임]
  Stage A/B → architect 에이전트
  Stage D   → implementer 에이전트
  Stage E   → adversary 에이전트
  B_review  → reviewer 에이전트 (Cross-Model: Opus)
  보고서     → reporter 에이전트
  완료 검증  → observer 에이전트
        │
        ▼
[검증 루프]
  lint → test → contract → smoke → CoVe → Dual-Observer
        │
        ▼
[Reflexion Loop] (실패 시)
  memory/reflections/[domain]-[stage]-[attempt].yaml
  → root_cause_category 분류
  → next_strategy 수립
  → 재시도 (최대 3회)
        │
        ▼
[완료 보고] — 종료 출력 형식 (CLAUDE.md)
  + verified_auto_commit_guard.js (게이트 통과 후 자동 커밋)
  + node scripts/audit-chain.js append
  + node scripts/record-metrics.js
```

#### 3.1.2 핵심 파일 상호 참조

| 파일 | 역할 | 관련 파일 |
|------|------|----------|
| `CLAUDE.md` | 에이전트 행동 헌법 | `requirements/harness-engineering.yaml` |
| `docs/harness/CONTINUOUS_PROMPT.md` | 세션 재진입 canonical | `memory/checkpoint.yaml`, `memory/current-wp.yaml` |
| `requirements/harness-engineering.yaml` | FR/NFR 명세 | `contracts/harness/provider-adapter.yaml` |
| `src/infrastructure/HarnessRuntimeRouter.js` | 런타임 모드 라우팅 | `src/infrastructure/ai/HarnessProviderAdapter.js` |
| `scripts/session_bootstrap.js` | 세션 상태 복구 | `memory/L0-hot/current-state.yaml` |
| `scripts/verified_auto_commit_guard.js` | 게이트 통과 후 커밋 | `scripts/resolve_validation_profile.js` |
| `scripts/resolve_validation_profile.js` | 패킷 유형별 검증 선택 | `requirements/validation-profiles.yaml` |

---

### 3.2 Stage A~E 생명주기

각 도메인은 5단계를 순서대로 통과한다. 게이트 FAIL이면 다음 Stage로 진입 불가.

```
Stage A: 분석 (Analyze)
  입력: requirements/[도메인].yaml
  출력: memory/stageA/[도메인].yaml
  내용: bounded_context, ubiquitous_language, invariants(INV-*),
        permissions, contracts, risk_level, state_machines
  담당: architect 에이전트 (ultrathink)

      ↓ Gate: 계약 4종 생성 확인

Stage B: 설계 (Compose)
  입력: Stage A 결과 + 조합 규칙
  출력: memory/stageB/[도메인].yaml
  내용: 도메인 모듈 통합 계획, 공유 라이브러리 사용, 포트 설계
  담당: architect 에이전트 (ultrathink)

      ↓ Gate: 충돌 검사 PASS

Stage C: 배선 (Configure)
  입력: Stage B + Master Shell
  출력: plugin-registry, navigation, feature-flags, observability
  내용: 플러그인 등록, 메뉴 연결, 플래그 바인딩
  담당: architect 에이전트 (normal)

      ↓ Gate: validate:composition PASS

Stage D: 구현 & 검증 (Develop & Verify)
  입력: 코드 + 테스트
  출력: 570+ 테스트 PASS, lint 0 에러, 계약 검증, smoke suite
  담당: implementer 에이전트 (normal)
  검증: unit + integration + contract + authz + smoke

      ↓ Gate: 모든 품질 게이트 PASS

Stage E: 적대 검증 (Adversarial Enforce)
  입력: Stage D 산출물
  출력: 40+ 적대 테스트 PASS, 보안 리뷰
  담당: adversary 에이전트 (ultrathink)
  검증: 엣지 케이스 + 인가 경계 + 상태 머신 위반

      ↓ Gate: 갭 0건 또는 모두 ADR 처리

B_review: 교차 모델 리뷰 (Cross-Model Review)
  담당: reviewer 에이전트 (Opus 모델)
  내용: 코드 리뷰 + 계약 영향 + semver 분류
```

**현재 상태**: 3개 도메인 모두 Stage A~E PASS. 570/570 테스트. ESLint 0 에러.

---

### 3.3 Work Packet DAG

```yaml
# memory/wp-queue.yaml 구조
- id: "WP-S19-002"
  title: "Billing: INV-B001 total 불일치 수정"
  stage: "D"
  domain: "billing"
  status: "done"          # pending → ready → in_progress → done
  depends_on: ["WP-S19-001"]
  blockers: []
  result: "PASS"
  evidence: "worklog/2026-03-25_WP-001.yaml"
```

**DAG 관리 스크립트**:

| 명령 | 기능 |
|------|------|
| `npm run wp:next` | depends_on 해소된 ready WP 반환 |
| `npm run wp:gaps` | requirements vs 구현 갭 보고 |
| `npm run wp:validate` | DAG 참조 무결성 검사 |
| `npm run wp:health` | DORA 메트릭 (게이트 통과율, CFR, WP/세션) |
| `npm run wp:reconcile` | 원하는 상태 vs 현재 역량 vs 큐 커버리지 비교 |

---

### 3.4 계약 주도 아키텍처

**핵심 원칙**: 도메인 간 직접 `src/` import 금지. `contracts/`만 참조.

**계약 5종**:

```
1. Capability Contract (capability.yaml)
   - id, name, type(command/query)
   - input_schema, output_schema
   - preconditions, postconditions
   - invariants(INV-*), permissions_required

2. OpenAPI Contract (openapi.yaml)
   - HTTP 엔드포인트, 요청/응답 본문
   - 에러 코드 (RFC 7807)

3. UI Contract (ui-contract.yaml)
   - Master Shell 화면 정의, 내비게이션 그룹

4. Event Registry (contracts/events/registry.yaml)
   - CloudEvents 봉투 + 도메인 이벤트 전체 카탈로그
   - produced_by 경로 추적 (드리프트 감지)

5. Provider Adapter Contract (contracts/harness/provider-adapter.yaml)
   - AI 제공자 선택 규칙 (Frontier/Standard/Mini)
   - 폴백 전략 (KI-HARNESS-001)
```

**드리프트 검증**: `npm run validate:contracts` — openapi vs 구현 vs 이벤트 레지스트리 vs produced_by 경로 교차 검사.

---

### 3.5 도메인 구현 패턴 (Clean Architecture)

```
domains/[도메인]/src/
├── domain/                  # 핵심 — 외부 의존성 ZERO
│   ├── entities/            # 불변 집계 루트 (create() → 새 인스턴스)
│   ├── value-objects/       # 불변 값 객체
│   └── services/            # 멀티-집계 비즈니스 규칙
│
├── application/             # 유스케이스 — 포트만 의존
│   ├── ports/               # Repository, EventPublisher 인터페이스
│   └── *UseCase.js          # 단일 책임 유스케이스
│
├── infrastructure/          # 어댑터 — 포트 구현체
│   ├── SQLite*Repository.js
│   ├── InMemory*Repository.js
│   ├── Postgres*Repository.js (Phase 2, stub)
│   ├── OutboxRepository.js
│   └── OutboxPoller.js
│
└── interface/               # HTTP 진입점
    └── *Controller.js       # x-permissions 파싱 + RFC 7807 에러
```

**불변 패턴 예시 (Task 엔티티)**:
```javascript
// BAD: 직접 변경
task.status = 'IN_PROGRESS';

// GOOD: 새 인스턴스 반환
const updatedTask = task.transitionTo('IN_PROGRESS');
// → 불변성 보장, 도메인 이벤트 자동 수집
```

---

### 3.6 Master Shell

```
master-shell/
├── plugin-registry/registry.yaml    # 플러그인 선언 (entry_point, capability_contract,
│                                    #   feature_flag, rollout 전략, rollback 전략)
├── navigation/nav.yaml              # 메뉴 구조 (productivity / billing / system)
├── feature-flags/flags.yaml         # 런타임 토글
│   enable_task_management: false    # Stage D→5%, E→20%, B_review→100%
│   billing.enabled: false
│   video.upload.enabled: false
├── observability/config.yaml        # 대시보드 + 알림 그룹
└── operations/
    ├── rollback-playbook.yaml       # 장애 복구 절차 (error_rate > 1% 트리거)
    └── deployment-environments.yaml # GitHub 환경 바인딩
```

**피처 플래그 라이프사이클**:
```
Stage D PASS → internal (5%)
Stage E PASS → beta (20%)
B_review PASS → full (100%)
장애 발생 → disable_flag / circuit-breaker
```

---

### 3.7 서버 배선 (createServer.js ~2000줄)

```
요청 수신
  ↓
헤더 파싱 (x-user-id, x-permissions, x-correlation-id, x-request-id)
  ↓
라우트 디스패치 (/tasks/*, /billing/*, /videos/*, /api/v1/system/*)
  ↓
피처 플래그 평가 (flag=false → 404)
  ↓
본문 파싱 (JSON, max 1MB, 5초 타임아웃)
  ↓
멱등성 검사 (x-idempotency-key 중복 제거)
  ↓
속도 제한 (라우트별 RateLimiter)
  ↓
유스케이스 실행 { caller: {userId, permissions}, idempotencyKey, requestId, span, ...input }
  ↓
EventBus 이벤트 발행 (OutboxPoller 트리거)
  ↓
응답: 200 + 데이터 + 추적 헤더 | RFC 7807 에러
  ↓
생명주기: SIGTERM/SIGINT → drain 모드 → 처리 중 요청 완료 후 종료
```

**DB 라우팅** (환경변수 기반):
- `DB_TYPE=sqlite` → SQLiteTaskRepository
- `DB_TYPE=postgres` → PostgresTaskRepository (Phase 2)
- `DB_TYPE=inmemory` → InMemoryTaskRepository (테스트)

---

### 3.8 이벤트 버스 & 아웃박스

```
유스케이스
  │  publish(event)
  ▼
EventBusPublisher (포트 구현체)
  │
  ▼
EventBus.getInstance() — 프로세스 전역 Singleton
  │  subscribe('com.workflow-os.task.*', handler)
  ▼
OutboxRepository.append(event)  ← DB 저장
  │
  ▼
OutboxPoller (백그라운드 태스크)  ← 주기적으로 draining
  │
  ▼
외부 시스템 / 다운스트림
```

**보장**: 적어도 1회 전달 (at-least-once). 서비스 크래시 후에도 아웃박스 DB에 남아 재전송.  
**현재 갭**: 아웃박스 테이블이 DB에 영속화되지 않음 (WP-S18-003에서 해결 예정).

---

### 3.9 테스트 피라미드

```
              ┌─────────────┐
              │  적대 테스트  │  40+ 벡터/도메인 (Stage E)
              │ property 테스트│  fast-check 기반
              ├─────────────┤
              │  smoke 테스트 │  14개 서버 배선 검증
              ├─────────────┤
              │  통합 테스트  │  유스케이스 → 저장소 → DB
              ├─────────────┤
              │  단위 테스트  │  200+ INV 불변 조건 검증
              └─────────────┘
                 171개 파일 / 570+ 테스트 케이스
```

**품질 게이트 전체 목록**:

| 게이트 | 명령 | 현재 |
|--------|------|------|
| 단위 + 통합 | `npm test` | 570/570 PASS |
| 계약 드리프트 | `npm run test:contract` | PASS |
| 인증/인가 회귀 | `npm run test:authn-authz` | 67/67 PASS |
| E2E 스모크 | `npm run test:e2e-smoke` | PASS |
| 속성 기반 | `npm run test:property` | PASS |
| ESLint | `npm run lint` | 0 에러 |
| 타입 검사 | `npm run type-check` | PASS |
| 시크릿 스캔 | `npm run scan:secrets` | PASS |
| 의존성 스캔 | `npm run scan:dependencies` | PASS |
| 계약 검증 | `npm run validate:contracts` | PASS |
| 아키텍처 피트니스 | `npm run validate:fitness` | C001/C002/C003 PASS |
| 조합 검증 | `npm run validate:composition` | PASS |
| Rollback 검증 | `npm run test:rollback` | PASS |
| Advisory 정책 | `npm run check:advisory-policy` | PASS |

---

### 3.10 메모리 계층 (L0/L1/L2)

```
memory/
├── L0-hot/                       # 매 세션 시작 시 반드시 읽는 파일들
│   ├── current-state.yaml        # 저장소 실시간 상태 (as_of 날짜 포함)
│   ├── next-actions.yaml         # 우선순위 큐 (priority 1이 다음 할 일)
│   ├── reflection-log.yaml       # 이전 실패 교훈
│   └── failure-patterns.yaml     # 반복 실패 패턴 (3회 → ADR 경고)
│
├── L1-warm/                      # Stage 별 도메인 스냅샷
│   └── stageA/[도메인].yaml      # Stage A 완료 시 freeze된 아키텍처 결정
│
├── L2-cold/                      # 아카이브 (rarely used)
│
├── project/                      # 크로스-세션 지식
│   ├── lessons-learned.yaml      # 교훈 축적소
│   ├── observer-alert.yaml       # Dual-Observer 불일치 경보
│   ├── risk-register.yaml        # 리스크 레지스터
│   └── core-upgrade-plan.yaml    # 플랫폼 강화 로드맵
│
├── reflections/                  # Reflexion Loop 산출물
│   └── [도메인]-[stage]-[N].yaml  # what_failed, root_cause, next_strategy
│
├── stageD/                       # CoVe 검증 결과
│   └── [도메인]-cove.yaml
│
├── checkpoint.yaml               # 운영자 인계 체크포인트
├── wp-queue.yaml                 # Work Packet DAG (전체)
├── current-wp.yaml               # 활성 Work Packet
├── current-state.yaml            # (루트) canonical 상태 진실원
└── knowledge-graph.yaml          # ADR/결정 교차 참조 그래프
```

**읽기 순서 (CLAUDE.md § 파일 읽기 순서)**:
1. `memory/L0-hot/current-state.yaml`
2. `memory/L0-hot/next-actions.yaml`
3. `memory/L0-hot/reflection-log.yaml`
4. `memory/L0-hot/failure-patterns.yaml`
5. `memory/project/lessons-learned.yaml`
6. `memory/reflections/[도메인]-*.yaml`
7. `memory/L1-warm/stageA/[도메인].yaml`
8. `requirements/[도메인].yaml`
9. `requirements/constraints.yaml`

---

### 3.11 스크립트 생태계 (40개+)

| 카테고리 | 스크립트 | 기능 |
|----------|---------|------|
| **세션 관리** | `session_bootstrap.js` | 현재 WP + 다음 액션 로드 |
| | `project_status.js` | 실시간 대시보드 |
| | `operator_cockpit.js` | 운영자 조종 콘솔 |
| **Stage 실행** | `run_stage.js` | Stage A-E 드라이런 |
| | `orchestrate.js` | DAG 기반 병렬 계획 |
| **검증** | `validate-contracts.js` | 계약 드리프트 |
| | `architecture-fitness.js` | 경계 제약 (C001/C002/C003) |
| | `resolve_validation_profile.js` | 패킷 유형별 검증 선택 |
| **형상관리** | `branch_bootstrap.js` | 브랜치 전략 자동 제안 |
| | `verified_auto_commit_guard.js` | 게이트 통과 후 자동 커밋 |
| **메트릭** | `health-dashboard.js` | DORA 메트릭 (게이트 통과율, CFR) |
| | `record-metrics.js` | Stage 완료 메트릭 기록 |
| | `audit-chain.js` | SHA-256 해시 체인 감사 |
| **생성** | `generate-mindmap.js` | 마인드맵 HTML |
| | `generate-learning-report.js` | 학습 보고서 (기승전결) |
| | `generate-catalog.js` | 도메인 카탈로그 사이트 |
| | `generate_release_evidence.py` | SBOM + 출처 + 증거 |
| **DB** | `db-migrate.js` | SQLite→Postgres 마이그레이션 |
| **AI** | `planning_studio_api.py` | Planning Studio API |
| **WP** | `wp:next`, `wp:gaps`, `wp:validate`, `wp:health`, `wp:reconcile` | Work Packet DAG 관리 |

---

### 3.12 CI/CD & 공급망 보안

```
.github/workflows/
├── quality-gates.yml    # 품질 게이트 자동화 (lint + test + contract)
└── release-evidence.yml # SBOM + 출처 증거 생성

공급망 보안 레이어:
├── SBOM (SPDX 형식)      → artifacts/release-evidence/
├── Provenance (출처 증명) → artifacts/provenance/
├── Lockfile 기준선        → scan:dependencies
├── Advisory 정책         → check:advisory-policy
└── Branch Protection      → check:branch-protection-policy
```

---

## 4. 현재 상태 종합 점수표

### 4.1 역량별 성숙도

| 영역 | 점수 | 근거 |
|------|------|------|
| 도메인 설계 (Clean Architecture) | ★★★★★ | 3개 도메인 A~E PASS, INV 완전 검증 |
| 테스트 커버리지 | ★★★★☆ | 570+ 테스트, 단 Postgres/Video 영속성 없음 |
| 계약 주도 개발 | ★★★★★ | validate:contracts + architecture-fitness PASS |
| 보안 | ★★★★☆ | OWASP 커버, 단 KI-HARNESS-001 미해결 |
| 관찰가능성 | ★★★★☆ | OpenTelemetry + 구조화 로그, SSE 미연결 |
| 하네스 세션 연속성 | ★★★★☆ | 부트스트랩 + 메모리 있음, 상태 드리프트 간헐 |
| AI 제공자 통합 | ★★☆☆☆ | 어댑터 있음, 실제 연결 미검증 |
| UI/시각화 | ★★★☆☆ | 칸반+나선형 있음, 실시간 갱신 없음 |
| 데이터 영속성 | ★★★☆☆ | SQLite PASS, Postgres stub, Video 없음 |
| 공급망 보안 | ★★★★☆ | SBOM+출처+Advisory 있음, CI 연동 부분적 |
| **종합** | **★★★★☆** | **v0.2.0 안정, 알려진 갭 5개** |

---

## 5. 하네스 성능 병목 진단

현재 하네스가 최고 품질에 도달하지 못하는 근본 원인을 7가지로 분류한다.

### B-001: 세션 초기화 지연 — 메모리 읽기 중복

**증상**: 세션 시작 시 CLAUDE.md에서 9개 파일을 순서대로 읽도록 지시하지만, 실제로는 추가적으로 CONTINUOUS_PROMPT.md, checkpoint.yaml, current-wp.yaml까지 읽어서 12~15개 파일을 순차 읽기. 토큰 낭비 + 지연.

**근본 원인**: 두 개의 세션 시작 프로토콜(CLAUDE.md § 파일 읽기 순서 vs CONTINUOUS_PROMPT.md § 세션 시작 시 먼저 읽는 파일)이 서로 다른 순서를 정의. 에이전트가 둘 다 따르려다 중복 발생.

**영향**: 세션당 추가 토큰 비용. 시작 응답 지연.

---

### B-002: Intake Packet 검증 부재

**증상**: FR-001이 "모든 요청을 6필드로 재구성"을 지시하지만, 재구성된 Intake Packet의 구조적 유효성을 자동으로 검증하는 스크립트가 없다. 필드가 빠지거나 비어있어도 실행이 계속된다.

**근본 원인**: `contracts/harness/output.schema.json`(deliverable_contract.output_schema_ref가 가리키는 파일)이 존재하지 않거나 검증 로직이 없음.

**영향**: 모호한 요청이 재구성 없이 그대로 실행 → 실패 후 Reflexion Loop 트리거 → 불필요한 재시도.

---

### B-003: Mode Router 학습 없음

**증상**: `HarnessRuntimeRouter.js`가 Research→Frontier, Build→Mini로 고정 매핑한다. 과거 실행 결과(성공/실패율, 토큰 비용, 응답 품질)를 학습해 라우팅을 개선하는 피드백 루프가 없다.

**근본 원인**: `artifacts/evals/harness/`에 제공자 호출 이력이 축적되지만 이를 라우팅 최적화에 활용하는 로직이 없음.

**영향**: 비효율적인 모델 선택으로 토큰 비용 낭비 또는 품질 저하.

---

### B-004: Reflexion Loop 패턴 인식 미흡

**증상**: `memory/L0-hot/failure-patterns.yaml`에 반복 실패 패턴을 등록하지만, 같은 category 3회 반복 시 "ADR 필요 경고"만 출력한다. 자동으로 새로운 전략을 제안하거나 Work Packet을 생성하지 않는다.

**근본 원인**: 패턴 감지 후 대응 행동이 "경고 출력"으로 끝남. 자동화된 에스컬레이션 없음.

**영향**: 같은 실패가 반복될 때 에이전트가 인지하더라도 구조적 해결이 지연됨.

---

### B-005: AI 제공자 통합 미완성 (KI-HARNESS-001)

**증상**: `HarnessProviderAdapter.js`가 존재하지만 실제 Claude API 연결이 검증되지 않았다. `NullHarnessProvider`가 폴백으로 사용되어 AI 기능이 사실상 비활성화 상태.

**근본 원인**: API 키 주입 + 연결 테스트 + 폴백 전략 검증이 WP로 등록되었지만 (KI-HARNESS-001) 해결되지 않음.

**영향**: AI 모드 라우팅, 제공자 어댑터 계약의 실제 동작을 검증할 수 없음.

---

### B-006: Work Packet ↔ 메모리 동기화 지연

**증상**: Work Packet 완료 시 `memory/L0-hot/next-actions.yaml` 갱신이 수동 또는 스크립트 실행에 의존한다. 에이전트가 WP를 완료했는데 next-actions에 여전히 해당 WP가 남아있는 상태가 발생.

**근본 원인**: `verified_auto_commit_guard.js`와 메모리 갱신 스크립트가 별도로 실행. 원자적 갱신 메커니즘 없음.

**영향**: 다음 세션에서 에이전트가 이미 완료된 WP를 다시 선택하는 오작동.

---

### B-007: 비구조화된 종료 출력

**증상**: CLAUDE.md § 종료 출력 형식이 상세히 정의되어 있지만, 에이전트가 형식을 준수하는지 자동 검증이 없다. 보고서마다 필드가 빠지거나 순서가 다를 수 있음.

**근본 원인**: 종료 출력 형식이 텍스트 규칙으로만 존재. JSON Schema나 파서가 없음.

**영향**: Dual-Observer가 종료 보고의 구조를 신뢰할 수 없어 검증 품질 저하.

---

## 6. 개선 계획 — 우선순위별

### 6.1 P0 — 즉시 수정 (세션 0비용 손실 제거)

#### IMP-P0-001: 세션 부트스트랩 단일화

**문제**: B-001 — CLAUDE.md와 CONTINUOUS_PROMPT.md의 읽기 순서 충돌  
**해결**: CLAUDE.md § 파일 읽기 순서를 정전으로 고정. CONTINUOUS_PROMPT.md에서 세션 시작 파일 목록을 제거하고 CLAUDE.md 참조로 대체.  
**구현 위치**: `CLAUDE.md` § 파일 읽기 순서, `docs/harness/CONTINUOUS_PROMPT.md`  
**기대 효과**: 세션당 3~5개 중복 파일 읽기 제거. 시작 응답 시간 단축.  
**완료 기준**: 두 파일의 읽기 순서가 동일하고 CONTINUOUS_PROMPT.md는 CLAUDE.md를 참조만 함.

---

#### IMP-P0-002: Intake Packet 스키마 파일 생성

**문제**: B-002 — `contracts/harness/output.schema.json` 미존재  
**해결**: Intake Packet 6필드에 대한 JSON Schema 생성. `scripts/validate-intake-packet.js` 작성.  
**구현 위치**:  
- 신규: `contracts/harness/intake-packet.schema.json`  
- 신규: `contracts/harness/output.schema.json`  
- 신규: `scripts/validate-intake-packet.js`  
**기대 효과**: 모호한 요청이 재구성 실패 시 즉시 감지. Reflexion Loop 불필요한 트리거 50% 감소 추정.  
**완료 기준**: `npm run validate:intake-packet` 통과 테스트 5개 이상.

---

#### IMP-P0-003: Work Packet 완료 시 메모리 원자적 갱신

**문제**: B-006 — WP 완료 후 next-actions 갱신 지연  
**해결**: `verified_auto_commit_guard.js`에 WP 상태 갱신 + next-actions 재계산을 트랜잭션처럼 묶음.  
**구현 위치**: `scripts/verified_auto_commit_guard.js`, `scripts/wp-complete.js` (신규)  
**기대 효과**: 다음 세션에서 완료된 WP 재선택 방지. 세션 연속성 안정화.  
**완료 기준**: WP 완료 직후 `wp:next` 출력에 해당 WP가 포함되지 않음.

---

### 6.2 P1 — 단기 강화 (v0.2.1 목표)

#### IMP-P1-001: KI-HARNESS-001 해결 — AI 제공자 통합 완성

**문제**: B-005 — HarnessProviderAdapter 실제 연결 미검증  
**현황**: `contracts/harness/provider-adapter.yaml` 계약 존재, `HarnessProviderAdapter.js` 구현 존재, `NullHarnessProvider`가 폴백으로 사용 중  
**해결 단계**:
1. `contracts/harness/provider-adapter.yaml`에 테스트 구성 (API 키 환경변수 주입 방식) 명세 추가
2. `HarnessProviderAdapter.js`에 연결 헬스체크 메서드 추가 (`canConnect(): Promise<boolean>`)
3. `src/tests/smoke/harnessProviderAdapter.smoke.test.js` 신규 작성 (NullProvider mock + real 분기)
4. `scripts/validate-harness-provider.js` 신규 — 제공자 연결 상태 보고

**구현 위치**: `src/infrastructure/ai/`, `src/tests/smoke/`, `scripts/`  
**완료 기준**: `npm run validate:harness-provider` PASS. smoke test 추가.

---

#### IMP-P1-002: Reflexion Loop 자동 에스컬레이션

**문제**: B-004 — 동일 실패 3회 반복 시 경고만 출력  
**해결**: `scripts/check-failure-patterns.js` 신규 작성. 동일 `root_cause_category` 3회 감지 시:
- 자동으로 `memory/wp-queue.yaml`에 새 Work Packet 추가 (type: "remediation")
- `memory/L0-hot/next-actions.yaml` priority 0에 삽입 (최우선)
- ADR 드래프트 생성 (`docs/adr/draft-NNNN-[category].md`)

**구현 위치**: `scripts/check-failure-patterns.js`, `memory/L0-hot/failure-patterns.yaml` 스키마 확장  
**기대 효과**: 반복 실패가 자동으로 구조적 해결 경로로 에스컬레이션.  
**완료 기준**: 동일 카테고리 3회 반복 시 WP + ADR 초안이 자동 생성되는 테스트 통과.

---

#### IMP-P1-003: Video 도메인 영속성 레이어 연결

**문제**: Video 도메인 Stage A~E PASS이지만 SQLite/Postgres 어댑터 미연결  
**현황**: `InMemoryVideoRepository` 만 존재. 재시작 시 데이터 유실.  
**해결 단계**:
1. `SQLiteVideoRepository.js` 구현 (Task 패턴 동일하게 적용)
2. `createServer.js` DB_TYPE 라우팅에 Video 포함
3. `src/tests/smoke/videoStageRunSaveFailure.smoke.test.js` 신규
4. `validate-contracts.js`에 Video 영속성 체크 추가

**구현 위치**: `domains/video/src/infrastructure/`, `src/server/createServer.js`  
**완료 기준**: Video 생성 → 서버 재시작 → 조회 정상 통합 테스트 PASS.

---

#### IMP-P1-004: 종료 출력 구조화 & 자동 검증

**문제**: B-007 — 종료 출력 형식 자동 검증 없음  
**해결**: `contracts/harness/completion-report.schema.json` 신규. `scripts/validate-completion-report.js` 파서 작성. Dual-Observer가 완료 보고 수신 시 자동으로 스키마 검증 실행.  
**완료 기준**: 형식 위반 완료 보고 시 `observer-alert.yaml` 자동 생성.

---

#### IMP-P1-005: 아웃박스 DB 영속화 (WP-S18-003)

**문제**: Outbox 이벤트가 메모리에만 저장 → 서비스 재시작 시 이벤트 유실  
**해결**: `OutboxRepository.js`에 SQLite 백킹 스토어 추가. 마이그레이션 스크립트 포함.  
**완료 기준**: OutboxPoller 재시작 후에도 미전송 이벤트 재처리 통합 테스트 PASS.

---

#### IMP-P1-006: System API 플래그 beta(20%) 롤아웃

**문제**: `system-api` 플러그인이 `flags.yaml`에서 비활성화 상태  
**전제 조건**: IMP-P1-001 완료 (AI 제공자 검증)  
**해결**: SSE 이벤트 스트림 연결 + 실시간 대시보드 갱신 테스트 후 beta 롤아웃.

---

### 6.3 P2 — 중기 혁신 (v0.3.0 목표)

#### IMP-P2-001: Mode Router 학습 루프

**문제**: B-003 — Mode Router가 고정 매핑, 학습 없음  
**해결 아키텍처**:

```
artifacts/evals/harness/
├── invocation-log.jsonl      # 모든 제공자 호출 기록 (mode, tier, token, success, quality_score)
│
scripts/
├── analyze-harness-evals.js  # 호출 로그 분석 → 티어별 성공률/비용 계산
└── update-mode-router.js     # 분석 결과를 HarnessRuntimeRouter에 반영
│
src/infrastructure/HarnessRuntimeRouter.js
└── loadDynamicRoutes()       # artifacts/evals/harness/routing-weights.json 로드
```

**동작 흐름**: 주 1회 `npm run harness:optimize` 실행 → 호출 로그 분석 → 라우팅 가중치 갱신 → 다음 세션에 반영  
**완료 기준**: 100건 호출 후 라우팅 가중치가 초기값과 달라지는 테스트 통과.

---

#### IMP-P2-002: 도메인 간 이벤트 소비 패턴 구현

**문제**: 도메인 이벤트 produced_by는 정의되었지만 consumed_by가 없음  
**예시 시나리오**: "Task DONE → 자동 Invoice 생성" (productivity × billing 크로스-도메인)  
**해결**:
1. `contracts/events/registry.yaml`에 `consumed_by` 필드 추가
2. `CrossDomainEventRouter.js` 신규 — 이벤트 구독 → 크로스-도메인 유스케이스 트리거
3. `contracts/events/cross-domain-policies.yaml` — 이벤트 정책 문서화

**완료 기준**: TaskCompleted 이벤트 → InvoiceCreated 통합 테스트 PASS.

---

#### IMP-P2-003: Postgres Phase 2 완성

**문제**: PostgresTaskRepository/PostgresBillingRepository stub만 존재  
**해결**:
1. 실제 Postgres 클라이언트 주입 (pg 라이브러리)
2. 3-phase 마이그레이션 실행 (`docs/db/migration-strategy.md` 기반)
3. SQLite → Postgres 무중단 전환 연습 (`db-migrate.js`)
4. 통합 테스트 실제 Postgres 대상 실행

---

#### IMP-P2-004: 실시간 Master UI SSE 연결

**문제**: Master UI(artifacts/index.html)가 정적 스냅샷. 실시간 상태 미반영.  
**해결**:
1. `/api/v1/system/events` SSE 엔드포인트 구현
2. `artifacts/index.html`에 EventSource 클라이언트 추가
3. WP 상태 변경 → UI 즉시 갱신
4. `FR-012`: 상단 상태바(현재 레인, 다음 액션, 검증 상태) 실시간화

---

#### IMP-P2-005: 하네스 성능 대시보드 신규

**현재 한계**: `health-dashboard.js`가 DORA 메트릭을 계산하지만 하네스 자체의 효율성(토큰 비용, 모드별 성공률, 평균 재시도 횟수)을 측정하지 않음.  
**해결**: `scripts/harness-performance-dashboard.js` 신규.

```
하네스 성능 지표:
├── 세션당 평균 토큰 비용 (by mode)
├── Intake Packet 재구성 성공률
├── Reflexion Loop 평균 반복 횟수
├── Mode Router 적중률 (첫 번째 선택 = 최적)
├── Work Packet 완료율 (done / total)
├── 세션 연속성 점수 (다음 WP 즉시 선택 = 100점)
└── 게이트 첫 통과율 (FAIL 없이 첫 시도 PASS)
```

---

#### IMP-P2-006: 에이전트 위임 추적 & 감사

**현재 한계**: 서브에이전트(architect/implementer/adversary/observer)가 무엇을 했는지 `audit-chain.js` 외에 구조화된 추적이 없음.  
**해결**: `scripts/agent-delegation-log.js` 신규. 위임 시 입력/출력/소요 시간/게이트 결과를 `artifacts/agent-logs/` 에 JSON으로 저장.

---

### 6.4 P3 — 장기 고도화 (v1.0.0 목표)

#### IMP-P3-001: 자율 Work Packet 생성기

**목표**: requirements 변경 감지 시 자동으로 Work Packet 초안 생성.  
**구현**: `scripts/auto-wp-generator.js` — requirements/*.yaml diff → 변경 분류(A/B/C 재실행 판단) → WP 스켈레톤 생성.

---

#### IMP-P3-002: 크로스-도메인 계약 호환성 매트릭스 자동화

**목표**: 이벤트 스키마 변경 시 소비자 호환성을 자동 검사.  
**구현**: `scripts/contract-compatibility-matrix.js` — 이벤트 스키마 버전별 비교 → breaking change 자동 감지.

---

#### IMP-P3-003: TypeScript 점진적 마이그레이션

**목표**: JSDoc + @ts-check에서 실제 TypeScript로 이동.  
**전략**: `shared/`, `infrastructure/` 부터 시작. 도메인 엔티티는 마지막. 한 번에 하나의 파일.  
**완료 기준**: `tsc --noEmit` 전체 저장소 0 에러.

---

#### IMP-P3-004: Multi-Tenant 격리 레이어

**목표**: 단일 Workflow OS 인스턴스에서 복수 팀/조직이 격리되어 사용.  
**구현**: `x-tenant-id` 헤더 + 테넌트별 DB 스키마 접두어 + 피처 플래그 테넌트 오버라이드.

---

#### IMP-P3-005: AI 에이전트 평가 프레임워크 (Evals)

**목표**: 에이전트 출력 품질을 자동으로 측정.  
**구현**:
```
artifacts/evals/harness/
├── eval-suite.yaml       # 평가 시나리오 (입력 → 기대 출력 패턴)
├── eval-runner.js        # 시나리오 실행 + 채점
└── eval-report.json      # 점수 + 개선 추세
```

---

## 7. 실행 로드맵 & 작업 패킷 목록

```
v0.2.1 마일스톤 (단기 — 다음 스프린트)
  WP-IMP-001  세션 부트스트랩 단일화           P0  3h
  WP-IMP-002  Intake Packet 스키마 생성         P0  4h
  WP-IMP-003  WP 완료 원자적 메모리 갱신         P0  3h
  WP-IMP-004  KI-HARNESS-001 제공자 통합 완성    P1  6h
  WP-IMP-005  Reflexion 자동 에스컬레이션        P1  4h
  WP-IMP-006  Video SQLite 어댑터 연결           P1  5h
  WP-IMP-007  종료 출력 스키마 + 자동 검증        P1  3h
  WP-IMP-008  아웃박스 DB 영속화                 P1  5h

v0.3.0 마일스톤 (중기 — 2~4주)
  WP-IMP-009  Mode Router 학습 루프              P2  8h
  WP-IMP-010  크로스-도메인 이벤트 소비           P2  6h
  WP-IMP-011  Postgres Phase 2 완성              P2  8h
  WP-IMP-012  Master UI SSE 실시간 연결           P2  6h
  WP-IMP-013  하네스 성능 대시보드                P2  4h
  WP-IMP-014  에이전트 위임 추적 & 감사           P2  3h

v1.0.0 마일스톤 (장기 — 1~2개월)
  WP-IMP-015  자율 WP 생성기                     P3  10h
  WP-IMP-016  계약 호환성 매트릭스 자동화          P3  8h
  WP-IMP-017  TypeScript 점진적 마이그레이션       P3  16h
  WP-IMP-018  Multi-Tenant 격리 레이어            P3  12h
  WP-IMP-019  AI 에이전트 평가 프레임워크          P3  10h
```

**의존 관계**:
```
WP-IMP-001 ─────────────────────────────────────▶ WP-IMP-009
WP-IMP-002 ──────────────────────────────────────▶ WP-IMP-007
WP-IMP-003 ──────────────────────────────────────▶ WP-IMP-009
WP-IMP-004 ──────────────────────────────────────▶ WP-IMP-009, WP-IMP-012
WP-IMP-006 ──────────────────────────────────────▶ WP-IMP-011
WP-IMP-008 ──────────────────────────────────────▶ WP-IMP-011
WP-IMP-009 + WP-IMP-013 ─────────────────────────▶ WP-IMP-019
WP-IMP-010 ──────────────────────────────────────▶ WP-IMP-015
```

---

## 8. 검증 기준 (개선 완료 조건)

### 8.1 v0.2.1 완료 체크리스트

```yaml
세션 품질:
  - [ ] 세션 시작 파일 읽기 8개 이하 (중복 제거)
  - [ ] Intake Packet 검증 스크립트 5개 테스트 통과
  - [ ] WP 완료 후 next-actions 즉시 갱신 확인

AI 제공자:
  - [ ] HarnessProviderAdapter 헬스체크 PASS
  - [ ] NullProvider 폴백 전환 테스트 PASS
  - [ ] provider-adapter.yaml 계약과 구현 일치

영속성:
  - [ ] Video 생성 → 재시작 → 조회 통합 테스트 PASS
  - [ ] Outbox 재시작 후 미전송 이벤트 재처리 PASS

자동화:
  - [ ] 동일 실패 3회 → WP + ADR 초안 자동 생성 PASS
  - [ ] 종료 보고 형식 위반 시 observer-alert.yaml 생성 PASS
```

### 8.2 v0.3.0 완료 체크리스트

```yaml
지능화:
  - [ ] 100건 호출 후 Mode Router 가중치 갱신 확인
  - [ ] 하네스 성능 대시보드 지표 6개 이상 표시
  - [ ] 에이전트 위임 로그 artifacts/agent-logs/ 저장 확인

크로스-도메인:
  - [ ] TaskCompleted → InvoiceCreated 통합 테스트 PASS
  - [ ] contract-compatibility-matrix 크로스-도메인 이벤트 커버

인프라:
  - [ ] Postgres 실제 연결 통합 테스트 PASS
  - [ ] Master UI SSE 실시간 WP 상태 갱신 확인
```

### 8.3 하네스 품질 지표 목표치

| 지표 | 현재 (v0.2.0) | v0.2.1 목표 | v0.3.0 목표 |
|------|--------------|------------|------------|
| 세션당 초기 파일 읽기 수 | 12~15개 | 8개 이하 | 6개 이하 |
| Intake Packet 재구성 성공률 | 미측정 | 95%+ | 99%+ |
| Reflexion Loop 평균 반복 | 미측정 | 측정 기준 확립 | 1.5회 이하 |
| WP 완료 후 메모리 동기화 | 수동 | 자동 (원자적) | 자동 + 검증 |
| AI 제공자 가용성 | 미검증 | 검증 완료 | SLA 99.9% |
| 게이트 첫 통과율 | 미측정 | 측정 기준 확립 | 85%+ |
| 하네스 성능 대시보드 | 없음 | 없음 | 6개 지표 |

---

## 부록 A: 기술 부채 전체 목록

| ID | 영역 | 설명 | 심각도 | WP |
|----|------|------|--------|-----|
| TD-001 | 하네스 | 세션 시작 프로토콜 중복 | MEDIUM | WP-IMP-001 |
| TD-002 | 하네스 | Intake Packet 검증 없음 | HIGH | WP-IMP-002 |
| TD-003 | 하네스 | Mode Router 고정 매핑 | MEDIUM | WP-IMP-009 |
| TD-004 | 하네스 | Reflexion 에스컬레이션 없음 | MEDIUM | WP-IMP-005 |
| TD-005 | AI | KI-HARNESS-001 미해결 | HIGH | WP-IMP-004 |
| TD-006 | 메모리 | WP-메모리 동기화 지연 | HIGH | WP-IMP-003 |
| TD-007 | 보고 | 종료 출력 구조 검증 없음 | MEDIUM | WP-IMP-007 |
| TD-008 | 영속성 | Video SQLite 어댑터 없음 | HIGH | WP-IMP-006 |
| TD-009 | 영속성 | Outbox DB 영속화 없음 | HIGH | WP-IMP-008 |
| TD-010 | 영속성 | Postgres Phase 2 stub | MEDIUM | WP-IMP-011 |
| TD-011 | 이벤트 | consumed_by 없음 | MEDIUM | WP-IMP-010 |
| TD-012 | UI | Master UI 정적 스냅샷 | LOW | WP-IMP-012 |
| TD-013 | 타입 | JSDoc @ts-check 부분적 | LOW | WP-IMP-017 |
| TD-014 | 관찰성 | System API SSE 미연결 | MEDIUM | WP-IMP-012 |

---

## 부록 B: 이 문서의 유지 관리 규칙

1. **갱신 트리거**: 새 IMP-* 개선이 완료되거나 취소되면 즉시 이 문서의 해당 항목을 갱신한다.
2. **상태 표기**: `[ ]` 미완, `[x]` 완료, `[~]` 부분 완료, `[-]` 취소.
3. **동기화 대상**: `memory/wp-queue.yaml`의 WP-IMP-* 상태와 이 문서의 체크리스트는 항상 일치해야 한다.
4. **리뷰 주기**: B_review 완료 시마다 § 4 종합 점수표를 재평가한다.
5. **삭제 금지**: 취소된 개선 항목도 `[-]`로 표기하고 취소 이유를 한 줄로 남긴다.

---

*이 문서는 Workflow OS my-module 저장소 전체를 심층 분석한 결과다.  
현재 하네스는 v0.2.0 수준으로 견고하지만, 위 7가지 병목과 14개 기술 부채를 순차 해소하면 v0.3.0에서 최고 수준의 자율 실행 품질에 도달할 수 있다.*
