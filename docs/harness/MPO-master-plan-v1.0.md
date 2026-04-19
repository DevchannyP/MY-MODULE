# Master Plan Orchestrator (MPO) v1.0
## — Workflow OS 프롬프트 하네스 최종 아키텍처 단일 문서

> **작성일**: 2026-04-19
> **대상 저장소**: `my-module` (Workflow OS 코어)
> **기반 문서**: `HARNESS_MASTER_IMPROVEMENT_PLAN.md` + `Prompt Harness Full Review And Plan`
> **목적**: Master UI 한 번의 입력으로 완벽 격리·고응집·토큰 최적·자동화된 실행 파이프라인을 정의

---

## 0. 한 장 요약 (결론 먼저)

### 핵심 결론
**"User가 Master UI에 목표 한 줄을 입력하면, 12개의 격리된 결정적 모듈이 파이프라인으로 직렬 체결되어, 각각 자신의 토큰 예산과 컨텍스트 봉투만으로 완벽히 실행되고, 실패 시 자동 재계획된다."**

### 왜 지금 이 구조가 필요한가
현재 하네스 v0.2.0은 **기능은 있지만 닫혀있지 않다.** Intake 검증 없음, Output 강제 없음, Mode Router가 mode 하나만 봄, 컨텍스트 봉투 없음, 토큰 예산 없음 → 세션마다 전체 저장소를 "다시 읽는 경향" + 실패 루프가 구조화되지 않음.

### 5대 설계 원칙 (MPO Principles)
| 원칙 | 한 줄 | 왜 |
|------|-------|-----|
| **P1. 결정적 우선** (Deterministic First) | LLM 없이 풀 수 있는 모듈은 LLM을 쓰지 않는다 | 토큰 0원, 재현 가능, 테스트 가능 |
| **P2. 컨텍스트 봉투** (Context Envelope) | 각 WP는 최소 필요 파일만 본다 | 토큰 선형 증가 방지 |
| **P3. 단일 입력 단일 계약** (One Input, One Contract) | 사용자는 한 줄, 시스템은 스키마 | UX 최적 + 검증 가능 |
| **P4. 증거 없으면 PASS 없음** (No Evidence, No Pass) | truthfulness gate를 runtime enforce | 거짓 보고 차단 |
| **P5. 격리된 모듈, 선언된 경계** (Isolated Modules, Declared Boundaries) | 각 모듈은 입력/출력 계약만으로 연결 | 독립 테스트/교체/병렬 |

### 즉시 기대 효과 (v0.2.0 → v1.0 MPO)
- 세션 초기 토큰: 12~15개 파일 → **3개 앵커 + WP별 봉투** (70%↓ 추정)
- WP 1개 실행당 평균 토큰: 현재 전체 컨텍스트 로드 → **봉투 고정** (50%↓ 추정)
- Master UI 사용자 액션: `여러 스크립트 + 여러 명령` → **1 입력 + 1 승인**
- 실패 자동 처리: 수동 ADR 작성 → **3회 반복 시 자동 WP+ADR 초안 생성**

---

## 1. 사용자 경험 흐름 (Master UI 단일 입력)

### 1.1 최종 UX 모습 (끝판왕 사용자 친화)

```
┌────────────────────────────────────────────────────────────────┐
│  Workflow OS — Master UI                    [⚙] [📊] [🔔 2]   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   목표를 한 줄로 입력하세요                                     │
│   ┌──────────────────────────────────────────────────────┐    │
│   │ Video 도메인에 SQLite 어댑터 연결하고 통합 테스트   │   │
│   │ 추가해줘                                              │   │
│   └──────────────────────────────────────────────────────┘    │
│                                              [계획 만들기 ▶]  │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│   ▼ AI가 자동 분석한 실행 계획 (검토 후 승인하세요)            │
│                                                                │
│   📦 WP-AUTO-001  [P1] Video SQLite Repository 구현           │
│      격리: domains/video/* only   예산: 12k tok   mini tier   │
│      검증: unit + contract         의존: 없음                  │
│                                                                │
│   📦 WP-AUTO-002  [P1] createServer DB 라우팅 확장            │
│      격리: src/server/*            예산: 6k tok    mini tier   │
│      검증: smoke                    의존: AUTO-001             │
│                                                                │
│   📦 WP-AUTO-003  [P1] Video 영속성 통합 테스트               │
│      격리: domains/video/tests/*   예산: 8k tok    mini tier   │
│      검증: integration + smoke      의존: AUTO-002             │
│                                                                │
│   총 3개 WP · 예상 토큰 26k · 예상 시간 8분                   │
│                                                                │
│   [◀ 수정]                         [이대로 실행 시작 ▶▶]     │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 실행 진행 중 화면

```
┌────────────────────────────────────────────────────────────────┐
│   ▶ 실행 중... (1/3)                                   [일시정지]│
├────────────────────────────────────────────────────────────────┤
│   ✅ WP-AUTO-001  Video SQLite Repository 구현                 │
│       토큰: 10,842 / 12,000  ·  6개 테스트 PASS  ·  2m 13s    │
│                                                                │
│   ⏳ WP-AUTO-002  createServer DB 라우팅 확장                  │
│       토큰: 3,120 / 6,000   ·  작업 중...                      │
│       └─ 읽는 중: src/server/createServer.js (L1430-1520)     │
│                                                                │
│   ⏸  WP-AUTO-003  Video 영속성 통합 테스트  (대기)            │
└────────────────────────────────────────────────────────────────┘
```

### 1.3 완료 후 화면

```
┌────────────────────────────────────────────────────────────────┐
│   🎉 완료! 3/3 WP PASS · 총 토큰 24,104 · 총 시간 7분 42초    │
├────────────────────────────────────────────────────────────────┤
│   커밋: 3개 · 테스트: +8 (570→578) · 게이트: 모두 PASS         │
│                                                                │
│   [📄 학습 보고서 보기]  [📊 DORA 메트릭]  [➡ 다음 작업]      │
└────────────────────────────────────────────────────────────────┘
```

### 1.4 사용자가 하는 일 (총 3번의 클릭)
1. **입력**: 목표 한 줄 타이핑
2. **승인**: 자동 생성된 계획을 확인하고 `실행 시작` 클릭
3. **완료 확인**: 보고서 확인 또는 다음 작업으로 이동

모든 중간 단계(분해, 격리, 예산, 라우팅, 검증, 커밋, 메모리 갱신)는 **자동화**.

---

## 2. 시스템 아키텍처 — 12 모듈 파이프라인

### 2.1 전체 파이프라인

```
                    ┌─────────────────────────────────┐
                    │  User: "목표 한 줄"              │
                    └───────────────┬─────────────────┘
                                    │
                    ┌───────────────▼─────────────────┐
                    │  M01: Master Input Surface       │
                    │  (UI → raw intent + session ctx) │
                    └───────────────┬─────────────────┘
                                    │
              ┌─────────────────────▼─────────────────────┐
              │  ◆ 계획 생성 단계 (Planning Phase)          │
              │                                            │
              │  M02: Intake Normalizer      (LLM 소)      │
              │  M03: Goal Decomposer        (LLM 중)      │
              │  M04: Isolation Boundary     (결정적)      │
              │  M05: Context Envelope       (결정적)      │
              │  M06: Token Budget           (결정적)      │
              │  M07: Mode Router            (결정적)      │
              │  M08: Verification Planner   (결정적)      │
              │                                            │
              │  ▼ 출력: WP-DAG + 실행 매니페스트          │
              └─────────────────────┬─────────────────────┘
                                    │
                          [사용자 승인 게이트]
                                    │
              ┌─────────────────────▼─────────────────────┐
              │  ◆ 실행 단계 (Execution Phase)             │
              │                                            │
              │  M09: Execution Orchestrator (for each WP) │
              │       └─ Provider invocation (LLM 대)      │
              │  M10: Truthfulness Gate      (결정적)      │
              │  M11: Memory Reconciler      (결정적)      │
              │                                            │
              │  ▼ 출력: 완료 보고 + 증적                  │
              └─────────────────────┬─────────────────────┘
                                    │
                    ┌───────────────▼─────────────────┐
                    │  M12: Progress Visualizer (SSE) │
                    │  (실시간으로 모든 단계 표시)    │
                    └─────────────────────────────────┘
```

### 2.2 LLM 호출이 발생하는 지점 (토큰 비용)

| 단계 | 모듈 | LLM 호출 여부 | 평균 토큰 |
|------|------|--------------|----------|
| M01 | Master Input Surface | ❌ | 0 |
| **M02** | **Intake Normalizer** | ✅ mini tier | **~1,500** |
| **M03** | **Goal Decomposer** | ✅ standard tier | **~3,000** |
| M04 | Isolation Boundary | ❌ | 0 |
| M05 | Context Envelope | ❌ | 0 |
| M06 | Token Budget | ❌ | 0 |
| M07 | Mode Router | ❌ | 0 |
| M08 | Verification Planner | ❌ | 0 |
| **M09** | **Execution (per WP)** | ✅ 예산 내 | **WP당 5k~15k** |
| M10 | Truthfulness Gate | ❌ | 0 |
| M11 | Memory Reconciler | ❌ | 0 |
| M12 | Progress Visualizer | ❌ | 0 |

**핵심**: 12개 모듈 중 **9개(75%)가 결정적 함수**. LLM은 계획 단계 2회 + 실행 단계 WP별 1회만 호출. 전통적 "전체 맥락 매번 로드" 방식 대비 토큰 선형 증가 제거.

### 2.3 7개 논리적 평면 (Planes) 매핑

| Plane | 담당 모듈 | 책임 |
|-------|-----------|------|
| **Intake Plane** | M01, M02 | 원시 의도 → 표준 Intake Packet |
| **Decomposition Plane** | M03, M04 | 목표 → 격리된 WP-DAG |
| **Context Plane** | M05, M06 | WP별 최소 컨텍스트 + 토큰 예산 |
| **Routing Plane** | M07 | WP별 provider tier 선택 |
| **Verification Plane** | M08, M10 | WP별 게이트 + 진실성 강제 |
| **Execution Plane** | M09 | Provider 호출 + 결과 수집 |
| **State Plane** | M11, M12 | 메모리 동기화 + UI 피드백 |

---

## 3. 모듈별 상세 명세 (각각 완전 격리된 단일 책임)

### M01: Master Input Surface (마스터 입력 표면)

| 속성 | 값 |
|------|---|
| **단일 책임** | 사용자 원시 의도를 수신하고 세션 컨텍스트를 첨부 |
| **입력** | HTTP POST `/api/v1/mpo/plan` `{ goal: string }` |
| **출력** | `{ raw_intent, session_context }` 객체 |
| **LLM 호출** | ❌ |
| **파일 위치** | `artifacts/index.html` (UI), `src/server/routes/mpo.js` (신규) |
| **의존성** | 없음 |
| **테스트** | HTTP 요청 → 응답 구조 검증 |
| **세션 컨텍스트 구성** | `memory/current-state.yaml` + `memory/current-wp.yaml` + `requirements/requirements.yaml` 의 핵심 필드만 추출 |

**격리 보장**: 이 모듈은 오직 HTTP 수신과 세션 앵커 3개 로딩만 한다. 파싱·분해·판단 없음.

---

### M02: Intake Normalizer (입력 정규화기)

| 속성 | 값 |
|------|---|
| **단일 책임** | `raw_intent` → 검증된 Intake Packet (6+5 필드) |
| **입력** | M01의 출력 |
| **출력** | Intake Packet (아래 스키마 참조) |
| **LLM 호출** | ✅ mini tier (분류만 수행) |
| **파일 위치** | `scripts/intake-normalizer.js` (신규), `contracts/harness/intake.schema.json` (확장) |
| **의존성** | M01 |
| **토큰 예산** | 1,500 tokens (입력 설명 + 분류 결과 JSON) |
| **실패 시** | 스키마 검증 FAIL → 사용자에게 구조화된 clarification 질문 반환 |

**Intake Packet 스키마 (확장판)**:
```yaml
intake_packet:
  # 기존 6필드
  goal: string                    # 목표
  context: string                  # 배경
  constraints: list[string]        # 제약
  done_when: list[string]          # 완료 조건
  work_mode: enum[Research|Build|Debug|Operate|Policy]
  verification: list[string]       # 검증 방법

  # MPO v1.0에서 추가되는 5필드 (자동 분류)
  packet_type: enum[feature|bugfix|refactor|docs|ops|spike]
  risk_level: enum[low|medium|high|critical]
  trust_level: enum[trusted|untrusted|mixed]
  evidence_required: enum[minimal|standard|strict]
  interactive_class: enum[batch|interactive|realtime]
```

**격리 보장**: 분류 로직만. WP 분해나 파일 접근 없음.

---

### M03: Goal Decomposer (목표 분해기)

| 속성 | 값 |
|------|---|
| **단일 책임** | Intake Packet → WP-DAG (Work Packet 목록 + 의존 관계) |
| **입력** | M02의 Intake Packet |
| **출력** | `{ wp_list: [...], edges: [...] }` (DAG) |
| **LLM 호출** | ✅ standard tier (추론 필요) |
| **파일 위치** | `scripts/goal-decomposer.js` (신규), 프롬프트는 `contracts/harness/decomposer-prompt.yaml` |
| **의존성** | M02 |
| **토큰 예산** | 3,000 tokens |
| **분해 규칙** | (1) 도메인 경계로 먼저 분리, (2) 각 도메인 내 계층별 분리, (3) 병렬 가능 여부 태깅 |

**분해 출력 예시**:
```yaml
wp_list:
  - id: WP-AUTO-001
    title: "Video SQLite Repository 구현"
    domain: video
    layer: infrastructure
    parallelizable: true
    estimated_token_cost: 12000
    estimated_duration_min: 3

edges:
  - from: WP-AUTO-001
    to: WP-AUTO-002
    type: produces_interface
```

**격리 보장**: 분해 결과만 반환. 실제 파일 조작이나 컨텍스트 로딩 없음.

---

### M04: Isolation Boundary Engine (격리 경계 엔진)

| 속성 | 값 |
|------|---|
| **단일 책임** | 각 WP에 대해 "만질 수 있는 파일 경로 화이트리스트"를 결정 |
| **입력** | M03의 WP-DAG |
| **출력** | 각 WP에 `allowed_paths`, `forbidden_paths`, `read_only_paths` 추가 |
| **LLM 호출** | ❌ (규칙 기반) |
| **파일 위치** | `scripts/isolation-boundary.js` (신규), 규칙은 `contracts/harness/isolation-rules.yaml` |
| **의존성** | M03, `requirements/constraints.yaml` |
| **토큰 예산** | 0 |

**격리 규칙 예시**:
```yaml
isolation_rules:
  video_infrastructure_wp:
    allowed_write:
      - domains/video/src/infrastructure/**
      - domains/video/tests/infrastructure/**
    read_only:
      - domains/video/src/domain/**
      - domains/video/src/application/**
      - contracts/**
    forbidden:
      - domains/billing/**
      - domains/productivity/**
      - src/server/**       # createServer 수정은 별도 WP
```

**격리 보장**: 이 엔진 자체가 "격리 강제자". 다른 모듈이 이 경계를 변경할 수 없음 (enforced by M09).

---

### M05: Context Envelope Builder (컨텍스트 봉투 빌더)

| 속성 | 값 |
|------|---|
| **단일 책임** | 각 WP에 대해 "읽어야 할 파일 최소 집합 + 라인 범위"를 계산 |
| **입력** | M04의 WP + 경계 |
| **출력** | 각 WP에 `context_envelope` 추가 |
| **LLM 호출** | ❌ (파일 시스템 + 정적 분석) |
| **파일 위치** | `scripts/build-context-envelope.js` (신규) |
| **의존성** | M04, `contracts/harness/context-sources.yaml` (신규) |
| **토큰 예산** | 0 |

**봉투 계산 알고리즘**:
1. WP의 `allowed_write` 경로 → 해당 파일들 자체 포함
2. 해당 파일들이 `import`하는 계약·인터페이스 → 포함
3. 같은 도메인의 테스트 예시 1개 → 포함 (패턴 참고용)
4. `requirements/[domain].yaml` 해당 섹션만 → 포함
5. `memory/stageA/[domain].yaml` 해당 INV 섹션만 → 포함

**봉투 예시 (WP-AUTO-001 기준)**:
```yaml
context_envelope:
  canonical_files:
    - domains/video/src/domain/entities/Video.js  # full
    - domains/video/src/application/ports/VideoRepository.js  # full
    - domains/video/src/infrastructure/InMemoryVideoRepository.js  # full (패턴 참고)
    - domains/productivity/task-tracking/src/infrastructure/SQLiteTaskRepository.js  # full (정석 예시)
  partial_files:
    - requirements/video.yaml: [L45, L120]
    - memory/stageA/video.yaml: [L20, L80]
  estimated_context_tokens: 8400
```

**격리 보장**: 봉투 밖 파일은 WP 실행 시 읽을 수 없음 (M09에서 enforce).

---

### M06: Token Budget Allocator (토큰 예산 할당기)

| 속성 | 값 |
|------|---|
| **단일 책임** | 각 WP에 토큰 상한을 할당 |
| **입력** | M05의 WP + 봉투 크기 |
| **출력** | 각 WP에 `token_budget` 추가 |
| **LLM 호출** | ❌ (수식 기반) |
| **파일 위치** | `scripts/allocate-token-budget.js` (신규) |
| **의존성** | M05 |
| **토큰 예산** | 0 |

**예산 공식** (초기값):
```
budget = context_envelope_tokens × 1.5 + base_reserve
  where base_reserve = {
    packet_type=feature:  4000,
    packet_type=bugfix:   2000,
    packet_type=refactor: 3000,
    packet_type=docs:     1000,
    packet_type=ops:      2000,
    packet_type=spike:    6000,
  }
  cap = {
    risk_level=critical:  30000,
    risk_level=high:      20000,
    risk_level=medium:    15000,
    risk_level=low:       10000,
  }
  final = min(budget, cap)
```

**초과 시 동작**: M09 실행 중 예산 80% 도달하면 M12에 경고 → 90% 도달하면 WP 정지 후 사용자에게 "계속? 분할?" 묻는다.

**격리 보장**: 수식은 고정. WP 단위로만 예산 관리. 전체 세션 예산은 별도 (M12에서 집계).

---

### M07: Mode Router (모드 라우터 — 확장판)

| 속성 | 값 |
|------|---|
| **단일 책임** | 각 WP에 provider tier (frontier/standard/mini) 할당 |
| **입력** | M06의 WP (mode + risk + trust + budget + interactive) |
| **출력** | 각 WP에 `provider_tier`, `fallback_chain` 추가 |
| **LLM 호출** | ❌ (규칙 테이블) |
| **파일 위치** | `src/infrastructure/HarnessRuntimeRouter.js` (기존 확장) |
| **의존성** | M06 |
| **토큰 예산** | 0 |

**확장된 라우팅 규칙**:
```yaml
routing_matrix:
  # mode × risk_level 2차원 매트릭스
  Research × critical: frontier + frontier_fallback
  Research × high:     frontier
  Research × medium:   standard
  Research × low:      standard

  Build × critical:    standard + frontier_fallback
  Build × high:        standard
  Build × medium:      mini
  Build × low:         mini

  Debug × any:         standard  # debug는 항상 reasoning 필요

  Operate × any:       mini      # operate는 결정적 작업

  Policy × any:        frontier  # policy는 항상 최고 모델

  # 오버라이드: evidence_required=strict이면 한 단계 상승
  evidence_required=strict: bump_up_one_tier
```

**격리 보장**: 규칙 테이블만 참조. provider 호출 안 함.

---

### M08: Verification Planner (검증 계획기)

| 속성 | 값 |
|------|---|
| **단일 책임** | 각 WP에 최소 필요 검증 게이트 목록 할당 |
| **입력** | M07의 WP (packet_type + domain + layer) |
| **출력** | 각 WP에 `verification_bundle` 추가 |
| **LLM 호출** | ❌ (프로파일 조회) |
| **파일 위치** | `scripts/resolve_validation_profile.js` (기존 확장) |
| **의존성** | M07, `requirements/validation-profiles.yaml` (확장) |
| **토큰 예산** | 0 |

**검증 번들 예시 (WP-AUTO-001)**:
```yaml
verification_bundle:
  required:
    - command: "npm run lint -- domains/video"
      pass_criteria: "0 errors"
    - command: "npm test -- domains/video/tests/infrastructure"
      pass_criteria: "all tests pass"
    - command: "npm run validate:contracts -- --domain video"
      pass_criteria: "no drift"
  optional:
    - command: "npm run test:property -- video"
```

**격리 보장**: 오직 "어떤 검증이 필요한가"만 결정. 실행은 M09에서.

---

### M09: Execution Orchestrator (실행 오케스트레이터)

| 속성 | 값 |
|------|---|
| **단일 책임** | WP-DAG를 순회하며 각 WP를 provider에게 전달 + 검증 게이트 실행 |
| **입력** | M02~M08까지 모든 메타데이터가 붙은 WP-DAG |
| **출력** | 각 WP에 대한 실행 결과 + 증적 |
| **LLM 호출** | ✅ WP별 예산 내 |
| **파일 위치** | `scripts/orchestrate.js` (기존 강화), `src/infrastructure/ai/HarnessProviderAdapter.js` |
| **의존성** | M02~M08 |
| **토큰 예산** | WP별 M06이 정한 상한 |

**실행 사이클 (WP 하나당)**:
```
1. M05 봉투의 파일들을 읽어 prompt payload 조립
2. M07 tier에 따라 provider 선택
3. provider 호출 (max_tokens = M06 예산)
4. 응답 파싱 → 파일 수정
5. M04 경계 외 파일 수정 시도 → 즉시 거부
6. M08 검증 번들 실행
7. 모든 게이트 PASS → M10으로
   하나라도 FAIL → Reflexion (최대 3회 재시도) → 실패 시 에스컬레이션
```

**병렬 실행**: DAG에서 `depends_on`이 없는 WP들은 병렬 실행 가능. 기본은 병렬 2개, flag로 조정.

**격리 보장**: 각 WP 실행은 독립 프로세스 또는 격리된 Claude 인스턴스로 분리 가능 (설계상). 동일 세션에서 실행해도 컨텍스트 교차 없음.

---

### M10: Truthfulness Gate (진실성 게이트)

| 속성 | 값 |
|------|---|
| **단일 책임** | WP 완료 보고가 output schema를 충족하고 증거가 실재하는지 검증 |
| **입력** | M09의 WP 실행 결과 |
| **출력** | `{ verified: bool, violations: [...] }` |
| **LLM 호출** | ❌ (스키마 검증 + 파일 존재 확인) |
| **파일 위치** | `scripts/validate-completion-report.js` (신규), `contracts/harness/output.schema.json` (런타임 강제) |
| **의존성** | M09 |
| **토큰 예산** | 0 |

**검증 항목**:
```yaml
truthfulness_checks:
  - schema_compliance: output.schema.json 통과
  - evidence_files_exist: 언급된 evidence 파일이 실제 존재
  - test_count_matches: "8 tests pass" 주장 시 실제 8개 통과 확인
  - commit_hash_exists: 언급된 commit SHA가 실제 git log에 존재
  - file_paths_exist: 수정했다고 주장하는 파일이 실제 변경됨
  - no_forbidden_edits: M04 경계를 침범하지 않았음
  - no_unverified_pass: "PASS" 주장에 해당 evidence 항목이 모두 있음
```

**FAIL 시**: WP를 `done`이 아닌 `claimed_done_but_unverified` 상태로 표시 → observer-alert 생성 → 사용자 검토 요청.

**격리 보장**: 결정적 검증만. 새로운 판단 없음.

---

### M11: Memory Reconciler (메모리 조정기)

| 속성 | 값 |
|------|---|
| **단일 책임** | WP 완료 시 `memory/` 전체를 원자적으로 갱신 |
| **입력** | M10이 `verified=true`로 승인한 WP |
| **출력** | 갱신된 메모리 상태 + 다음 `wp:next` |
| **LLM 호출** | ❌ |
| **파일 위치** | `scripts/wp-complete.js` (신규 — IMP-P0-003) |
| **의존성** | M10 |
| **토큰 예산** | 0 |

**원자적 갱신 트랜잭션** (모두 성공해야 커밋):
```
1. memory/wp-queue.yaml: WP 상태 done으로 변경
2. memory/current-wp.yaml: 다음 WP로 교체 (또는 NONE)
3. memory/L0-hot/next-actions.yaml: 우선순위 재계산
4. memory/L0-hot/current-state.yaml: as_of 갱신
5. worklog/reports/YYYY-MM-DD_WP-ID.yaml: 증적 저장
6. git add + git commit (verified_auto_commit_guard 통합)
```

**실패 롤백**: 한 단계라도 실패하면 전체 롤백. 부분 갱신 방지.

**격리 보장**: 메모리 갱신만 담당. 다른 모듈은 메모리를 읽기만 함.

---

### M12: Progress Visualizer (진행 시각화)

| 속성 | 값 |
|------|---|
| **단일 책임** | SSE로 모든 모듈의 이벤트를 스트리밍하여 Master UI에 실시간 반영 |
| **입력** | M01~M11 모든 모듈의 이벤트 |
| **출력** | SSE 스트림 + Master UI 갱신 |
| **LLM 호출** | ❌ |
| **파일 위치** | `src/server/routes/events.js` (신규), `artifacts/index.html` (EventSource 클라이언트) |
| **의존성** | 모든 모듈 (수동적 구독) |
| **토큰 예산** | 0 |

**이벤트 종류**:
```
mpo.intake.normalized         M02 완료
mpo.decomposition.ready       M03 완료 → 사용자 승인 대기
mpo.envelope.built            M05 완료
mpo.wp.started                M09 개별 WP 시작
mpo.wp.token.progress         진행률 스트리밍 (매 500토큰)
mpo.wp.completed              M10 승인
mpo.wp.failed                 M09 또는 M10 실패
mpo.memory.reconciled         M11 완료
mpo.plan.completed            전체 완료
```

**격리 보장**: 오직 이벤트 수신과 브로드캐스트. 이벤트 내용을 수정하거나 해석하지 않음.

---

## 4. 모듈 간 계약 (Inter-Module Contracts)

### 4.1 계약 매트릭스

| From → To | 전달 객체 | 스키마 파일 |
|-----------|----------|-------------|
| M01 → M02 | `RawIntent` | `contracts/harness/raw-intent.schema.json` (신규) |
| M02 → M03 | `IntakePacket` | `contracts/harness/intake.schema.json` (확장) |
| M03 → M04 | `WPDagDraft` | `contracts/harness/wp-dag.schema.json` (신규) |
| M04 → M05 | `WPDagWithBoundaries` | 위 스키마 + `isolation` 필드 |
| M05 → M06 | `WPDagWithEnvelopes` | 위 스키마 + `context_envelope` 필드 |
| M06 → M07 | `WPDagWithBudgets` | 위 스키마 + `token_budget` 필드 |
| M07 → M08 | `WPDagWithRouting` | 위 스키마 + `provider_tier` 필드 |
| M08 → M09 | `ExecutableWPDag` | 위 스키마 + `verification_bundle` 필드 (최종형) |
| M09 → M10 | `WPExecutionResult` | `contracts/harness/output.schema.json` |
| M10 → M11 | `VerifiedWPResult` | 위 + `verification_status` |
| M11 → M12 | `MemoryUpdateEvent` | `contracts/events/registry.yaml`에 추가 |

### 4.2 계약 불변식

- **CONTRACT-INV-01**: 모듈은 자신의 입력 스키마를 검증하지 않고 실행하지 않는다
- **CONTRACT-INV-02**: 모듈은 자신의 출력 스키마를 검증한 뒤에만 다음 모듈로 전달한다
- **CONTRACT-INV-03**: 모듈은 직접 다른 모듈을 호출하지 않고 파이프라인 오케스트레이터를 통해서만 연결된다
- **CONTRACT-INV-04**: 모듈 스키마 변경은 `validate:contracts`에 의해 자동 감지되며, 의존 모듈의 테스트가 통과해야 머지 가능

---

## 5. 토큰 효율성 전략 (Token Efficiency)

### 5.1 전통적 방식 vs MPO 방식

| 항목 | 전통적 방식 | MPO 방식 | 절감 |
|------|------------|---------|------|
| 세션 초기 로딩 | CLAUDE.md 전체 + 9개 파일 | 앵커 3개 (current-state, current-wp, next-actions) | ~70% |
| 요청 하나당 컨텍스트 | 연관 파일 5~10개 전체 | 봉투 기반 최소 집합 | ~50% |
| 반복 세션 | 매번 재로딩 | current-state만 델타 확인 | ~85% |
| 실패 재시도 | 처음부터 다시 | Reflexion 패턴만 추가 | ~60% |

### 5.2 컨텍스트 봉투 원칙

**Golden Rule**: "WP 하나가 수정하는 파일들 + 그 파일들이 직접 참조하는 계약 + 같은 도메인의 예시 1개. 그 이상은 금지."

### 5.3 4계층 소스 분류 (Source Classification Manifest)

```yaml
# contracts/harness/context-sources.yaml (신규)
classification:
  canonical:        # 항상 읽어야 함 (세션당 1회)
    - memory/current-state.yaml
    - memory/current-wp.yaml
    - memory/L0-hot/next-actions.yaml

  domain_canonical: # 해당 도메인 WP 실행 시 필수
    - requirements/[domain].yaml
    - memory/stageA/[domain].yaml
    - domains/[domain]/contract/capability.yaml

  reference:        # 봉투에 포함될 수 있음 (WP 필요 시)
    - domains/[domain]/src/**
    - contracts/**

  generated:        # 기본 무시 (opt-in 필요)
    - artifacts/**
    - worklog/**
    - logs/**

  forbidden:        # 절대 읽지 않음
    - node_modules/**
    - .git/**
    - **/*.min.js
```

### 5.4 토큰 예산 대시보드 (M12에 통합)

```
현재 세션:
  계획 단계: 4,521 / 5,000 (90%) ✅
  실행 단계: 18,234 / 50,000 (36%)
  총 누적: 22,755

WP별 사용률:
  WP-AUTO-001 ████████████░░░░░░ 75% (9k / 12k)
  WP-AUTO-002 ██████░░░░░░░░░░░░ 35% (2.1k / 6k)
  WP-AUTO-003 ░░░░░░░░░░░░░░░░░░ 0% (대기 중)
```

---

## 6. 자동화 핵심 루프 (Automation Primitives)

### 6.1 5대 자동화 루프

#### Loop 1: 승인 자동화 (Approval Automation)
```
조건: packet_type ∈ [docs, refactor] AND risk_level = low
동작: 계획 단계에서 사용자 승인 스킵 → 즉시 실행
단, 실행 결과는 M10 검증 후 M12에 알림
```

#### Loop 2: 재계획 자동화 (Auto-Replan)
```
조건: WP 실행 중 "예상치 못한 경계 필요" 감지
동작: WP 정지 → M04로 되돌아가 경계 재계산 → 재실행
알림: M12에 "재계획됨" 배지
```

#### Loop 3: 실패 에스컬레이션 자동화 (Failure Escalation)
```
조건: 동일 root_cause_category 3회 연속 실패
동작:
  1. memory/wp-queue.yaml에 remediation WP 자동 생성
  2. docs/adr/draft-NNNN-[category].md 초안 생성
  3. next-actions 최우선으로 삽입
```

#### Loop 4: Mode Router 학습 루프 (IMP-P2-001 통합)
```
조건: 주 1회 스케줄 (또는 100회 호출마다)
동작:
  1. artifacts/evals/harness/invocation-log.jsonl 분석
  2. tier별 (성공률, 토큰/품질 비율) 계산
  3. HarnessRuntimeRouter 가중치 갱신
  4. 다음 세션부터 반영
```

#### Loop 5: 메모리 동기화 자동화 (IMP-P0-003 통합)
```
조건: M11 실행 시점
동작: 6-step atomic transaction (3.11 절 참조)
실패 시: 전체 롤백 + 사용자 수동 처리 요청
```

### 6.2 사용자 개입이 필요한 3 시점

| 시점 | 이유 | UI 요소 |
|------|------|---------|
| 1. 계획 승인 | LLM이 오해할 수 있는 분해를 사람이 확인 | `[이대로 실행]` 버튼 |
| 2. risk=critical WP 실행 직전 | 중요 작업은 한 번 더 확인 | `[계속 진행]` 버튼 |
| 3. Truthfulness Gate FAIL 또는 Reflexion 3회 실패 | 구조적 문제일 수 있음 | `[검토 후 결정]` 모달 |

그 외 모든 단계는 자동.

---

## 7. 구현 로드맵 (Work Packet 순서)

### 7.1 Phase 구조

| Phase | 목표 | 기간 | WP 수 | 의존 |
|-------|------|------|------|------|
| **Phase 0** | 기반 스키마 + 계약 | 1주 | 5 | - |
| **Phase 1** | M01-M08 계획 단계 모듈 | 2주 | 8 | Phase 0 |
| **Phase 2** | M09-M11 실행 단계 모듈 | 2주 | 5 | Phase 1 |
| **Phase 3** | M12 UI + SSE 통합 | 1주 | 4 | Phase 2 |
| **Phase 4** | 자동화 루프 5개 통합 | 1주 | 5 | Phase 3 |
| **Phase 5** | 강화 + 학습 + 측정 | 2주 | 6 | Phase 4 |

### 7.2 상세 WP 목록

```
Phase 0 — 기반 스키마 (5 WP)
  WP-MPO-001  contracts/harness/intake.schema.json 확장 (6→11 필드)       P0  3h
  WP-MPO-002  contracts/harness/wp-dag.schema.json 신규                    P0  3h
  WP-MPO-003  contracts/harness/output.schema.json 런타임 강제 설계         P0  4h
  WP-MPO-004  contracts/harness/context-sources.yaml 신규 (4계층 분류)     P0  2h
  WP-MPO-005  contracts/harness/isolation-rules.yaml 신규                   P0  3h

Phase 1 — 계획 모듈 (8 WP)
  WP-MPO-006  M01: Master Input Surface + /api/v1/mpo/plan 엔드포인트       P1  5h
  WP-MPO-007  M02: Intake Normalizer (provider 호출 포함)                   P1  6h
  WP-MPO-008  M03: Goal Decomposer (decomposer-prompt.yaml)                 P1  8h
  WP-MPO-009  M04: Isolation Boundary Engine                                P1  5h
  WP-MPO-010  M05: Context Envelope Builder                                 P1  7h
  WP-MPO-011  M06: Token Budget Allocator                                   P1  3h
  WP-MPO-012  M07: Mode Router 확장 (risk/trust/budget 신호 추가)           P1  5h
  WP-MPO-013  M08: Verification Planner 확장                                P1  4h

Phase 2 — 실행 모듈 (5 WP)
  WP-MPO-014  M09: Execution Orchestrator 강화 (격리 강제 포함)             P1  8h
  WP-MPO-015  M10: Truthfulness Gate + completion-report validator          P1  6h
  WP-MPO-016  M11: Memory Reconciler + wp-complete.js 원자적 트랜잭션        P1  6h
  WP-MPO-017  Provider adapter output schema 런타임 강제                    P1  4h
  WP-MPO-018  Reflexion Loop 자동 에스컬레이션 (WP+ADR 생성)                P1  5h

Phase 3 — UI + SSE (4 WP)
  WP-MPO-019  /api/v1/system/events SSE 엔드포인트                          P2  5h
  WP-MPO-020  Master UI 단일 입력 폼 + 계획 리뷰 화면                       P2  6h
  WP-MPO-021  Master UI 진행 대시보드 (실시간 토큰/진행률)                  P2  6h
  WP-MPO-022  Master UI 완료 화면 + 다음 작업 추천                          P2  3h

Phase 4 — 자동화 (5 WP)
  WP-MPO-023  Loop 1: 저위험 자동 승인                                      P2  3h
  WP-MPO-024  Loop 2: 자동 재계획                                           P2  4h
  WP-MPO-025  Loop 3: 실패 에스컬레이션 (IMP-P1-002 통합)                    P2  4h
  WP-MPO-026  Loop 4: Mode Router 학습 루프 (IMP-P2-001 통합)               P2  8h
  WP-MPO-027  Loop 5: 메모리 동기화 (IMP-P0-003 통합)                       P2  4h

Phase 5 — 강화 (6 WP)
  WP-MPO-028  Behavioral security eval 케이스 5종 추가                      P2  5h
  WP-MPO-029  Live eval metric loop (token/latency/retry)                   P2  6h
  WP-MPO-030  하네스 성능 대시보드 (6개 지표)                                P2  4h
  WP-MPO-031  source/generated 분류 manifest 런타임 반영                    P2  3h
  WP-MPO-032  createServer.js에서 harness surface 분리                      P3  6h
  WP-MPO-033  MPO v1.0 릴리즈 문서 + ADR + 회고                             P3  3h
```

**총**: 33 WP, 약 155시간 (~4주 풀타임 또는 ~8주 반타임).

### 7.3 의존성 그래프 (중요 경로)

```
WP-MPO-001 ─┬─▶ WP-MPO-007 ──▶ WP-MPO-008 ─┐
             │                                │
WP-MPO-002 ─┴─▶ WP-MPO-009 ──▶ WP-MPO-010 ─┼─▶ WP-MPO-014
                                             │
WP-MPO-003 ──▶ WP-MPO-015 ─────────────────┘
                    │
WP-MPO-004 ─────────┴────▶ WP-MPO-031
                    │
WP-MPO-005 ─────────┴────▶ WP-MPO-009

WP-MPO-014 ──▶ WP-MPO-016 ──▶ WP-MPO-019 ──▶ WP-MPO-020
                                                 │
WP-MPO-021 ◀────────────────────────────────────┘
```

---

## 8. 완료 기준 (Definition of Done for MPO v1.0)

### 8.1 기능 기준

```yaml
✅ 사용자 경험:
  - Master UI에 목표 한 줄 입력 → 3~10분 내 완료 화면까지 자동 진행
  - 총 클릭 3번 이하 (입력, 승인, 완료 확인)
  - 진행 중 실시간 토큰/진행률 가시성

✅ 기술 기준:
  - 12개 모듈이 모두 독립 단위 테스트 존재
  - 각 모듈이 계약 스키마를 런타임 검증
  - LLM 호출 모듈(M02, M03, M09)만 토큰 소모, 나머지 9개는 0 토큰
  - 봉투 밖 파일 읽기/쓰기 시도 시 자동 거부

✅ 진실성 기준:
  - PASS 주장에 evidence 없으면 자동 FAIL 처리
  - 동일 실패 3회 반복 시 자동 WP + ADR 초안 생성
  - 메모리 갱신은 원자적 트랜잭션 (부분 갱신 없음)

✅ 성능 기준:
  - 세션 초기 로딩 토큰 < 3,000 (현재 ~10,000)
  - WP 1개 평균 토큰 < 15,000 (현재 ~30,000)
  - Intake Packet 재구성 성공률 > 95%
  - 게이트 첫 통과율 > 80%
```

### 8.2 측정 지표 목표치

| 지표 | 현재 (v0.2.0) | MPO v1.0 목표 |
|------|--------------|---------------|
| 세션 초기 파일 읽기 수 | 12~15개 | 3~5개 |
| WP 1개 평균 토큰 | 미측정 (~30k 추정) | ≤ 15k |
| Master UI 사용자 클릭 수 | 해당 없음 (CLI) | ≤ 3회 |
| Intake Packet 재구성 성공률 | 미측정 | ≥ 95% |
| Reflexion 평균 반복 | 미측정 | ≤ 1.5회 |
| 게이트 첫 통과율 | 미측정 | ≥ 80% |
| Truthfulness Gate 위반 감지율 | 없음 | 100% (결정적) |
| 자동 승인 비율 (Loop 1) | 0% | ≥ 30% (저위험 작업) |
| 메모리 동기화 원자성 | 수동 | 100% 자동 |

---

## 9. 부록 A: 파일 매핑 (무엇을 어디에 만들거나 수정)

### 9.1 신규 파일 (Phase 0~2)

```
contracts/harness/
├── raw-intent.schema.json              (M01)
├── intake.schema.json                  (M02, 기존 확장)
├── wp-dag.schema.json                  (M03, M04, M05)
├── output.schema.json                  (M09, M10, 기존 강제)
├── context-sources.yaml                (M05)
├── isolation-rules.yaml                (M04)
├── decomposer-prompt.yaml              (M03)
└── completion-report.schema.json       (M10)

scripts/
├── intake-normalizer.js                (M02)
├── goal-decomposer.js                  (M03)
├── isolation-boundary.js               (M04)
├── build-context-envelope.js           (M05)
├── allocate-token-budget.js            (M06)
├── validate-completion-report.js       (M10)
├── wp-complete.js                      (M11)
├── check-failure-patterns.js           (Loop 3)
└── mpo-pipeline.js                     (전체 오케스트레이터)

src/server/routes/
├── mpo.js                              (M01, /api/v1/mpo/plan)
└── events.js                           (M12, SSE)

src/infrastructure/mpo/
├── ModuleRegistry.js                   (파이프라인 내부)
└── ContractValidator.js                (INV-01, INV-02 강제)
```

### 9.2 기존 파일 수정

```
CLAUDE.md                                      → 파일 읽기 순서 단일화 (IMP-P0-001 통합)
docs/harness/CONTINUOUS_PROMPT.md              → CLAUDE.md 참조로 축소
requirements/harness-engineering.yaml          → L1 계약 진실원으로 재정비
requirements/validation-profiles.yaml          → terminal profile 추가 (IMP-P1-004 통합)
src/infrastructure/HarnessRuntimeRouter.js     → M07 확장
src/infrastructure/ai/HarnessProviderAdapter.js → output schema 런타임 강제
src/infrastructure/ai/OpenAIResponsesProvider.js → payload 구획화 (trusted/untrusted)
scripts/resolve_validation_profile.js          → M08 확장
scripts/session_bootstrap.js                   → 세션 초기 앵커 3개로 축소
scripts/orchestrate.js                         → M09 강화 (경계 강제)
scripts/verified_auto_commit_guard.js          → M11과 원자적 통합
artifacts/index.html                           → M01 입력 폼 + M12 SSE 클라이언트
master-shell/feature-flags/flags.yaml          → rollout_state vs runtime_exposure 분리
```

### 9.3 기존 IMP 로드맵과의 매핑

| IMP-ID (기존 문서) | MPO WP (본 문서) |
|-------------------|-----------------|
| IMP-P0-001 세션 부트스트랩 단일화 | (CLAUDE.md 수정, Phase 0 준비) |
| IMP-P0-002 Intake Packet 스키마 | WP-MPO-001 |
| IMP-P0-003 WP 완료 원자적 메모리 갱신 | WP-MPO-016, WP-MPO-027 |
| IMP-P1-001 KI-HARNESS-001 제공자 통합 | WP-MPO-017 |
| IMP-P1-002 Reflexion 자동 에스컬레이션 | WP-MPO-018, WP-MPO-025 |
| IMP-P1-004 종료 출력 스키마 강제 | WP-MPO-015 |
| IMP-P2-001 Mode Router 학습 루프 | WP-MPO-026 |
| IMP-P2-004 Master UI SSE 실시간 | WP-MPO-019~022 |
| IMP-P2-005 하네스 성능 대시보드 | WP-MPO-030 |
| GAP-02 output schema 미강제 | WP-MPO-003, WP-MPO-017 |
| GAP-03 Mode router 신호 부족 | WP-MPO-012 |
| GAP-04 payload 구획화 부재 | WP-MPO-007 관련 파일 수정 |
| GAP-05 security behavioral eval 부재 | WP-MPO-028 |
| GAP-11 generated artifact 분류 부재 | WP-MPO-004, WP-MPO-031 |
| GAP-12 createServer.js 과부하 | WP-MPO-032 |

**MPO v1.0은 기존 로드맵의 상위 재구성이며 모든 IMP/GAP을 포함한다.**

---

## 10. 부록 B: 실행 시작 체크리스트

다음 세션 시작 시 이 문서를 기반으로 바로 착수 가능:

```
[ ] 1. 이 문서를 docs/harness/MPO_MASTER_PLAN_V1.md 로 저장 (canonical)
[ ] 2. memory/wp-queue.yaml 에 WP-MPO-001 ~ WP-MPO-005 추가 (Phase 0)
[ ] 3. memory/L0-hot/next-actions.yaml 에 WP-MPO-001 을 priority 1로 설정
[ ] 4. docs/adr/NNNN-mpo-architecture-v1.md ADR 작성
[ ] 5. master-shell/plugin-registry/registry.yaml 에 mpo 플러그인 등록 (rollout=planning)
[ ] 6. 첫 세션에서 WP-MPO-001 부터 시작, IMP-P0-003의 세션 부트스트랩 단일화를 먼저 병행
[ ] 7. Phase 0 완료 후 사용자에게 WP-MPO-006 시작 전 승인 요청
```

---

## 11. 불확실성 및 주의사항

**[확인 필요]**
- M02/M03의 프롬프트 품질이 MPO 전체 성능을 좌우한다. 초기 2주간은 프롬프트 튜닝에 추가 시간이 필요할 수 있다.
- `provider-adapter.yaml` 실제 Claude API 연결이 아직 검증되지 않음 (KI-HARNESS-001). WP-MPO-017 완료까지는 NullProvider fallback으로 실제 LLM 호출 부분은 dry-run으로 시작하는 것을 권장한다.

**[추정]**
- 토큰 절감률 70% / 50% 등의 수치는 설계상 기대치이며, 실측값은 Phase 2 완료 후 Loop 4 학습 데이터로 검증해야 한다.
- 병렬 실행 WP 수(기본 2개)는 Anthropic API rate limit에 따라 조정 필요.

**[결정 필요]**
- M03 Goal Decomposer의 LLM tier를 standard로 했는데, 복잡한 요청에서는 frontier로 upgrade 해야 할 수 있다. Phase 1 중반 A/B 테스트 권장.
- Master UI 자동 승인 기준(Loop 1)의 저위험 정의를 팀 합의로 고정해야 한다.

**[하지 말 것]**
- Phase 0 스키마 없이 Phase 1 모듈 구현 시작 금지. 계약 없이 만들면 재작성 불가피.
- M09 실행 오케스트레이터에 격리 검증을 "나중에" 넣기 금지. 처음부터 포함되어야 의미 있다.
- 기존 `createServer.js`에 MPO 기능을 더 추가하지 말고, 처음부터 `src/server/routes/mpo.js`로 분리해서 시작.

---

## 끝맺음

이 문서는 **Workflow OS my-module 저장소의 프롬프트 하네스를 세계 최고 수준으로 끌어올리는 단일 진실원(Single Source of Truth)이다.**

핵심은 단 한 문장으로 요약된다:

> **"사용자는 한 줄을 쓰고, 시스템은 12개의 격리된 결정적 모듈이 각자의 봉투와 예산 안에서 정확히 할 일만 하며, 증거가 있을 때만 완료를 선언한다."**

Phase 0의 WP-MPO-001부터 시작하면 된다.
