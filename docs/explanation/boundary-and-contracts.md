# 경계와 계약 — 설계 원칙·근거·트레이드오프

> **Diátaxis 분류**: Explanation (WHY)
> **대상 독자**: 이 저장소에 새 도메인을 추가하거나 기존 도메인을 수정하는 개발자

---

## 1. 왜 경계(Bounded Context)인가?

### 1.1 문제: 빅볼오브머드(Big Ball of Mud)

도메인 경계 없이 성장하는 시스템은 반드시 다음 패턴에 수렴한다.

```
User → 거대한 단일 서비스 → DB 테이블 수십 개
       ↑                    ↑
       모든 팀이 공유        스키마 변경이 전파
```

증상:
- `Invoice`가 `User`·`Task`·`Payment` 모두를 직접 참조
- 한 팀의 배포가 다른 팀의 서비스를 중단
- 테스트에서 전체 시스템을 띄워야 단순 계산 로직 하나를 검증 가능

근거 (Evans 2003, "Domain-Driven Design"): 언어(Ubiquitous Language)가 일치하는 범위를 한 Context로 묶고 나머지와 명시적 계약으로만 통신하는 것이 가장 효과적인 복잡성 관리 전략이다.

### 1.2 Bounded Context 설계 기준

이 저장소는 아래 세 가지 기준으로 Context 경계를 결정한다.

| 기준 | 설명 | 예시 |
|------|------|------|
| **언어 일치** | 같은 단어가 같은 의미를 갖는 범위 | `Invoice`는 billing에서만 청구서를 의미 |
| **변경 독립** | 한 팀이 다른 팀 승인 없이 배포 가능 | billing 배포가 task-management를 멈추지 않음 |
| **데이터 소유** | 한 Context만 데이터를 쓸 수 있음 | Invoice의 상태는 billing만 변경 |

### 1.3 Anti-Corruption Layer (ACL)

Context 간에 개념이 전달될 때 번역 계층이 필요하다.

```
billing Context         ACL (번역)          task-management Context
─────────────          ──────────           ───────────────────────
Invoice.status    →    완료 여부(boolean)  →  Task.billingStatus
"PAID"            →    isBilled: true      →  표시용 플래그
```

ACL 없이 직접 참조하면:
- billing의 내부 상태 모델 변경이 task-management 코드를 깨뜨린다
- 두 Context의 도메인 언어가 오염된다

---

## 2. 왜 계약 우선(Contract-First)인가?

### 2.1 계약이란 무엇인가

이 저장소에서 "계약"은 네 가지를 의미한다.

```
domains/[domain]/contract/
├── openapi.yaml          # HTTP 계약 (소비자 ↔ 제공자)
├── events.schema.json    # 이벤트 계약 (발행자 ↔ 구독자)
├── ui-contract.yaml      # UI 계약 (화면 ↔ 유스케이스)
└── capability.yaml       # 능력 선언 (플러그인 등록 계약)
```

각 계약은 **구현 전에 작성**한다. 이것이 "계약 우선"이다.

### 2.2 계약 우선의 이점

**팀 병렬 작업**:
```
A팀 (billing)          계약 동결 후           B팀 (task-management)
  ↓                    ──────────              ↓
구현 시작                                    소비자 코드 작성
  ↓                                           ↓
완료 후 통합 ──── 계약이 같으므로 ────▶  통합 성공
```

**변경 영향 최소화**:
- 계약 내부 변경 → 소비자에게 영향 없음
- 계약 자체 변경 → semver + 마이그레이션 가이드 필수

**자동 검증**:
```bash
# OpenAPI 계약 ↔ 구현 일치 검사 (Stage D)
node scripts/validate-contract.js billing

# 이벤트 스키마 ↔ 실제 발행 페이로드 검사
node scripts/validate-events.js billing
```

### 2.3 계약 변경 시 semver 정책

| 변경 종류 | semver | 마이그레이션 |
|-----------|--------|------------|
| 기존 필드 제거 | MAJOR | 소비자 코드 변경 필요 |
| 필수 필드 추가 | MAJOR | 소비자 코드 변경 필요 |
| 선택 필드 추가 | MINOR | 하위 호환 |
| 오류 코드 추가 | MINOR | 소비자 방어 코드 권장 |
| 문서 개선만 | PATCH | 없음 |

### 2.4 계약 우선의 트레이드오프

**단점**: 초기 설계 비용이 높다. 요구사항이 자주 바뀌는 탐색 단계에서는 계약이 병목이 될 수 있다.

**완화 전략**:
- `requirements.yaml`의 `stage.current`가 `alpha`이면 계약 변경에 semver를 강제하지 않는다.
- `stable` 이후부터 계약 변경 = MAJOR 버전 필수.

```yaml
# requirements.yaml
stage:
  current: alpha       # 탐색 단계: 계약 변경 자유
  # current: stable   # 안정 단계: semver 필수
```

---

## 3. 왜 불변조건(Invariant)이 중심인가?

### 3.1 불변조건의 정의

불변조건(Invariant)은 **어떤 상황에서도 절대 위반되어서는 안 되는 비즈니스 규칙**이다.

```
INV-B004: Invoice의 모든 lineItem 금액은 양수여야 한다.

위반 예시:
  - lineItem.amount = 0  → 허용되지 않음
  - lineItem.amount = -100 → 허용되지 않음
```

### 3.2 불변조건 강제 계층

이 저장소는 불변조건을 단계별로 강제한다.

```
┌─────────────────────────────────────┐
│  HTTP Layer (BillingController)     │  ← 입력 형식 검사 (400 Bad Request)
├─────────────────────────────────────┤
│  Application Layer (UseCase)        │  ← 비즈니스 규칙 사전 검사 (CONFLICT)
├─────────────────────────────────────┤
│  Domain Layer (Entity/VO)           │  ← 불변조건 최종 강제 (Error throw)
├─────────────────────────────────────┤
│  Repository (Infrastructure)        │  ← 영속성 무결성 (낙관적 잠금)
└─────────────────────────────────────┘
```

도메인 계층이 최후의 방어선이다. 상위 계층에서 검사를 생략해도 도메인이 잡아낸다.

### 3.3 불변조건 ID 체계

```
INV-[DOMAIN_PREFIX][숫자]

예: INV-B001 (billing, 001번)
    INV001   (task-management, 001번)
    INV-HR001 (hr 도메인, 001번)
```

`requirements.yaml`의 `invariants` 섹션이 SSoT(Single Source of Truth)이며, 이로부터 테스트가 자동 생성된다.

---

## 4. 왜 도메인 코어가 바깥을 모르는가?

### 4.1 의존성 규칙

```
외부 세계 (DB, HTTP, UI, 이벤트 버스)
           ↓  의존 방향
인프라 어댑터 (InMemoryRepository, BillingController)
           ↓
포트 (인터페이스 선언만)
           ↓
유스케이스 (비즈니스 흐름)
           ↓
도메인 코어 (Entity, VO, DomainEvent)
```

**핵심**: 화살표가 항상 안쪽을 향한다. 도메인 코어에서 바깥을 향하는 `import`는 없다.

### 4.2 왜 이 규칙이 중요한가

**테스트 독립성**:
```javascript
// 도메인 Entity 테스트: DB 없이도 실행 가능
const invoice = Invoice.create({ ... });
invoice.addLineItem({ amount: Money.of(100, 'KRW') });
assert.equal(invoice.total().amount, 100);
```

DB, HTTP, 외부 서비스를 전혀 시작하지 않아도 비즈니스 로직 전체를 테스트할 수 있다. 이것이 이 저장소가 외부 의존 없이 224+ 테스트를 통과할 수 있는 이유다.

**교체 가능성**:
```
InMemoryRepository ──교체──▶ PostgresRepository
                              (도메인 코어 코드 변경 없음)
```

인프라 구현을 교체해도 도메인·유스케이스 코드는 수정하지 않아도 된다.

### 4.3 위반 패턴 (하면 안 되는 것)

```javascript
// ❌ 도메인 엔티티가 DB를 직접 호출
class Invoice {
  async save() {
    await db.query('INSERT INTO invoices ...');  // 위반!
  }
}

// ❌ 도메인 엔티티가 HTTP 클라이언트를 사용
class Payment {
  async process() {
    await fetch('https://payment-gateway.example.com/...');  // 위반!
  }
}

// ✅ 포트(인터페이스)를 통한 의존성 역전
class ProcessPaymentUseCase {
  constructor(paymentGateway) {  // 인터페이스만 알 뿐
    this.gateway = paymentGateway;
  }
  async execute(command) {
    return this.gateway.process(command);  // 구체 구현은 모름
  }
}
```

---

## 5. 계약·경계 변경 시 Stage 라우팅

변경 범위에 따라 어느 Stage부터 재실행해야 하는지가 결정된다.

```
변경 범위                              시작 Stage
─────────────────────────────────────────────────
invariants 추가/수정                → Stage A (계약 재검증)
permissions.roles 변경              → Stage A
OpenAPI / AsyncAPI 계약 변경        → Stage A
bounded_context 이름/경계 변경      → Stage A
risk_level 변경                     → Stage A

도메인 내부 구현 변경 (계약 불변)    → Stage B
화면 구성 변경                      → Stage B

feature_flag 값 변경                → Stage C
rollout 정책 변경                   → Stage C
plugin-registry 변경                → Stage C
```

이 라우팅 규칙은 `CLAUDE.md` §변경 감지 라우팅에도 명시되어 있다.

---

## 6. 참고 문헌 및 벤치마크

| 출처 | 적용된 개념 |
|------|------------|
| Evans (2003) *Domain-Driven Design* | Bounded Context, Ubiquitous Language, ACL, Aggregate |
| Vernon (2013) *Implementing DDD* | Context Map, Published Language, Open Host Service |
| Newman (2021) *Building Microservices* | 서비스 경계, 계약 우선, 독립 배포 전략 |
| OpenAPI Initiative (2023) | HTTP 계약 표준 (openapi.yaml) |
| AsyncAPI Foundation (2023) | 이벤트 계약 표준 (events.schema.json) |
| OWASP ASVS v4 (2021) | 경계에서의 입력 검증·권한 강제 |
| Fowler (2018) "BoundedContext" | Context 경계 판별 휴리스틱 |

---

*이 문서는 Diátaxis Explanation 유형이다. "어떻게"가 아니라 "왜"를 설명한다. 구체적인 절차는 `HOW_TO_USE.md`를 참고하라.*
