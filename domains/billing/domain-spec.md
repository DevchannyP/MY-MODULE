# Billing Domain Specification

## 도메인 개요
정산관리 도메인은 인보이스 생성·조회·상태전이, 결제 상태 추적, 미매칭/오류 예외처리를 담당한다.
금액 정합성과 상태 불변조건이 핵심이다.

---

## Bounded Contexts

| bounded_context     | 설명                                 | 화면 경로                 |
|---------------------|--------------------------------------|---------------------------|
| billing.home        | 정산 도메인 요약 진입점              | /billing                  |
| billing.invoice     | 인보이스 목록·상세·상태전이          | /billing/invoices         |
| billing.payment     | 결제 요청·응답 추적                  | /billing/payments         |
| billing.exception   | 미매칭·오류 항목 관리자 예외처리     | /billing/exceptions       |

---

## Ubiquitous Language

| 용어 (한)         | 용어 (key)         | 정의                                                                                      |
|-------------------|--------------------|-------------------------------------------------------------------------------------------|
| 인보이스          | Invoice            | 청구 문서. 라인 항목의 합계가 인보이스 총액과 동일해야 한다 (합계 불변조건).              |
| 라인 항목         | LineItem           | 인보이스를 구성하는 개별 청구 항목. 수량 × 단가 = 금액.                                  |
| 결제              | Payment            | 인보이스에 대한 실제 금액 이전. 인보이스 금액과 일치해야 정상 처리된다.                   |
| 미매칭            | Mismatch           | 결제 금액이 인보이스 총액과 다른 상태. 예외처리 대상.                                    |
| 정산 예외         | BillingException   | 미매칭·오류 항목. 관리자 승인 워크플로를 통해 처리한다.                                  |
| 인보이스 상태     | InvoiceStatus      | DRAFT → PENDING → PAID / CANCELLED / DISPUTED. 역전이 불가.                              |
| 관리자 승인       | AdminApproval      | DISPUTED 인보이스를 PAID로 전이할 때 필요한 명시적 승인.                                 |
| 합계 불변조건     | TotalInvariant     | invoice.total = sum(lineItems[i].amount). 항상 성립해야 한다.                             |

---

## 도메인 제약 (Constraints)

| 항목 | 값 | 근거 |
|------|-----|------|
| 지원 통화 | KRW 단일 | requirements.yaml 명시. 다국통화는 요구사항 외 (Phase 2 이후) |
| 라인 항목 혼합 통화 | 금지 | Money.add() 통화 불일치 시 오류 — 단일통화 전제 유지 |
| 인보이스 삭제 | PAID 상태 금지 | INV-B003 |

## 도메인 불변조건 (Invariants)

| ID        | 설명                                                                                        | 적용 위치                                   |
|-----------|---------------------------------------------------------------------------------------------|---------------------------------------------|
| INV-B001  | invoice.total = sum(lineItems[i].amount) (합계 불변조건)                                    | Invoice 엔티티, addLineItem, updateLineItem  |
| INV-B002  | 인보이스 상태는 허용된 전이만 가능. 역전이 불가.                                            | InvoiceStatus value object, transition 유스케이스 |
| INV-B003  | PAID 상태 인보이스는 삭제 불가.                                                             | InvoiceRepository, 도메인 서비스            |
| INV-B004  | 라인 항목 금액은 0 초과여야 한다.                                                           | Money value object, addLineItem             |
| INV-B005  | DISPUTED 인보이스는 관리자 승인 없이 PAID로 전이 불가.                                      | BillingDomainService, ApproveBillingException |
| INV-B006  | 결제 금액 ≠ 인보이스 총액이면 MISMATCH로 분류한다.                                          | BillingDomainService.detectMismatch()       |

---

## 인보이스 상태 전이도

```
DRAFT ──► PENDING ──► PAID        (terminal)
                  └──► CANCELLED  (terminal)
                  └──► DISPUTED ──► PAID        (관리자 승인 필요)
                                └──► CANCELLED
```

---

## 권한 (Permissions)

| 역할               | 허용 행동                                                                                   |
|--------------------|----------------------------------------------------------------------------------------------|
| billing.read       | 인보이스 목록 조회, 인보이스 상세 조회, 결제 상태 조회                                       |
| billing.write      | 인보이스 생성, 상태전이(DISPUTED 제외 PAID 전이), 결제 동기화 요청                          |
| billing.admin      | 예외 항목 승인 (DISPUTED → PAID), 예외 항목 조회·처리                                       |

---

## 화면별 요구사항

### /billing — 정산관리 홈
- must: 도메인 상태 요약 (총 인보이스 수, PENDING 건수, DISPUTED 건수)
- must: 하위 화면 빠른 이동 링크

### /billing/invoices — 인보이스 목록
- must: 인보이스 목록 조회
- must: 상태·금액·기간 필터
- must: 합계 불변조건 검증 결과 표시 (라인 항목 합계 ≠ 총액이면 경고)

### /billing/payments — 결제상태 추적
- must: 결제 요청·응답 상태 확인
- must: 동기화 실패 또는 미매칭 항목 표시

### /billing/exceptions — 정산 예외처리
- should: 미매칭·오류 항목 검토
- should: 관리자 승인 흐름
