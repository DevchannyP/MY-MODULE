# 학습 보고서: Stage D — billing

> 일자: 2026-03-25 | 순번: #010 | 작성: AI Agent (reporter)
> Stage: D | 도메인: billing
> 게이트 결과: PASS | 테스트: 133/133 PASS (89 domain/app + 44 interface)

---

## 기(起) — 배경과 문제 정의

billing 도메인은 **financial-ledger 아키타입**이 적용된 고위험 금융 도메인이다. 인보이스의 총액은 한 번 확정되면 절대 변경될 수 없고(INV-B001 합계 불변), 특정 상태 전이는 관리자 전용이며(INV-B005), 소수점 오차가 실제 금전 손실로 이어진다.

Stage D의 핵심 도전은 세 가지였다:

1. **Money 값 객체(Value Object)의 정확성**: `10.1 + 10.2 ≠ 20.3` 부동소수점 함정을 금융 레이어에서 차단해야 했다.
2. **상태 기계 단방향성**: `DISPUTED→PAID`는 `billing.admin` 권한 보유자만 실행 가능하다 — 코드가 아닌 UseCase 게이트에서 검증.
3. **BillingController 11개 경로에 대한 authn/authz 회귀 방지**: 각 경로가 정확한 권한을 요구하는지 44개 테스트로 커버.

### 핵심 용어
| 용어 | 한글 | 의미 |
|------|------|------|
| Invoice | 인보이스 | 청구서. DRAFT→PENDING→PAID/CANCELLED/DISPUTED 단방향 |
| Money VO | 화폐 값 객체 | amount(정수 센트) + currency. 덧셈·뺄셈은 새 Money 반환 |
| INV-B001 | 합계 불변 | 인보이스 items 합계 = total. 라인 추가/삭제 시 total 재계산 |
| INV-B005 | 관리자 승인 | DISPUTED→PAID 전이는 billing.admin 전용 |
| ProblemDetails | RFC 7807 | 구조화된 HTTP 오류 응답. type/title/status/detail/instance 5-tuple |

---

## 승(承) — 설계 결정

### Money 값 객체 — 정수 센트 전략

```javascript
// domains/billing/src/domain/Money.js
class Money {
  constructor(amount, currency) {
    // amount는 "정수 센트" 단위로 저장 (예: $10.99 → 1099)
    if (!Number.isInteger(amount) || amount < 0) {
      throw new DomainError('MONEY_INVALID', 'amount must be a non-negative integer (cents)');
    }
    this._amount = amount;
    this._currency = currency;
  }

  add(other) {
    if (this._currency !== other._currency) {
      throw new DomainError('MONEY_CURRENCY_MISMATCH');
    }
    return new Money(this._amount + other._amount, this._currency);  // 불변 패턴
  }
}
```

부동소수점 대신 **정수 센트** 저장으로 `10.1 + 10.2 = 20.3` 함정을 원천 차단. API 입출력에서만 소수점 변환.

### InvoiceStatus 상태 기계 — 허용 전이 행렬

```javascript
const ALLOWED_TRANSITIONS = {
  DRAFT:     ['PENDING'],
  PENDING:   ['PAID', 'CANCELLED', 'DISPUTED'],
  DISPUTED:  ['PAID', 'CANCELLED'],
  // PAID, CANCELLED → 터미널 상태 (전이 없음)
};
```

`DISPUTED→PAID`는 허용된 전이이지만, UseCase 레이어에서 `billing.admin` 권한 추가 검증으로 이중 방어.

### GAP 수정 사례

Stage E 적대적 검증에서 4개 갭 발견:

| GAP ID | 심각도 | 내용 | 조치 |
|--------|--------|------|------|
| GAP-B001 | P1 | DISPUTED 아닌 인보이스 approve 시 오류 code 없음 | CONFLICT 사전 검사 추가 |
| GAP-B002 | P2 | 빈 인보이스 total() 'KRW' 하드코딩 | domain-spec.md 단일통화 제약 명시 |
| GAP-B003 | P3 | 결제 동기화 재시도 횟수 상한 없음 | ADR-0006 재시도 정책 문서화 |
| GAP-B004 | P3 | GetBillingSummaryUseCase month_total 미반환 | null로 명시 반환 |

---

## 전(轉) — 구현 (기초 → 심화)

### Level 1: 기초 — Invoice.addLineItem() 합계 불변 강제

```javascript
// domains/billing/src/domain/Invoice.js
addLineItem(lineItem) {
  const updatedItems = [...this._lineItems, lineItem];
  const newTotal = updatedItems.reduce(
    (sum, item) => sum.add(item.amount),
    new Money(0, this._currency)
  );
  // INV-B001: total은 items 합계와 항상 일치해야 한다
  return new Invoice({ ...this._data, lineItems: updatedItems, total: newTotal });
  //                                                            ↑ 재계산된 total
}
```

라인 추가 시 total을 직접 변경하는 것이 아니라, **items 전체를 reduce**하여 total을 재계산. 어떤 경로로도 불일치 상태에 도달할 수 없다.

### Level 2: 중급 — ApproveBillingExceptionUseCase 이중 검증

```javascript
// domains/billing/src/application/ApproveBillingExceptionUseCase.js
async execute({ invoiceId, approverId, approverRole }) {
  // 1단계: 권한 검증 (UseCase 게이트)
  if (approverRole !== 'billing.admin') {
    throw new AppError('FORBIDDEN', 'Only billing.admin can approve exceptions');
  }

  const invoice = await this._invoiceRepo.findById(invoiceId);

  // 2단계: 상태 사전 검증 (GAP-B001 수정)
  if (invoice.status !== 'DISPUTED') {
    throw new AppError('CONFLICT', `Cannot approve invoice in status ${invoice.status}`);
  }

  // 3단계: 도메인 상태 전이
  const approved = invoice.transitionTo('PAID', { approvedBy: approverId });
  await this._invoiceRepo.save(approved);
  return { invoiceId, newStatus: 'PAID' };
}
```

UseCase 레이어에서 권한(billing.admin)과 상태(DISPUTED) **두 조건을 모두 검증**. 도메인 객체는 "기술적으로 가능한가"만 판단하고, 비즈니스 규칙은 UseCase가 담당.

### Level 3: 심화 — BillingController authn/authz 44-test 방어망

```javascript
// domains/billing/tests/interface/BillingController.authz.test.js — 핵심 패턴
const ROUTE_AUTH_MATRIX = [
  { method: 'POST',   path: '/billing/invoices',              role: 'billing.write',  status: 201 },
  { method: 'POST',   path: '/billing/invoices/:id/approve',  role: 'billing.admin',  status: 200 },
  { method: 'POST',   path: '/billing/invoices/:id/approve',  role: 'billing.write',  status: 403 },
  // ... 11개 경로 × 다중 역할 시나리오
];

// 각 행: "이 역할로 이 경로를 호출하면 이 상태코드여야 한다"
// billing.admin이 아닌 계정이 approve를 시도하면 반드시 403 — 이 보장이 깨지면 즉시 감지
```

authn/authz 회귀 테스트는 **역할-경로-예상결과 행렬**로 구현. 새 엔드포인트 추가 시 행렬에 행을 추가하면 자동으로 권한 검증이 확장된다.

---

## 결(結) — 결과와 교훈

### 게이트 결과
| 항목 | 결과 | 비고 |
|------|------|------|
| unit-tests | PASS | 133/133 (89 domain/app + 44 interface) |
| lint | PASS | 0 errors |
| secret-scan | PASS | - |
| dependency-scan | PASS | lockfile baseline 완료 |
| contract-tests | PASS | drift validator PASS |
| e2e-smoke | PASS | BillingController smoke suite |
| authn-authz | PASS | 44 regression PASS |

### 이번 Stage에서 배운 것

1. **정수 센트 전략이 금융 도메인의 필수 패턴**: Money VO에서 float 대신 integer를 사용하면 부동소수점 오차를 타입 레벨에서 원천 차단할 수 있다. 이 결정이 없으면 Stage E에서 `0.1 + 0.2 = 0.30000000000000004` 류의 테스트 실패가 반드시 발생한다.

2. **UseCase가 권한 게이트를 소유한다**: 도메인 객체는 상태 전이 가능 여부만 판단. 권한(admin 여부)은 UseCase가 단독 책임. 레이어 분리가 명확할수록 Stage E 적대적 테스트에서 허점을 찾기 어려워진다.

3. **역할-경로 행렬 테스트가 authz 회귀를 완전 자동화**: 새 엔드포인트 추가 시 한 줄만 추가하면 권한 검증이 자동 확장. 이것이 없으면 엔드포인트가 늘어날수록 권한 테스트 누락 위험이 선형 증가한다.

### 다음 액션
Stage E: INV-B001(합계 불변), INV-B005(관리자 승인) 중심 적대적 벡터 검증.
