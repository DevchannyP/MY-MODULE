# ADR 0005: Invoice Total as Computed Value (INV-B001)

## Status
Accepted

## Context
인보이스 총액을 저장 필드로 관리할 경우, 라인 항목 변경 시 총액 업데이트를 누락하는 버그가 발생하기 쉽다.
이는 INV-B001(합계 불변조건)을 구조적으로 위반하게 한다.

## Decision
`Invoice.total`은 저장 필드가 아니라 `lineItems`에서 실시간으로 계산하는 getter로 구현한다.

```js
get total() {
  return lineItems.reduce((acc, item) => acc.add(item.amount), Money.zero(currency));
}
```

외부에서 선언된 총액(예: HTTP 요청의 `total`)이 있다면, 이를 계산값과 비교하는 용도로만 사용하고 저장하지 않는다.
불일치 감지 시 `InvoiceTotalMismatchDetected` 이벤트를 발행한다.

## Consequences
- 라인 항목 추가/변경 시 total 업데이트를 별도로 호출할 필요가 없다.
- Invoice는 불변 패턴(addLineItem이 새 Invoice 반환)을 사용하므로 총액 불일치가 구조적으로 방지된다.
- 직렬화 시 `total_invariant_valid: true`를 항상 포함하여 API 소비자에게 계약을 명시한다.
- 성능: 라인 항목 수가 많은 경우 매 조회마다 재계산 오버헤드가 있다. 실 DB 구현 시 캐시 또는 DB 집계 함수로 보완한다.
