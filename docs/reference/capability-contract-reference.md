# Capability Contract 참조

> **WHAT** 중심 문서: capability.yaml 파일의 구조와 사용 방법

## 파일 위치

각 모듈의 `contract/capability.yaml`

## 스키마

```yaml
version: "0.1.0"
module_id: ""
name: "모듈 기능 이름"
description: "이 모듈이 제공하는 도메인 기능 목록"

capabilities:
  - id: "capability-id"
    name: "기능 이름 (도메인 언어)"
    description: "이 기능이 해결하는 도메인 문제"
    type: "query | command | event"
    input_schema: "JSON Schema 참조 또는 인라인"
    output_schema: "JSON Schema 참조 또는 인라인"
    preconditions: []
    postconditions: []
    invariants: []
    permissions_required: []

events_emitted:
  - id: "event-id"
    name: "이벤트 이름"
    schema: "events.schema.json 참조"
    triggers: "어떤 도메인 행위가 이 이벤트를 발생시키는가"

events_consumed:
  - id: "event-id"
    source_module: "이벤트를 발생시키는 모듈 ID"
    handler: "이 이벤트를 받아서 하는 도메인 행위"
```

## 작성 원칙

1. capability ID는 안정적으로 유지한다 (변경 시 Stage A 재실행).
2. 조합기와 마스터 UI는 이 파일을 읽고 모듈의 기능을 파악한다.
3. 코드 내부를 노출하지 않는다.
4. 불변조건(invariants)은 Stage A에서 정의한 것과 일치해야 한다.
