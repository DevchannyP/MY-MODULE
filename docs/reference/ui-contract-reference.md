# UI Contract 참조

> **WHAT** 중심 문서: ui-contract.yaml 파일의 구조와 사용 방법

## 파일 위치

각 모듈의 `contract/ui-contract.yaml`

## 스키마

```yaml
version: "0.1.0"
module_id: ""
name: "도메인 화면 이름 (도메인 언어로 작성)"
description: "이 화면이 사용자에게 제공하는 도메인 가치"

entry_points:
  - route: "/path"
    label: "메뉴 레이블"
    description: "이 화면에서 할 수 있는 도메인 작업"

screens:
  - id: "screen-id"
    name: "화면 이름"
    route: "/path"
    capabilities_required:
      - "capability-id"
    data_requirements:
      - source: "capability.yaml의 endpoint ID"
        fields: []
    actions:
      - id: "action-id"
        label: "버튼 레이블 (도메인 언어)"
        triggers: "event 또는 capability 호출"

permissions:
  - role: "role-name"
    screens: ["screen-id"]
    actions: ["action-id"]
```

## 작성 원칙

1. 화면 이름과 레이블은 도메인 언어로 작성한다 (기술 용어 금지).
2. `capabilities_required`는 `capability.yaml`에 정의된 ID를 참조한다.
3. 마스터 UI는 이 파일만 읽고 화면을 구성한다 (모듈 코드를 모름).
4. 권한(permissions)은 Stage A에서 정의한 bounded context 권한과 일치해야 한다.
