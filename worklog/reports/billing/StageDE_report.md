# 학습보고서 — billing Stage D/E
날짜: 2026-03-21

## 기승 (What happened)
billing 도메인 Stage D/E 완료. 21개 소스파일에 대해 14개 테스트 파일 보유.
AddLineItemUseCase, GetBillingSummaryUseCase, GetInvoiceListUseCase, RejectBillingExceptionUseCase 테스트 추가.

## 전 (What went wrong / Challenges)
- INV-B004 금액 검증이 Money 레이어에서 이뤄지는 간접 방식 → 명시적 에러 코드 추적 필요
- GetBillingSummaryUseCase month_total GAP-B004 미구현 (Phase 2)

## 결 (What was learned)
- 금융 도메인은 Money value object가 모든 금액 연산의 단일 진입점이어야 함
- 이중 승인 방어(Stage E)는 이벤트 발행 횟수로 검증 가능

## 행동 (Next actions)
- Payment.js entity 테스트 추가 (INV-B006 MISMATCH 감지)
- BillingEvents 팩토리 테스트
- billing ejectable 조건 충족을 위한 testScore ≥ 80% 달성
