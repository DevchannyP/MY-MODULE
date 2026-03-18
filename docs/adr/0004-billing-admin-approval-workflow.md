# ADR 0004: Billing Admin Approval Workflow for DISPUTED→PAID

## Status
Accepted

## Context
billing 도메인에서 인보이스가 DISPUTED 상태가 되면 단순 상태 전이 API로 PAID로 전이해서는 안 된다.
결제 금액 불일치나 분쟁 상황에서 관리자 검토 없이 PAID 처리되면 금액 오류가 확정되는 리스크가 있다.

## Decision
DISPUTED → PAID 전이는 오직 `ApproveBillingExceptionUseCase`를 통해서만 허용한다.

1. `TransitionInvoiceStatusUseCase`에서 `DISPUTED → PAID` 요청은 `FORBIDDEN(403)`으로 거부한다.
2. `BillingDomainService.canTransitionDisputedToPaid(invoice, hasAdminApproval)`가 도메인 레벨 게이트키퍼 역할을 한다.
3. `ApproveBillingExceptionUseCase`는 `billing.admin` 권한 검사 후, 도메인 서비스를 통해 전이한다.
4. 승인 행위는 `BillingExceptionApproved` 이벤트로 발행해 감사 추적을 남긴다.

## Consequences
- DISPUTED 상태 인보이스는 반드시 예외 항목(BillingException)이 존재해야 PAID 전이가 가능하다.
- billing.admin 권한 부여 정책과 감사 로그가 보안 정책(security-policy.md)과 연동되어야 한다.
- Stage D에서 authz regression 테스트: billing.write만 가진 사용자의 DISPUTED→PAID 시도가 거부되는지 검증한다.
