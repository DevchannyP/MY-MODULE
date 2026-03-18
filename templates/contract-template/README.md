# Contract Template

계약 파일 작성 가이드.

## openapi.yaml (HTTP Contract)

```yaml
openapi: "3.0.3"
info:
  title: "[Module Name] API"
  version: "0.1.0"
  description: "[도메인 기능 설명]"
paths:
  /[resource]:
    get:
      summary: "[도메인 언어로 된 요약]"
      operationId: "[operation-id]"
      responses:
        "200":
          description: "성공"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/[ResponseType]"
```

## events.schema.json (Event Contract)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "[Module Name] Events",
  "events": {
    "[EventName]": {
      "description": "[도메인 이벤트 설명]",
      "payload": {}
    }
  }
}
```

## ui-contract.yaml

docs/reference/ui-contract-reference.md 참조.

## capability.yaml

docs/reference/capability-contract-reference.md 참조.

## 변경 정책

- 계약 변경은 하위 호환성을 유지해야 한다.
- Breaking change는 ADR로 정당화하고 버전을 올린다.
- 계약 변경 시 Stage A를 재실행한다.
