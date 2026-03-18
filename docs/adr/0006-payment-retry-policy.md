# ADR 0006: Payment Sync Retry Policy

## Status
Accepted

## Context
`retryPaymentSync` 엔드포인트에 재시도 횟수 상한이 없다.
현재 인메모리 구현에서는 문제가 없지만, 실제 외부 결제 시스템과 연동 시
무한 재시도로 인한 외부 시스템 부하, 결제 중복 처리, 리소스 고갈이 발생할 수 있다 (R-BILL-002).

## Decision
결제 동기화 재시도는 다음 정책을 따른다:

1. **최대 재시도 횟수**: 3회
2. **재시도 대기**: Exponential backoff (1초 → 2초 → 4초)
3. **3회 초과 시**: Payment.status = FAILED (PERMANENT), 별도 수동 처리 큐로 이동
4. **재시도 가능 상태**: PENDING, FAILED (일시) 상태만 허용
5. **SUCCESS/MISMATCH 상태**: 재시도 불가 (idempotency 보장)

## 구현 위치
- `Payment` 엔티티: `retryCount` 필드 추가 (0~3)
- `InMemoryPaymentRepository` → 실 구현체에서 강제
- `retryPaymentSync` 유스케이스 (미구현): `retryCount >= 3` 시 FORBIDDEN

## Consequences
- 재시도 횟수가 기록되므로 결제 이력 추적이 가능하다
- 3회 초과 결제는 billing.exception으로 escalate하는 흐름이 필요하다
- 현재 인메모리 구현에서는 retryCount를 추적하지 않으므로 Phase 2에서 구체화한다
- Phase 2 구현 시 이 ADR을 기준으로 Payment 엔티티를 수정한다
