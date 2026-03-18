# Billing UI Map

## 화면 구조

```
/billing                          ← 정산관리 홈 (BillingHomePage)
├─ /billing/invoices              ← 인보이스 목록 (InvoiceListPage)
│  └─ /billing/invoices/:id       ← 인보이스 상세 (InvoiceDetailPage)
├─ /billing/payments              ← 결제상태 추적 (PaymentStatusPage)
└─ /billing/exceptions            ← 정산 예외처리 (BillingExceptionsPage)
```

---

## 화면 명세

### BillingHomePage `/billing`
- **모듈 키**: billing.home
- **마운트**: BillingHomePage
- **권한**: billing.read
- **기능 플래그**: billing.enabled
- **구성요소**
  - 정산 요약 위젯: 총 인보이스, PENDING, DISPUTED, 이번 달 합계
  - 빠른 링크: 인보이스 목록 / 결제 상태 / 예외처리
  - 알림 배너: 미매칭 항목 존재 시 표시

### InvoiceListPage `/billing/invoices`
- **모듈 키**: billing.invoice
- **마운트**: InvoiceListPage
- **권한**: billing.read
- **기능 플래그**: billing.invoice.enabled
- **구성요소**
  - 목록 테이블: 인보이스 ID, 고객, 총액, 상태, 마감일
  - 필터 패널: 상태(DRAFT/PENDING/PAID/CANCELLED/DISPUTED), 금액 범위, 기간
  - 합계 불변조건 배지: 라인 합계 ≠ 총액이면 WARN 표시
  - 상세 진입 링크

### InvoiceDetailPage `/billing/invoices/:id`
- **모듈 키**: billing.invoice (상세 뷰)
- **마운트**: InvoiceDetailPage
- **권한**: billing.read (상태전이는 billing.write 추가 필요)
- **구성요소**
  - 인보이스 헤더: ID, 고객, 상태, 총액
  - 라인 항목 테이블: 설명, 수량, 단가, 금액
  - 합계 불변조건 검증 결과
  - 상태 전이 버튼 (권한 기반 노출)

### PaymentStatusPage `/billing/payments`
- **모듈 키**: billing.payment
- **마운트**: PaymentStatusPage
- **권한**: billing.read
- **기능 플래그**: billing.payment.enabled
- **구성요소**
  - 결제 목록: 결제 ID, 인보이스 ID, 금액, 상태, 시각
  - 미매칭 필터 토글
  - 동기화 상태 표시: PENDING/SUCCESS/FAILED/MISMATCH
  - 재시도 트리거 버튼 (billing.write 권한)

### BillingExceptionsPage `/billing/exceptions`
- **모듈 키**: billing.exception
- **마운트**: BillingExceptionsPage
- **권한**: billing.admin
- **기능 플래그**: billing.exception.enabled
- **구성요소**
  - 예외 항목 목록: 인보이스 ID, 유형(MISMATCH/DISPUTED/SYNC_FAILURE), 심각도
  - 상세 패널: 원인, 관련 결제, 라인 항목
  - 승인 버튼: DISPUTED → PAID (billing.admin 전용)
  - 거부/취소 버튼

---

## 내비게이션 그룹
- **그룹**: 정산
- **아이콘**: receipt (도메인 컨벤션)
- **순서**: 2 (productivity 다음)

---

## Error Boundary 정책
- 화면 단위 error boundary 적용
- 오류 발생 시: 화면 이름 + 상관관계 ID를 포함한 안내 메시지 표시
- 정산 데이터 오류는 마스터 UI 전체에 영향 주지 않음
