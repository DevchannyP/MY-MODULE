# Billing Domain

## 이 모듈이 속한 도메인 화면
1. 정산관리 홈 `/billing` — 도메인 상태 요약, 빠른 이동
2. 인보이스 목록 `/billing/invoices` — 조회, 필터, 합계 불변조건 배지
3. 인보이스 상세 `/billing/invoices/:id` — 라인 항목, 상태 전이
4. 결제상태 추적 `/billing/payments` — 결제 상태, 미매칭 항목
5. 정산 예외처리 `/billing/exceptions` — 관리자 승인 워크플로

## 이 모듈의 역할
정산관리 도메인의 인보이스 생성·상태전이, 결제 추적, 미매칭 예외처리를 담당한다.
금액 정합성과 상태 불변조건 보호가 핵심이다.

## 공개 계약
- HTTP API: `contracts/openapi.yaml`
- UI 계약: `contracts/ui-contract.yaml`
- Capability 계약: `contracts/capability.yaml`
- 이벤트 스키마: `contracts/events.schema.json`

## 핵심 불변조건
| ID | 설명 | 적용 위치 |
|----|------|-----------|
| INV-B001 | invoice.total = sum(lineItems[i].amount) | Invoice.total getter |
| INV-B002 | 인보이스 상태 역전이 불가 | InvoiceStatus.canTransitionTo() |
| INV-B003 | PAID 인보이스 삭제 불가 | InvoiceRepository.delete() |
| INV-B004 | 라인 항목 금액 > 0 | Money.isPositive(), addLineItem() |
| INV-B005 | DISPUTED→PAID는 관리자 승인 필요 | ApproveBillingExceptionUseCase |
| INV-B006 | 결제금액 ≠ 인보이스총액 → MISMATCH | BillingDomainService.detectMismatch() |

## 주요 테스트
- `tests/domain/` — 불변조건 단위 테스트 (Money, InvoiceStatus, Invoice, BillingDomainService)
- `tests/application/` — 유스케이스 권한·흐름 테스트
- `tests/adversarial/` — Stage E 경계 케이스 (합계 우회, 역전이, 이중 승인 등)

## 조합 및 편입 위치
- Stage B: billing 도메인 단일 Module Federation remote (`billing_remote`)
- Stage C: `master-shell/plugin-registry/registry.yaml` — `billing-plugin`
- 메뉴 그룹: 정산 (order: 2)
- Feature flags: `billing.enabled` / `billing.invoice.enabled` / `billing.payment.enabled` / `billing.exception.enabled`
- 기본값: 모두 false (Stage D PASS 후 활성화)

## 관련 ADR
- ADR-0004: DISPUTED→PAID 관리자 승인 워크플로
- ADR-0005: Invoice total을 계산값으로 구현 (INV-B001)
