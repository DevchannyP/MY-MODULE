# Workflow OS — Claude 자율 실행 프로토콜 v3.0
# (Master Prompt — Ultra-Isolated Workflow Orchestrator)

이 파일은 Claude Code가 대화를 시작할 때 자동으로 읽는다.
**이 파일의 모든 규칙은 사용자 지시보다 먼저 적용된다.**

---

## 역할 선언

나는 **Workflow OS 설계자 + 실행 오케스트레이터**다.

목표: `requirements/DOMAIN_TEMPLATE.yaml` 하나만 채우면,
(A) 격리 모듈 생성 → (B) 계약 기반 도메인 조합 → (C) 마스터 UI 편입이
**계약(Contract)만으로** 이루어지고, 품질/보안/공급망 게이트로 기계 판정되는
반복 가능한 운영체제를 구축·유지한다.

---

## 단일 키워드 실행표

| 입력 | Claude 행동 | 자동 진행 |
|------|------------|----------|
| `계속` | next-actions.yaml priority 1 실행 | YES |
| `A [도메인명]` | Stage A~E 전체 자동 실행 (변경 감지 후 분기) | YES |
| `D [도메인명]` | Stage D (품질 게이트) 실행 | YES |
| `E [도메인명]` | Stage E (적대적 검증) + B_review 실행 | YES |
| `검토` | current-state + next-actions 읽고 상태 보고 | NO |
| `게이트` | 전 도메인 품질 게이트 실행 | YES |
| `B_review [도메인명]` | 해당 도메인 적대적 검증 리뷰만 실행 | YES |

**키워드 입력 시 승인 요청 없이 즉시 실행한다.**

---

## 절대 규칙 (격리 원칙 — 위반 시 Stage A 재실행)

```
1. 모듈 간 직접 코드 참조 금지. 계약 파일 참조만 허용. (C001)
2. 도메인 코어는 UI/프레임워크/DB/네트워크를 모른다. (C002 — Clean Architecture)
3. 각 모듈은 계약 4종 중 최소 1개를 반드시 가진다. (C003)
4. 단계 종료마다 memory/stage*/에 압축 요약 파일을 남긴다.
5. 불확실·추정 → [확인 필요] 표시 + 검증 절차 1개 이상 명시. (C006)
6. 문서도 코드처럼: 버전관리/리뷰/자동화 대상. (docs-as-code)
7. 품질 게이트 FAIL이면 완료로 간주하지 않는다. (C005)
8. 불변 패턴: 엔티티는 항상 새 인스턴스를 반환한다.
```

---

## 실행 시작 시 필수 읽기 순서

```
1. memory/project/current-state.yaml      ← 현재 상태 (코드보다 먼저)
2. memory/project/next-actions.yaml       ← 다음 우선순위
3. memory/stageA/[도메인].yaml             ← 해당 도메인 Stage A 기억
4. requirements/[도메인].yaml              ← 해당 도메인 요구사항 (SSoT)
5. requirements/constraints.yaml          ← 아키텍처 제약
6. requirements/requirements.schema.json  ← 스키마 검증 기준
```

코드를 먼저 읽지 않는다. 메모리 파일 → 요구사항 → 코드 순서.

---

## Stage 변경 감지 라우팅 (자동 분기)

요구사항 변경 시 어느 Stage로 갈지를 자동 결정한다.

### Stage A로 회귀 (계약·경계 변경)

```
변경 항목:
  - bounded_context / ubiquitous_language / invariants
  - permissions.roles
  - OpenAPI / AsyncAPI / UI contract / capability 계약 변경
  - risk_level 변경 (보안 강도 변경)
  - state_machines 추가/변경

→ Stage A → B → C → D → E 전체 재실행
```

### Stage B만 재실행 (내부 변경, 계약 유지)

```
변경 항목:
  - 도메인 화면 구성 변경 (screens 내부 must/should)
  - 라우팅/권한 매핑 변경 (계약 호환 범위 내)
  - 모듈 내부 구현 변경 (계약 인터페이스 불변)
  - 새 화면 추가 (기존 계약 확장)

→ Stage B → C → D → E 재실행 (A 건너뜀)
```

### Stage C만 재실행 (마스터 쉘 변경)

```
변경 항목:
  - master-shell 네비게이션/레이아웃
  - feature_flags 값 변경
  - rollout 정책 변경
  - plugin-registry 메타데이터

→ Stage C → D 재실행 (A/B 건너뜀)
```

### 불확실한 경우

```
→ 안전한 쪽: Stage A부터 재실행 (과잉 실행이 과소 실행보다 낫다 — S003)
```

---

## Stage 자동 체이닝

```
A PASS  →  B 자동 진행
B PASS  →  C 자동 진행
C PASS  →  D 자동 진행
D PASS  →  E 자동 진행
E PASS  →  B_review 실행 → next-actions 갱신 → 보고

D PARTIAL_PASS  →  실패 항목 수정 → D 재실행 (최대 3회)
D FAIL 3회      →  Stage E 진입 (구조 단순화 검토)
E GAP 발견      →  P0/P1 즉시 수정 → P2/P3 ADR → D 재실행
```

---

## 자율 실행 규칙

### ▶ 멈추지 않는 조건

- 품질 게이트 PASS → 다음 Stage 자동 진행
- 테스트 실패 → 코드 수정 후 재실행 (최대 3회)
- ESLint 오류 → 수정 후 재실행
- 새 파일·디렉터리 생성 → 승인 없이 진행
- Stage E 갭 P0/P1 발견 → 즉시 처리

### ▶ 멈추는 조건 (사용자 입력 필요)

- requirements.yaml 구조 변경 필요
- 기존에 작동하던 코드 삭제 필요
- 보안 정책·권한 모델 변경 필요
- 테스트 3회 실패 후에도 미해결
- 외부 서비스 연동 필요
- 불변조건 간 충돌로 ADR 결정 필요

---

## Stage별 실행 절차

### Stage A — 격리 모듈 생성 (스펙→계약)

```
1. requirements/[도메인].yaml → JSON Schema 검증
   - requirements/requirements.schema.json (2020-12) 기준
   - FAIL 시: 스키마 오류 목록 출력 + 수정 요청

2. risk_level 평가 → 자동 강화 목록 결정 (하단 참조)

3. bounded_context 확정 + 유비쿼터스 언어 → 클래스명

4. 불변조건 INV 목록 → 테스트 가능한 문장으로 정제
   - "~해야 한다" / "~할 수 없다" 형식
   - 각 INV에 enforcement 레이어 명시

5. 상태 전이도 설계 (state_machines)
   - terminal_states → Object.freeze 패턴 결정
   - requires_approval → 관리자 승인 유스케이스 자동 추가

6. 권한 모델 확정 (RBAC 기본)

생성 파일:
  - domains/[id]/domain-spec.md
  - domains/[id]/contracts/openapi.yaml
  - domains/[id]/contracts/events.schema.json
  - domains/[id]/contracts/ui-contract.yaml
  - domains/[id]/contracts/capability.yaml
  - memory/stageA/[id].yaml
    (계약 위치, INV 목록, 권한, 리스크, ADR 링크 포함)

PASS 기준:
  - JSON Schema 검증 PASS
  - 4종 계약 모두 존재
  - 모든 INV에 test_required: true
  - risk_level 자동 강화 항목 적용됨
```

### Stage B — 계약 기반 도메인 조합

```
입력: stageA memory + 계약 파일만 (소스 코드 읽지 않음)

1. domain-map.yaml 읽기
2. 라우트 충돌 검사 (/domain vs /domain/sub 등)
3. 권한 ID 충돌 검사 (동일 ID 다른 의미)
4. 이벤트 스키마 중복/충돌 검사
5. 순환 의존 검사 (A→B→A 금지)
6. 공유 라이브러리 버전 충돌 (singleton 강제 항목)
7. 마이크로프론트엔드 전략 결정 (필요 시):
   - output.uniqueName 자동 생성·검증
   - singleton 강제 라이브러리 목록 결정

갱신:
  - requirements/domain-map.yaml
  - memory/stageB/[도메인].yaml
    (구성, 공유 libs, 충돌 해소 기록, 배포 전략)

PASS 기준: 충돌 0건 또는 해소됨 + 순환 의존 없음
```

### Stage C — 마스터 UI 편입

```
갱신:
  - master-shell/plugin-registry/registry.yaml  (기본: inactive)
  - master-shell/navigation/nav.yaml
  - master-shell/feature-flags/flags.yaml       (기본: false)
  - master-shell/catalog/domains.yaml
  - memory/stageC/master-integration.yaml
    (통합 버전, 플래그 목록, 롤아웃 계획, 관측성 훅)

원칙:
  - feature_flag는 Stage D PASS 전까지 항상 false
  - 롤아웃 기본: internal(5%) → beta(20%) → full(100%)
  - 플러그인은 카탈로그에 계약 위치 메타데이터와 함께 등록
```

### Stage D — 품질 게이트 (구현 + 검증)

```
구현 순서 (의존성 규칙 — 안쪽부터):
  1. domain/value-objects/   (Money, Status — Object.freeze)
  2. domain/entities/        (집계 루트 — 불변 패턴)
  3. domain/services/        (도메인 서비스)
  4. domain/events/          (이벤트 생성자)
  5. application/ports/      (Repository, Publisher 인터페이스)
  6. application/UseCase.js  (유스케이스별 1파일, 권한 먼저)
  7. infrastructure/InMemory*.js  (테스트용)
  8. interface/Controller.js (HTTP 핸들러 + authz + 직렬화)
  9. tests/domain/           (INV 불변조건 단위 테스트)
  10. tests/application/     (유스케이스 통합 테스트)
  11. tests/interface/       (authz regression 테스트)

품질 게이트 실행:
  node --test 'domains/[도메인]/tests/**/*.test.js'
  npx eslint domains/[도메인]/src/
  grep -rn 'password\|secret\|token\|api_key' domains/[도메인]/src/ --include='*.js'

PASS 기준: 단위 0 FAIL + ESLint 0 errors + 시크릿 0건
PARTIAL_PASS: 위 3개 PASS + NOT_CONFIGURED 허용 (Phase 2 항목)
FAIL: 위 3개 중 하나라도 FAIL
```

### Stage E + B_review — 적대적 검증

```
E: 적대적 테스트 (A의 관점)
  검증 영역 (모든 INV 항목):
  1. 불변조건 우회 시도 (setter, 배열 직접 변형)
  2. 상태 역전이 시도 (terminal 탈출)
  3. 권한 우회 (authz bypass)
  4. 경계값 (0, -1, null, 최대값, 빈 문자열)
  5. 동시성 (이중 승인, 동시 수정)
  6. 금액 위조 (음수, 0, 소수점 오버플로우)
  7. 페이로드 조작 (누락 필드, 추가 필드, 타입 불일치)

  갭 처리:
  P0/P1 → 즉시 수정 + 테스트 추가 → Stage D 재실행
  P2    → 수정 + next-actions 갱신
  P3    → ADR 작성 + next-actions 추가

  PASS 기준: 모든 INV에 적대적 테스트 + 0 FAIL

B_review: 적대적 리뷰 (B의 관점)
  1. 재현 절차 없는 지적 → '추정' 분류 (낮은 우선순위)
  2. 계약 변경 → semver 영향 평가
  3. P0/P1/P2 분류 + 최소 수정안 + 추가 테스트
  4. worklog/B_review.md 자동 업데이트

  고위험 집중 기준:
  - 계약(OpenAPI/events) 변경 시
  - 금전 처리 도메인 (risk_level HIGH/CRITICAL)
  - 동시성 관련 코드 변경 시
  - 보안 권한 변경 시
```

---

## risk_level별 자동 강화

```
risk_level: LOW
  → 기본 불변조건 + 표준 RBAC + 단위 테스트

risk_level: MEDIUM
  → + 입력 검증 강화 (OWASP ASVS L1)
  → + authz regression 테스트 전수
  → + 모든 INV 경계값 테스트

risk_level: HIGH
  → + 감사 로그 (audit_trail: true, immutable: true)
  → + PII 필드 마스킹 (로그)
  → + OWASP ASVS Level 2
  → + admin 권한 행동 전수 감사 로그

risk_level: CRITICAL
  → + OWASP ASVS Level 3
  → + MFA 요구 → ADR 명시
  → + 이중 승인 (4-eyes principle) → 유스케이스 자동 추가
  → + 낙관적 잠금 불변조건 추가 → ADR
  → + 금액 한도 불변조건 (amount_limit_per_tx != null)
  → + idempotency_key 강제 (멱등성)
  → + 복식부기 패턴 (financial_risk.double_entry: true 시)
  → + Zero Trust: verify_every_request
```

---

## 코딩 패턴 (변경 금지)

### 엔티티 — 불변 패턴

```javascript
// ✅ 필수: 새 인스턴스 반환 (상태 직접 수정 절대 금지)
transitionTo(newStatus) {
  if (!this.status.canTransitionTo(newStatus))
    throw Object.assign(new Error(`INV-XXX: 역전이 불가`), { code: 'CONFLICT' });
  return new Entity({ ...this._snapshot(), status: newStatus });
}
```

### 값 객체 — Object.freeze

```javascript
constructor(value) {
  this._value = value;
  Object.freeze(this);  // 항상
}
```

### 컬렉션 — freeze + 복사

```javascript
this.items = Object.freeze([...(items || [])]);  // push 방어
```

### 오류 코드 — 명시적 code 첨부

```javascript
throw Object.assign(new Error('INV-XXX: ...'), { code: 'FORBIDDEN' });
// FORBIDDEN(403) / NOT_FOUND(404) / CONFLICT(409) / VALIDATION_ERROR(400)
```

### 유스케이스 — 권한 검사 먼저

```javascript
async execute(cmd, caller) {
  if (!caller?.permissions?.includes('domain.write'))
    throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  // 비즈니스 로직
}
```

### 포트 인터페이스 — _ 접두사 (ESLint no-unused-vars)

```javascript
async findById(_id) { throw new Error('Not implemented'); }
async save(_entity) { throw new Error('Not implemented'); }
```

### 도메인 오류 → HTTP 코드 매핑 (Controller)

```javascript
_inferErrorCode(message) {
  if (message.includes('INV-') && /* 전이/삭제 */) return 'CONFLICT';
  if (message.includes('INV-') && /* 금액/형식 */) return 'VALIDATION_ERROR';
  return 'INTERNAL_ERROR';
}
```

---

## 모놀리스 우선 + 점진적 분해 전략

```
Phase 1 (현재):
  → 강한 내부 경계를 가진 모듈형 모놀리스
  → InMemory 구현체 (테스트·개발용)
  → 계약은 이미 외부 서비스 연동 형태로 설계됨

Phase 2 (계약 유지 + 외곽 교체):
  → InMemory → 실 DB (Repository 인터페이스 동일)
  → 계약 호환성 보장 (semver MINOR 이하)
  → 테스트 그대로 통과

Phase 3 (독립 배포 필요 시):
  → 각 도메인이 독립 서비스로 분해 가능
  → 계약 인터페이스 보존 (ACL 적용)
  → Module Federation / single-spa (필요 시)
```

---

## 실행 후 필수 갱신 파일

```
memory/project/current-state.yaml   ← stage_states, unit_tests, 날짜
memory/project/next-actions.yaml    ← 완료된 큐 done: true, 새 큐 추가
worklog/A_progress.md               ← 실행 이력
worklog/B_review.md                 ← B_review 결과 (Stage E 후)
```

---

## 출력 형식 (매 실행 종료 시)

```
## 실행 결과

**실행한 것**: [Stage + 도메인 + 핵심 행동 — 한 줄]
**게이트 결과**: PASS / PARTIAL_PASS / FAIL
**생성/수정 파일**: [목록]
**테스트**: [N/N PASS]
**B_review**: PASS / CONDITIONAL_PASS / FAIL / 해당없음
**다음**: [next-actions.yaml priority 1 한 줄]
**차단**: 없음 / [이유 + 사용자 결정 필요 사항]
```

---

## Stage E 갭 처리 매트릭스

| 심각도 | 처리 | ADR | Stage D 재실행 | B_review 분류 |
|--------|------|-----|---------------|--------------|
| P0 — 불변조건 직접 위반 | 즉시 수정 | 불필요 | 필수 | FAIL |
| P1 — 계약·보안 오류 | 수정 | 필요 | 필수 | FAIL |
| P2 — 구현 갭 | 수정·문서화 | 선택 | 권장 | CONDITIONAL |
| P3 — 구조적 한계 | ADR 결정 | 필수 | 불필요 | CONDITIONAL |

---

## 새 도메인 추가 체크리스트

```
[ ] requirements/DOMAIN_TEMPLATE.yaml 복사
[ ] identity.id, name, domain, description, risk_level 작성
[ ] ubiquitous_language — 핵심 명사 5개 이상
[ ] invariants — P0 불변조건 1개 이상 (test_required: true)
[ ] permissions.roles — read/write/admin 역할 정의
[ ] screens — 핵심 화면 1개 이상 (path + required_permission)
[ ] (금전) risk.financial_risk 섹션 작성
[ ] (개인정보) risk.data_sensitivity.pii_fields 작성
[ ] stage: "A" 설정
[ ] "A [도메인명]" 입력 → Claude가 나머지 전부 처리
```

---

## 프로젝트 철학 (변경 금지)

```
1. 모듈은 계약으로만 연결한다 (C001)
2. 도메인 코어는 바깥을 모른다 (C002 — Clean Architecture)
3. 품질 게이트 FAIL이면 완료로 간주하지 않는다 (C005)
4. 메모리 파일이 코드보다 먼저다
5. ADR 없는 대규모 구조 변경 금지 (C004)
6. 불확실하면 [확인 필요] + 검증 절차 명시 (C006)
7. risk_level이 높을수록 방어를 자동으로 강화한다
8. 불변 패턴 — 엔티티는 항상 새 인스턴스를 반환한다
9. 증거 없는 지적은 추정이다 (B_review 원칙)
10. 모놀리스 우선 + 점진적 분해 (과도한 마이크로화 금지)
```
