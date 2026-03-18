# 도메인 조합 예제

> **학습용** 문서: 두 도메인 모듈이 계약으로 조합되는 예제

## 시나리오

**주문 도메인**과 **재고 도메인**이 있다.
주문이 생성될 때 재고가 자동으로 확인되어야 한다.

이때 두 도메인은 **코드를 공유하지 않고 계약으로만 통신한다.**

---

## 잘못된 방식 (금지)

```javascript
// 금지: 직접 코드 참조
import { InventoryService } from '../inventory/services/InventoryService';
```

## 올바른 방식 (계약 기반)

### 1. 재고 도메인이 capability를 공개한다

```yaml
# domains/commerce/inventory/contract/capability.yaml
capabilities:
  - id: "check-availability"
    name: "재고 가용성 확인"
    type: "query"
    input_schema:
      product_id: string
      quantity: number
    output_schema:
      available: boolean
      available_quantity: number
```

### 2. 주문 도메인이 재고 계약을 참조한다

```yaml
# requirements/requirements.yaml (주문 도메인)
composition:
  depends_on:
    - "domains/commerce/inventory/contract/capability.yaml"
```

### 3. 이벤트로 통신한다

```json
// domains/commerce/inventory/contract/events.schema.json
{
  "events": {
    "OrderCreated": {
      "description": "주문 생성 시 재고 확인 트리거",
      "payload": {
        "order_id": "string",
        "items": [{"product_id": "string", "quantity": "number"}]
      }
    }
  }
}
```

## Stage 실행 흐름

1. 재고 모듈: Stage A → 계약 생성
2. 주문 모듈: Stage A → 계약 생성
3. 주문 모듈: Stage B → 재고 capability 계약 참조 추가
4. 두 모듈 모두: Stage C → 마스터 UI 등록
5. 두 모듈 모두: Stage D → 품질 게이트 판정

## 배운 점

- 도메인 간 통신은 항상 계약을 통한다.
- 의존 방향은 `composition.depends_on`에만 명시한다.
- Stage B가 Stage A 완료를 전제한다.
