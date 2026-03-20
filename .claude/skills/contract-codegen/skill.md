---
name: contract-codegen
description: 4종 계약 파일에서 Stage D 코드 스켈레톤 자동 생성. 보일러플레이트 80% 자동화.
---

## 실행
node scripts/generate-from-contracts.js {domain-id}

## 생성 매핑
- openapi.yaml → Controller 메서드 스켈레톤 + 값 객체 스켈레톤
- events.schema.json → domain/events/{EventName}.js (Object.freeze 포함)
- capability.yaml → application/ports/{CapName}Port.js (인터페이스)
- ui-contract.yaml → tests/interface/ authz regression 스켈레톤

## 규칙
- 이미 존재하는 파일은 덮어쓰지 않음 (--force로 오버라이드)
- 생성된 파일 상단에 AUTO-GENERATED 주석
- 생성 후 즉시 node --check로 문법 검증
