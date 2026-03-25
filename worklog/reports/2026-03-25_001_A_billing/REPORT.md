# 학습 보고서: Stage A — billing

> 일자: 2026-03-25 | 순번: #001 | 작성: AI Agent (reporter)
> Stage: A | 도메인: billing
> 게이트 결과: PASS | 테스트: N/A (Stage A는 설계 전용)

---

## 기(起) — 배경과 문제 정의

billing 도메인은 "돈이 오가는 흐름"을 다루는 금융 아키타입 도메인이다. 단순 CRUD가 아니라, 상태 기계 + 이중 불변 검증 + 관리자 승인 워크플로가 교차하는 복합 구조가 필요하다.

**해결하는 핵심 문제 3가지:**

1. **인보이스 생명주기 제어**: `DRAFT → PENDING → PAID | CANCELLED | DISPUTED` 전이 경로를 엄격히 통제. DISPUTED→PAID는 `billing.admin` 권한만 가능(INV-B005).
2. **결제 금액 자동 검증**: 외부 결제 게이트웨이 응답이 인보이스 총액과 불일치 시 `PaymentMismatchDetected` 이벤트 자동 발행.
3. **정산 예외 승인 분리**: 예외 승인 경로를 일반 상태 전이 API와 물리적으로 분리해 권한 우회를 설계 수준에서 차단.

**아키타입 감지 결과**: `financial_risk: true`, `double_entry: implied` → `financial-ledger` 아키타입 로드.

### 핵심 용어
| 용어 | 한글 | 의미 |
|------|------|------|
| Invoice | 인보이스 | 청구서. 금액·라인아이템·상태를 가진 핵심 집합체(Aggregate) |
| BillingException | 정산예외 | 불일치 금액이 감지됐을 때 생성되는 검토 대상 항목 |
| Money | 금액 | amount + currency를 묶는 불변 Value Object. 모든 금액 연산의 단일 진입점 |
| INV-B001 | 총액 불변 | 라인아이템 합 = 인보이스 총액. 항상 유지 |
| INV-B005 | 관리자 승인 | DISPUTED→PAID 전이는 billing.admin 전용 |

---

## 승(承) — 설계 결정

### capability.yaml — 11개 역량 정의

```yaml
# domains/billing/contracts/capability.yaml (핵심 발췌)
capabilities:
  - id: can.create.invoice
    invariants: [INV-B001, INV-B004]
    events_emitted: [InvoiceCreated, InvoiceTotalMismatchDetected]

  - id: can.transition.invoice.status
    invariants: [INV-B002, INV-B003]
    events_emitted: [InvoiceStatusChanged]

  - id: can.approve.billing.exception
    permission_required: billing.admin
    invariants: [INV-B005]
    events_emitted: [BillingExceptionApproved]
```

**결정의 핵심**: `permission_required: billing.admin`을 capability 레벨에 명시함으로써, openapi.yaml, controller, authz 테스트가 동일 계약을 참조하는 단일 진실원을 확보한다.

### openapi.yaml — 경로 구조

```yaml
# 인보이스 경로
/billing/invoices:          POST (createInvoice)
/billing/invoices/{id}:     GET  (getInvoice)
/billing/invoices/{id}/status: PATCH (transitionInvoiceStatus)

# 예외처리 경로 (admin 전용)
/billing/exceptions/{id}/approve: POST (approveBillingException)
/billing/exceptions/{id}/reject:  POST (rejectBillingException)
```

승인/거부를 별도 경로로 분리한 이유: `PATCH /exceptions/{id}/status`로 통합하면 status 값으로 권한을 분기해야 하는데, 이는 controller 레벨 authz 검사를 복잡하게 만들고 테스트 커버리지 구멍이 생긴다.

### events.schema.json — 이벤트 경계

```json
// 6개 이벤트 중 가장 중요한 설계 결정
"BillingExceptionApproved": {
  "properties": {
    "exception_id": { "type": "string" },
    "invoice_id": { "type": "string" },
    "approved_by": { "type": "string" },  // 감사 추적 필수
    "resolved_at": { "type": "string" }
  }
}
```

`approved_by` 필드를 이벤트에 포함한 이유: 나중에 감사 조회 시 이벤트 소싱으로 "누가 승인했는가"를 재구성할 수 있어야 한다. 이 필드가 없으면 감사 추적이 불완전해진다.

---

## 전(轉) — 구현으로 이어지는 계약 구조

### Level 1: 불변조건 목록 (INV-B001 ~ INV-B006)

```
INV-B001: sum(line_items.amount) == invoice.total  (항상)
INV-B002: Invoice 상태 전이는 허용된 경로만 (DRAFT→PENDING 등)
INV-B003: CANCELLED 인보이스는 재활성 불가
INV-B004: 라인아이템은 금액이 0보다 커야 함
INV-B005: DISPUTED→PAID 전이는 billing.admin 권한 필수
INV-B006: Payment.amount 불일치 시 BillingException 자동 생성
```

### Level 2: Money Value Object 패턴

```javascript
// Stage D 구현 시 이 계약을 따라야 함
class Money {
  constructor(amount, currency) {
    if (amount < 0) throw new Error('Money amount cannot be negative');
    this.amount = amount;
    this.currency = currency;
    Object.freeze(this); // 불변 객체
  }
  add(other) {
    if (this.currency !== other.currency) throw new Error('Currency mismatch');
    return new Money(this.amount + other.amount, this.currency); // 새 인스턴스 반환
  }
}
```

불변 패턴(핵심 원칙 8번): 엔티티 상태를 직접 수정하지 않고 새 인스턴스를 반환. INV-B001 보장의 토대.

### Level 3: 계약→구현→테스트 추적 가능성

```
capability.yaml#can.approve.billing.exception
    ↓ operationId 일치
openapi.yaml#approveBillingException
    ↓ 경로 일치
BillingController.js#path === '/billing/exceptions/:id/approve'
    ↓ authz 검사
validate_contract_drift.py → 자동 검증
```

---

## 결(結) — 학습된 것

1. **금융 도메인은 capability 레벨 권한 명시가 필수**: `billing.admin` 같은 권한을 capability.yaml에 적으면, controller/authz/smoke 테스트가 동일 계약을 참조해 드리프트가 불가능해진다.

2. **이벤트 이름은 과거형 완료**: `ApproveBillingException` (X) → `BillingExceptionApproved` (O). 이벤트는 "이미 일어난 사실"이므로 과거형.

3. **합계 불변(INV-B001)은 Money Value Object로 캡슐화**: 인보이스 총액 검증 로직이 여러 곳에 흩어지면 반드시 구멍이 생긴다. `Money.add()` 한 곳에서만 계산.

**다음 단계**: Stage D에서 INV-B001~B006을 모두 검증하는 테스트 133건 작성. `ApproveBillingExceptionUseCase`의 authz 경계 테스트에 특히 주목.
