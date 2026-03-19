# Workflow OS — 완벽 사용 가이드

> **한 줄 요약**: 입력 요구사항과 root `memory/` 상태를 맞춘 뒤, 한 번에 하나의 Work Packet으로 저장소를 점진적으로 개선한다.

---

## 목차

1. [한눈에 보기](#1-한눈에-보기)
2. [시스템 구조](#2-시스템-구조)
3. [5분 빠른 시작](#3-5분-빠른-시작)
4. [요구사항 작성 가이드](#4-요구사항-작성-가이드)
5. [자동 생성되는 것들](#5-자동-생성되는-것들)
6. [품질 게이트 상세](#6-품질-게이트-상세)
7. [키워드 명령어 참조](#7-키워드-명령어-참조)
8. [내장된 세계 최고 사례 벤치마크](#8-내장된-세계-최고-사례-벤치마크)
9. [산업별 적용 예시](#9-산업별-적용-예시)
10. [고급 사용법](#10-고급-사용법)
11. [트러블슈팅](#11-트러블슈팅)

---

## 1. 한눈에 보기

```
[사용자]                          [Workflow OS + Claude]
   │                                      │
   │  ① DOMAIN_TEMPLATE.yaml 작성         │
   │  ─────────────────────────────────►  │
   │                                      │  WP 정의 → 실행 → 검증 → 증적 → 상태 갱신
   │  ② memory/ 상태 확인                   │  Stage 의미: A → B → C → D → E
   │  ─────────────────────────────────►  │  현재 route stage와 다음 WP를 판정
   │                                      │  코드·문서·검증을 함께 닫음
   │  ③ npm run project:status            │
   │  ─────────────────────────────────►  │
   │                                      │  → 결과를 worklog + memory에 기록
   │  결과물: 추적 가능한 점진 개선            │
```

**사용자가 하는 일**: 요구사항과 우선순위를 정하고 현재 `memory/` 상태를 확인한다.
**Claude가 하는 일**: 한 번에 하나의 Work Packet을 끝까지 닫는다.

---

## 2. 시스템 구조

### 2.1 저장소 레이아웃

```
my-module/
├── HOW_TO_USE.md                  ← 지금 읽는 파일
├── CLAUDE.md                      ← Claude 자율 실행 프로토콜
│
├── requirements/
│   ├── DOMAIN_TEMPLATE.yaml       ← ★ 요구사항 작성 시작점
│   ├── requirements.yaml          ← 현재 활성 모듈 설정
│   ├── domain-map.yaml            ← 도메인 위치 레지스트리
│   ├── constraints.yaml           ← 아키텍처 제약 (변경 금지)
│   └── nfr.yaml                   ← 비기능 요구사항 기본값
│
├── domains/
│   └── [도메인명]/
│       ├── domain-spec.md         ← 도메인 설계 문서
│       ├── contracts/             ← 4종 계약 (OpenAPI, Events, UI, Capability)
│       ├── src/                   ← 도메인 소스 (domain→application→infrastructure)
│       └── tests/                 ← 단위 + 적대적 테스트
│
├── master-shell/
│   ├── plugin-registry/           ← 플러그인 등록
│   ├── navigation/                ← 네비게이션 구성
│   ├── feature-flags/             ← 기능 플래그 (기본 OFF)
│   └── catalog/                   ← 도메인 카탈로그
│
├── docs/adr/                      ← 아키텍처 결정 기록
├── memory/                        ← Claude 단계간 인수인계 파일
└── worklog/                       ← 실행 이력
```

### 2.2 Stage 사이클과 Work Packet 관계

```
A [요구사항 분석 → 계약 생성]
  ↓ PASS
B [모듈 조합 검증 → 충돌 해소]
  ↓ PASS
C [마스터 쉘 편입 → 플러그인 등록]
  ↓ PASS
D [품질 게이트 — 15가지 검사]
  ↓ PASS
E [적대적 검증 — 경계 케이스 파괴 시도]
  ↓ PASS
  → 메모리 갱신 → feature_flag 활성화 판단 → 보고
  ↓
다음 Work Packet 선택 또는 요구사항 재정렬
```

`D PARTIAL_PASS` → 실패 항목만 수정 → D 재실행
`E GAP 발견` → P0/P1 즉시 수정 → P2/P3 ADR 작성

---

## 3. 5분 빠른 시작

### Step 1: 템플릿 복사

```bash
cp requirements/DOMAIN_TEMPLATE.yaml requirements/my-domain.yaml
```

### Step 2: 필수 4개 필드 채우기 (최소 시작)

```yaml
identity:
  id: "hr"                        # 영문 소문자, 하이픈 허용
  name: "인사관리"
  domain: "hr"
  description: "직원 채용·온보딩·평가·퇴직 관리"

invariants:
  - id: "INV-HR001"
    description: "재직 중인 직원만 평가 대상이다"
    severity: P0

screens:
  - id: "employee-list"
    path: "/hr/employees"
    title: "직원 목록"
    required_permission: "hr.read"
```

### Step 3: 현재 상태 확인

```bash
npm run project:status
```

### Step 4: 현재 Work Packet 진행

```text
memory/current-wp.yaml 확인
memory/wp-queue.yaml 확인
필요한 Work Packet 1개 진행
```

queue가 비어 있으면 root `memory/current-wp.yaml`에 새 packet을 먼저 정의하고,
`npm run wp:reconcile` 결과와 모순되지 않게 진행한다.

---

## 4. 요구사항 작성 가이드

> **핵심 원칙**: "무엇을 해야 하는가"를 적는다. "어떻게"는 Claude가 결정한다.

### 4.1 `identity` — 도메인 정체성

```yaml
identity:
  id: "billing"                   # 시스템 식별자 (영문, 소문자)
  name: "정산관리"                  # 사람이 읽는 이름
  domain: "finance"               # 최상위 도메인
  bounded_context: "billing"      # 경계 컨텍스트 (DDD)
  owner: "finance-team"           # 책임 팀
  description: |                  # 도메인이 해결하는 문제
    인보이스 생성·상태관리·결제 추적·예외처리를 담당한다.
    금액 정합성과 상태 불변조건이 핵심이다.
  risk_level: HIGH                # LOW / MEDIUM / HIGH / CRITICAL
```

**`risk_level` 기준**:
| 수준 | 기준 | 예시 |
|------|------|------|
| CRITICAL | 금전 직접 처리, 규제 직접 적용 | 결제, 원장, 준법감시 |
| HIGH | 금전 간접, 개인정보 핵심 | 정산, 청구, HR |
| MEDIUM | 운영 영향, 일반 개인정보 | 재고, 일정, CRM |
| LOW | 보조 기능, 공개 정보 | 공지, FAQ, 대시보드 |

`risk_level`이 높을수록 Claude는 더 엄격한 불변조건·보안·감사 로그를 자동 적용한다.

---

### 4.2 `ubiquitous_language` — 유비쿼터스 언어 (핵심!)

> **DDD 원칙**: 개발자와 비즈니스가 같은 단어를 사용해야 한다. 이 목록이 코드의 변수명·클래스명이 된다.

```yaml
ubiquitous_language:
  - term: "Invoice"
    korean: "인보이스"
    definition: "청구 문서. 라인 항목 합산이 총액과 일치해야 한다."
    aggregate_root: true           # 이 용어가 집계 루트인가?

  - term: "LineItem"
    korean: "라인 항목"
    definition: "인보이스를 구성하는 개별 청구 항목. 수량 × 단가 = 금액."

  - term: "Payment"
    korean: "결제"
    definition: "인보이스에 대한 실제 금액 이전."
```

**팁**: 기획서·화면 설계서에 나오는 모든 명사를 여기에 나열하라. Claude가 이 언어로 코드를 생성한다.

---

### 4.3 `invariants` — 불변조건 (가장 중요!)

> **원칙**: 절대 위반해서는 안 되는 비즈니스 규칙. 이것이 테스트의 중심이 된다.

```yaml
invariants:
  - id: "INV-001"                 # 유니크 ID (도메인 접두사 권장)
    description: "총액은 라인 항목 합산과 항상 같아야 한다"
    severity: P0                  # P0(치명)/P1(높음)/P2(중간)/P3(낮음)
    enforcement: "domain-entity"  # domain-entity / use-case / repository / ui
    test_required: true           # Stage D에서 반드시 검증

  - id: "INV-002"
    description: "결제 완료 인보이스는 삭제할 수 없다"
    severity: P0
    enforcement: "repository"

  - id: "INV-003"
    description: "관리자 승인 없이 분쟁 인보이스를 결제완료로 전환할 수 없다"
    severity: P1
    enforcement: "use-case"
    audit_required: true          # 이 불변조건 위반 시도는 감사 로그에 기록
```

**심각도 기준**:
| 수준 | 의미 | Claude 처리 |
|------|------|------------|
| P0 | 위반 시 데이터 손상·금전 손실 | 즉시 수정, Stage D 재실행 |
| P1 | 위반 시 계약·보안 오류 | 수정 + ADR |
| P2 | 비즈니스 규칙 미준수 | 문서화 + next-actions |
| P3 | 구조적 개선 사항 | ADR 결정 |

---

### 4.4 `permissions` — 권한 모델

```yaml
permissions:
  roles:
    - id: "hr.read"
      description: "직원 정보 조회"
      actions: ["list-employees", "view-employee-detail", "view-org-chart"]

    - id: "hr.write"
      description: "직원 정보 수정"
      actions: ["create-employee", "update-employee", "change-department"]

    - id: "hr.admin"
      description: "민감 HR 작업 (급여·평가·퇴직)"
      actions: ["view-salary", "conduct-review", "terminate-employee"]
      audit_all_actions: true     # 모든 행동 감사 로그 필수
```

**권한 설계 팁**:
- `읽기 / 쓰기 / 관리자` 3단계가 기본
- 금전·개인정보 접근은 별도 권한으로 분리
- `audit_all_actions: true`면 Claude가 감사 로그 코드를 자동 추가

---

### 4.5 `screens` — 화면 요구사항

```yaml
screens:
  - id: "employee-list"
    path: "/hr/employees"
    title: "직원 목록"
    required_permission: "hr.read"
    must:                         # 반드시 구현
      - "직원 목록 조회"
      - "부서·직급·재직상태 필터"
      - "검색 (이름·사번)"
    should:                       # 구현 권장
      - "엑셀 내보내기"
    must_not:                     # 절대 금지
      - "급여 정보 노출 (hr.admin 없이)"

  - id: "employee-detail"
    path: "/hr/employees/:id"
    title: "직원 상세"
    required_permission: "hr.read"
    conditional_fields:
      - field: "salary"
        required_permission: "hr.admin"
        rationale: "급여는 관리자만 조회 가능"
```

---

### 4.6 `domain_events` — 도메인 이벤트

```yaml
domain_events:
  - name: "EmployeeHired"
    trigger: "신규 직원 등록 완료"
    payload: ["employee_id", "hire_date", "department_id", "position_id"]
    subscribers: ["payroll", "access-management", "onboarding"]

  - name: "EmployeeTerminated"
    trigger: "퇴직 처리 완료"
    payload: ["employee_id", "termination_date", "reason_code"]
    subscribers: ["payroll", "access-management", "asset-management"]
    severity: HIGH               # 이 이벤트는 실패 시 반드시 재시도
    idempotent: true             # 중복 발행 시 부작용 없어야 함
```

---

### 4.7 `risk` — 위험 분류 (금융/규제 도메인 핵심)

```yaml
risk:
  classification: "confidential"  # public / internal / confidential / restricted
  regulatory_scope:
    - "GDPR"                      # 개인정보: EU GDPR
    - "개인정보보호법"              # 국내 개인정보보호법
    - "근로기준법"                  # 노동 관련 규정

  data_sensitivity:
    pii_fields:                   # 개인식별정보 필드 목록
      - "employee_name"
      - "resident_number"
      - "bank_account"
    encryption_required: true     # 암호화 필수
    retention_years: 5            # 보존 기간

  audit_trail:
    enabled: true
    immutable: true               # 감사 로그는 수정·삭제 불가
    fields: ["actor_id", "action", "before_state", "after_state", "timestamp", "ip_address"]

  financial_risk:                 # 금전 처리 도메인의 경우
    double_entry: false           # 복식부기 적용 여부
    amount_limit_per_tx: null     # 단일 거래 한도 (null = 무제한)
    reconciliation_required: false
```

---

### 4.8 `slo` — 서비스 수준 목표

```yaml
slo:
  # Google SRE 방식 — Error Budget 기반
  availability:
    target_percent: 99.9          # 월 43분 다운타임 허용
    measurement_window: "30d"

  latency:
    p50_ms: 100
    p99_ms: 300
    p999_ms: 1000                 # 최악의 경우

  error_rate:
    target_percent: 0.1           # 0.1% 이하 에러율

  throughput:
    peak_rps: 100                 # 피크 초당 요청 수

  # DORA 지표 (개발팀 생산성)
  dora:
    deployment_frequency: "weekly"  # daily/weekly/monthly
    lead_time_for_changes: "days"   # hours/days/weeks
    change_failure_rate: 5          # % (업계 평균 15%)
    mttr_hours: 1                   # 평균 복구 시간
```

---

### 4.9 `security` — 보안 요구사항 (OWASP ASVS)

```yaml
security:
  # OWASP Application Security Verification Standard
  asvs_level: 2                  # 1(기본)/2(표준)/3(고급)

  authentication:
    required: true
    mfa_required: false           # HIGH/CRITICAL 도메인 권장
    session_timeout_minutes: 30

  authorization:
    model: "RBAC"                 # RBAC/ABAC/ReBAC
    principle: "least-privilege"

  input_validation:
    sanitize_all_inputs: true
    max_field_length: 2000
    sql_injection_prevention: true
    xss_prevention: true

  data_protection:
    encryption_at_rest: false     # CRITICAL 도메인은 true
    encryption_in_transit: true   # 항상 TLS
    masking_in_logs: true        # 로그에서 민감정보 마스킹

  rate_limiting:
    enabled: true
    requests_per_minute: 1000
```

---

### 4.10 `integrations` — 외부 의존성

```yaml
integrations:
  depends_on:
    - domain: "identity"
      purpose: "사용자 인증·권한 확인"
      contract: "domains/identity/auth/contract/capability.yaml"
      coupling: "loose"          # loose(계약 참조) / tight(금지)

    - domain: "payroll"
      purpose: "급여 정보 동기화"
      contract: "domains/payroll/contract/events.schema.json"
      coupling: "loose"
      integration_pattern: "event-driven"  # sync/async/event-driven

  provides_to:
    - domain: "payroll"
      contract: "domains/hr/contracts/events.schema.json"
      events: ["EmployeeHired", "EmployeeTerminated", "SalaryChanged"]
```

---

## 5. 자동 생성되는 것들

요구사항 파일 하나로 Claude가 생성하는 전체 목록:

### Stage A — 계약 + 설계 (4~8개 파일)

| 파일 | 내용 |
|------|------|
| `domains/[도메인]/domain-spec.md` | 도메인 설계 문서 (유비쿼터스 언어, 불변조건, 권한, 상태 전이도) |
| `contracts/openapi.yaml` | OpenAPI 3.0 계약 (모든 엔드포인트) |
| `contracts/events.schema.json` | 도메인 이벤트 JSON Schema |
| `contracts/ui-contract.yaml` | UI 화면 계약 (컴포넌트, 권한, 데이터 흐름) |
| `contracts/capability.yaml` | 기능 선언 + 불변조건 ID 목록 |
| `memory/stageA/[도메인].yaml` | Stage A 완료 기록 (다음 단계 인수인계) |

### Stage B — 조합 검증 (기존 파일 갱신)

| 파일 | 내용 |
|------|------|
| `requirements/domain-map.yaml` | 새 도메인 경로 등록 |
| `memory/stageB/[도메인].yaml` | 라우트·권한 충돌 검사 결과 |

### Stage C — 마스터 쉘 편입 (기존 파일 갱신)

| 파일 | 내용 |
|------|------|
| `master-shell/plugin-registry/registry.yaml` | 플러그인 등록 (기본 비활성) |
| `master-shell/navigation/nav.yaml` | 네비게이션 메뉴 추가 |
| `master-shell/feature-flags/flags.yaml` | Feature Flag 추가 (기본 false) |
| `master-shell/catalog/domains.yaml` | 도메인 카탈로그 등록 |

### Stage D — 소스 구현 (15~40개 파일)

#### 도메인 레이어 (`src/domain/`)
- `value-objects/` — Money, Status, ID 등 값 객체
- `entities/` — 집계 루트 엔티티 (불변 패턴)
- `services/` — 도메인 서비스 (복수 집계 관련 로직)
- `events/` — 도메인 이벤트 생성자

#### 애플리케이션 레이어 (`src/application/`)
- `[Action]UseCase.js` — 유스케이스별 1파일 (CRUD + 도메인 행동)
- `ports/` — 포트 인터페이스 (Repository, Publisher)

#### 인프라 레이어 (`src/infrastructure/`)
- `InMemory[Entity]Repository.js` — 테스트용 인메모리 구현체

#### 인터페이스 레이어 (`src/interface/`)
- `[Domain]Controller.js` — HTTP 핸들러 + 권한 미들웨어 + 직렬화

#### 테스트 (`tests/`)
- `domain/` — 엔티티·값객체 단위 테스트 (불변조건 강제 검증)
- `application/` — 유스케이스 통합 테스트
- `adversarial/stageE_adversarial.test.js` — 경계 케이스 파괴 테스트
- `interface/[Domain]Controller.test.js` — authz regression 테스트

### Stage E — 적대적 검증 결과물

| 산출물 | 내용 |
|--------|------|
| 갭 발견 보고 | P0~P3 심각도 분류 |
| 즉시 수정 | P0/P1 코드 수정 + 테스트 추가 |
| `docs/adr/[번호]-[제목].md` | P3 구조 결정 ADR |
| root `memory/` 갱신 | current-state, current-wp, next-actions, checkpoint 최신화 |

---

## 6. 품질 게이트 상세

Stage D에서 자동 실행되는 15가지 검사:

### 6.1 정확성 (Correctness)

| 검사 | 명령 | 기준 |
|------|------|------|
| 단위 테스트 | `node --test 'domains/**/*.test.js'` | 0 FAIL |
| 불변조건 테스트 | 각 INV-XXX별 테스트 존재 확인 | 100% 커버 |
| 계약 테스트 | OpenAPI 스키마 검증 | NOT_CONFIGURED 허용 |
| E2E 스모크 | 핵심 경로 흐름 | NOT_CONFIGURED 허용 |

### 6.2 코드 품질 (Code Health)

| 검사 | 도구 | 기준 |
|------|------|------|
| 린트 | ESLint 10.x | 0 errors |
| 문법 검사 | `node --check` | 오류 없음 |
| 정적 분석 | ESLint rules | 0 errors |
| 타입 검사 | NOT_CONFIGURED | Phase 2 |

### 6.3 보안 (Security)

| 검사 | 방법 | 기준 |
|------|------|------|
| 시크릿 스캔 | grep 패턴 매칭 | 0건 |
| 의존성 스캔 | 외부 의존 확인 | 0개 (도메인 코어) |
| authz regression | 권한별 403 확인 | 100% PASS |
| 입력 검증 | 불변조건 INV-XXX | 모든 경계 커버 |

### 6.4 공급망 (Supply Chain) — Phase 2

| 검사 | 기준 |
|------|------|
| SBOM 생성 | SPDX/CycloneDX 형식 |
| 빌드 증명 | SLSA Level 1 |
| 롤백 검증 | 이전 버전 복구 가능 |
| 관찰가능성 | RED 지표 + 구조화 로그 |

### 6.5 게이트 판정 기준

```
PASS         = 필수 게이트 전체 PASS
PARTIAL_PASS = 필수 PASS + NOT_CONFIGURED 허용 (Phase 2 항목)
FAIL         = 필수 게이트 1개 이상 FAIL
```

**feature_flag 활성화 조건**: Stage D `PASS` (NOT_CONFIGURED 0개)

---

## 7. 키워드 명령어 참조

| 입력 | Claude 행동 | 소요 시간 |
|------|------------|----------|
| `npm run project:status` | 저장소 전체 Stage/Work Packet 상태를 JSON으로 확인 | 짧다 |
| `npm run stage:a` | Stage A 진입 가능 여부와 권장 명령 확인 | 짧다 |
| `npm run stage:d` | Stage D readiness와 권장 게이트 확인 | 짧다 |
| `memory/current-wp.yaml` 확인 | 현재 진행 패킷의 범위와 검증 기준 확인 | 짧다 |
| `memory/wp-queue.yaml` 확인 | 다음 우선순위 패킷 확인 | 짧다 |

### 예시 시나리오

```
# 시나리오 1: 현재 저장소 상태 확인
사용자: npm run project:status
Claude: [현재 route stage, current_wp, next_wp, manual placeholder 확인]

# 시나리오 2: 특정 Stage readiness 확인
사용자: npm run stage:d
Claude: [prerequisite, 권장 검증 명령, 참조 문서 확인]

# 시나리오 3: 다음 작업 결정
사용자: memory/current-wp.yaml / memory/wp-queue.yaml 확인
Claude: [한 번에 하나의 Work Packet 범위로 진행]
```

---

## 8. 내장된 세계 최고 사례 벤치마크

Claude가 요구사항으로부터 코드를 생성할 때 자동으로 적용하는 패턴:

### 8.1 도메인 설계 (DDD)

| 패턴 | 출처 | 적용 |
|------|------|------|
| Aggregate Root | Eric Evans «Domain-Driven Design» | 엔티티 설계 |
| Value Object | Vaughn Vernon «IDDD» | Money, Status, ID |
| Domain Event | Event Storming (Brandolini) | 도메인 이벤트 |
| Repository Pattern | DDD | 포트/어댑터 |
| Anti-Corruption Layer | DDD | 외부 시스템 통합 |
| Bounded Context | DDD | 도메인 경계 |
| Ubiquitous Language | DDD | 코드 네이밍 |

### 8.2 아키텍처 (Clean Architecture)

| 패턴 | 출처 | 적용 |
|------|------|------|
| Hexagonal Architecture | Alistair Cockburn | 포트/어댑터 분리 |
| Dependency Inversion | SOLID | 도메인이 인프라 모름 |
| CQRS (Command/Query) | Greg Young | 유스케이스 분리 |
| Immutable Entities | FP 원칙 | 엔티티 불변 패턴 |
| Contract-First | OpenAPI 원칙 | 계약 먼저 설계 |

### 8.3 보안 (Security)

| 패턴 | 출처 | 적용 |
|------|------|------|
| Least Privilege | NIST 800-53 | 권한 최소화 |
| Defense in Depth | NIST CSF | 다층 권한 검사 |
| OWASP ASVS Level 1 | OWASP | 입력 검증, authz |
| Zero Trust | BeyondCorp (Google) | 모든 요청 검증 |
| Fail Secure | 보안 원칙 | 오류 시 거부 |
| Audit Immutability | SOX, Basel III | 감사 로그 불변 |

### 8.4 품질 (Quality Engineering)

| 패턴 | 출처 | 적용 |
|------|------|------|
| Property-Based Testing | QuickCheck 원칙 | 불변조건 경계 테스트 |
| Adversarial Testing | Netflix Chaos Eng | Stage E |
| Contract Testing | Pact.io | 계약 회귀 테스트 |
| Test Pyramid | Martin Fowler | 단위>통합>E2E |
| Error Budget | Google SRE Book | SLO 관리 |

### 8.5 금융 리스크 (Finance Risk)

| 패턴 | 출처 | 자동 적용 조건 |
|------|------|--------------|
| 이중 검증 (Dual Control) | Basel III | `risk_level: CRITICAL` |
| 4-eyes Principle | 금융 규제 | `audit_required: true` + admin 권한 |
| Idempotency Key | Stripe API | 결제·금전 유스케이스 |
| Optimistic Locking | ACID 원칙 | 동시성 갭 방어 |
| Reconciliation | 회계 원칙 | `reconciliation_required: true` |
| Immutable Audit Trail | SOX 404, K-IFRS | `audit_trail.immutable: true` |
| Amount Invariant | 재무 정합성 | 금액 집계 불변조건 자동 추가 |

### 8.6 운영 (SRE / DevOps)

| 패턴 | 출처 | 적용 |
|------|------|------|
| RED Metrics | Tom Wilkie | Rate, Error, Duration |
| SLO / Error Budget | Google SRE Book | `slo` 섹션 |
| DORA Metrics | DevOps Research | 배포 빈도·복구 시간 |
| Feature Flags | LaunchDarkly 원칙 | 기본 OFF, 단계적 활성화 |
| Canary Release | Netflix | rollout 정책 (5%→20%→full) |

### 8.7 API 설계

| 패턴 | 출처 | 적용 |
|------|------|------|
| REST Constraints | Fielding 논문 | OpenAPI 계약 |
| Resource Naming | Google API Guide | URL 경로 설계 |
| Pagination | Cursor/Offset | 목록 조회 |
| Versioning | Stripe, GitHub | `/api/v1/` 경로 |
| Error Response | RFC 7807 | 표준 오류 포맷 |
| Idempotency | RFC 7231 | POST 재시도 안전 |

---

## 9. 산업별 적용 예시

### 9.1 핀테크 / 금융

```yaml
identity:
  id: "payment-gateway"
  risk_level: CRITICAL

invariants:
  - id: "INV-PAY001"
    description: "결제 금액은 0보다 커야 한다"
    severity: P0
  - id: "INV-PAY002"
    description: "동일 idempotency_key의 결제는 1번만 처리된다"
    severity: P0
  - id: "INV-PAY003"
    description: "결제 완료 후 환불은 별도 트랜잭션으로만 처리한다"
    severity: P1

risk:
  financial_risk:
    double_entry: true
    reconciliation_required: true
    amount_limit_per_tx: 10000000  # 1천만원 한도
  regulatory_scope: ["전자금융거래법", "PCI-DSS"]
  audit_trail:
    enabled: true
    immutable: true

security:
  asvs_level: 3
  authentication:
    mfa_required: true
```

### 9.2 HR / 인사관리

```yaml
identity:
  id: "hr"
  risk_level: HIGH

invariants:
  - id: "INV-HR001"
    description: "재직 중인 직원만 평가 대상이다"
    severity: P0
  - id: "INV-HR002"
    description: "급여 정보는 hr.admin 권한자만 조회한다"
    severity: P1
    audit_required: true

risk:
  data_sensitivity:
    pii_fields: ["employee_name", "resident_number", "bank_account", "salary"]
    encryption_required: true
    retention_years: 5
  regulatory_scope: ["개인정보보호법", "근로기준법", "GDPR"]
```

### 9.3 커머스 / 재고

```yaml
identity:
  id: "inventory"
  risk_level: MEDIUM

invariants:
  - id: "INV-INV001"
    description: "재고 수량은 0 미만이 될 수 없다"
    severity: P0
  - id: "INV-INV002"
    description: "예약된 재고는 주문 취소 전까지 차감 불가"
    severity: P1

domain_events:
  - name: "StockDepleted"
    trigger: "재고 0 도달"
    payload: ["product_id", "warehouse_id"]
    subscribers: ["purchasing", "notification"]
    severity: HIGH
```

### 9.4 고객지원 / CRM

```yaml
identity:
  id: "support"
  risk_level: MEDIUM

invariants:
  - id: "INV-SUP001"
    description: "해결된 티켓은 담당자 변경 불가"
    severity: P1
  - id: "INV-SUP002"
    description: "SLA 초과 시 자동 에스컬레이션한다"
    severity: P2

slo:
  custom:
    - name: "first_response_time"
      target_minutes: 60
      description: "최초 응답 1시간 이내"
    - name: "resolution_time"
      target_hours: 24
      description: "해결 24시간 이내"
```

---

## 10. 고급 사용법

### 10.1 여러 도메인 순서대로 추가

```yaml
# memory/wp-queue.yaml 예시
queue:
  - id: "WP-HR-STAGE-A"
    priority: 1
    goal: "hr 도메인 Stage A 입력과 계약 초안을 만든다"
  - id: "WP-PAYROLL-STAGE-A"
    priority: 2
    goal: "payroll 도메인 Stage A 입력과 계약 초안을 만든다"
  - id: "WP-EXPENSE-STAGE-A"
    priority: 3
    goal: "expense 도메인 Stage A 입력과 계약 초안을 만든다"
```

한 번에 여러 도메인을 동시에 실행하지 않는다. `memory/wp-queue.yaml`에서 우선순위를 주고, Claude는 한 번에 하나의 Work Packet만 닫는다.

### 10.2 기존 도메인 요구사항 변경

기존 도메인 요구사항이 바뀌면 해당 도메인을 위한 새 Work Packet을 queue에 추가한다.

예:

```yaml
- id: "WP-HR-REQ-UPDATE"
  priority: 1
  goal: "hr 도메인 불변조건 변경을 requirements와 계약에 반영한다"
```

Claude는 기존 파일을 읽고 변경분만 반영한다. 삭제나 구조 변경이 필요하면 별도 packet으로 분리한다.

### 10.3 특정 게이트만 재실행

```bash
npm run stage:d
npm run test:e2e-smoke
npm run test:contract
```

Stage readiness는 `npm run stage:d`로 확인하고, 실제 재실행은 필요한 gate 명령만 직접 실행한다.

### 10.4 ADR (아키텍처 결정) 직접 지시

```
# 구조적 결정이 필요할 때
사용자: billing 도메인에서 결제 재시도 정책을 3회로 결정해줘
Claude: [ADR 작성 → next-actions 갱신]
```

### 10.5 `risk_level`에 따른 자동 강화

| `risk_level` | 자동 추가되는 것 |
|--------------|---------------|
| LOW | 기본 불변조건, 표준 권한 검사 |
| MEDIUM | + 입력 검증 강화, authz 회귀 테스트 확대 |
| HIGH | + 감사 로그, PII 필드 마스킹, OWASP ASVS L2 |
| CRITICAL | + MFA 요구, 이중 승인, 낙관적 잠금, 금액 한도 불변조건, ASVS L3 |

---

## 11. 트러블슈팅

### Q: Claude가 멈추고 승인을 요청한다

**원인**: 멈추는 조건 중 하나에 해당:
- requirements.yaml 변경 필요
- 기존 코드 삭제 필요
- 보안 정책 변경 필요
- 테스트 3회 실패

**해결**: Claude의 설명을 읽고 명시적으로 승인 또는 대안 지시

---

### Q: 테스트가 계속 실패한다

구체적 실패 명령과 오류를 같이 남기는 것이 가장 빠르다.

```text
billing 도메인 테스트 오류: [오류 메시지]
실행 명령: npm test
```

또는 현재 상태를 먼저 확인한다:

```bash
npm run project:status
```

---

### Q: Stage D가 PARTIAL_PASS에서 벗어나지 않는다

`NOT_CONFIGURED` 항목들은 HTTP 프레임워크, CI/CD, 외부 서비스 연동 후 해소된다. 현재 단계에서는 정상.

전체 PASS 조건:
1. `TaskController.js` / `BillingController.js` 구현 완료
2. CI/CD 파이프라인 구성 (GitHub Actions 등)
3. 실제 DB 연동 후 통합 테스트

---

### Q: 새 요구사항을 추가하고 싶다

1. `DOMAIN_TEMPLATE.yaml`을 복사해서 채운다
2. `requirements/requirements.yaml`과 관련 memory 상태를 맞춘다
3. `npm run project:status`로 현재 route와 다음 WP를 확인한다

기존 도메인에 기능 추가는:
1. 해당 `requirements/` 파일에 내용 추가
2. 관련 Work Packet을 새로 정의하거나 queue 우선순위를 조정한다

---

### Q: 상태가 헷갈린다

```bash
npm run project:status
```

그리고 아래 파일을 순서대로 읽는다.

1. `memory/current-state.yaml`
2. `memory/current-wp.yaml`
3. `memory/next-actions.yaml`

---

## 참고 문헌 (벤치마크 출처)

| 분야 | 자료 |
|------|------|
| DDD | Eric Evans, «Domain-Driven Design» (2003) |
| DDD 구현 | Vaughn Vernon, «Implementing Domain-Driven Design» (2013) |
| Clean Architecture | Robert C. Martin, «Clean Architecture» (2017) |
| Microservices | Sam Newman, «Building Microservices» (2015/2021) |
| SRE | Google, «Site Reliability Engineering» (2016) |
| 금융 리스크 | Basel III Framework (2010/2017), BIS |
| 보안 | OWASP ASVS 4.0, NIST SP 800-53 |
| 공급망 보안 | SLSA Framework (Google), SSDF (NIST) |
| API 설계 | Google API Design Guide, Stripe API Docs |
| Event Storming | Alberto Brandolini (2013) |
| C4 모델 | Simon Brown (2018) |
| DORA | DORA Research Program (Google Cloud) |
| Feature Flags | Pete Hodgson, «Feature Toggles» (Martin Fowler Blog) |
| 국내 법령 | 개인정보보호법, 전자금융거래법, 근로기준법 |
