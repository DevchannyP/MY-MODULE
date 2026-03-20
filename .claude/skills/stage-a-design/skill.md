---
name: stage-a-design
description: Stage A 격리 모듈 생성. requirements YAML 검증 → bounded_context → 불변조건 → 상태 전이 → 권한 → 4종 계약까지 전체 절차.
---

## 파일 읽기 순서
1. memory/L0-hot/current-state.yaml
2. memory/L0-hot/next-actions.yaml
3. memory/L0-hot/reflection-log.yaml (이전 실패 교훈 확인)
4. memory/L0-hot/failure-patterns.yaml
5. requirements/[도메인].yaml
6. requirements/constraints.yaml
7. requirements/requirements.schema.json

## 실행 단계
1. JSON Schema(2020-12) 검증 — FAIL이면 오류 목록 출력 후 멈춤
2. risk_level 평가 → NFR 기본값 병합
3. risk_level별 자동 강화:
   - LOW: 기본 INV + RBAC + 단위 테스트
   - MEDIUM: + OWASP ASVS L1 + authz regression + 경계값
   - HIGH: + 감사 로그(immutable) + PII 마스킹 + ASVS L2
   - CRITICAL: + ASVS L3 + MFA(ADR) + 4-eyes + 낙관적 잠금 + 멱등성 키
4. bounded_context 확정 + ubiquitous_language → 클래스명 매핑표
5. invariants 정제: "~해야 한다" / "~할 수 없다" + enforcement 레이어
6. state_machines 설계: terminal_states → Object.freeze
7. 권한 모델 확정 (RBAC)
8. 유사성 인덱스 갱신 (memory/project/similarity-index.yaml)

## 산출물 (모두 생성해야 PASS)
- domains/[id]/domain-spec.md
- domains/[id]/contracts/openapi.yaml
- domains/[id]/contracts/events.schema.json
- domains/[id]/contracts/ui-contract.yaml
- domains/[id]/contracts/capability.yaml
- memory/stageA/[id].yaml

## PASS 기준
- JSON Schema 검증 PASS
- 4종 계약 모두 존재
- 모든 INV에 test_required: true
- risk_level 자동 강화 적용됨
- similarity-index.yaml 갱신됨
