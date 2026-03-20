---
name: stage-e-adversarial
description: Stage E 적대적 검증 + B_review. 7가지 공격 벡터 + LATS 탐색. 갭 처리 매트릭스.
---

## 7가지 공격 벡터 (모든 INV에 적용)
1. 불변조건 우회 (Object.defineProperty setter 주입, 배열 직접 push)
2. 상태 역전이 (terminal state 강제 탈출)
3. 권한 우회 (caller.permissions 조작, null/빈 caller)
4. 경계값 (0, -1, null, undefined, NaN, Infinity, MAX_SAFE_INTEGER+1, 빈 문자열, 1000자)
5. 동시성 (이중 승인, 동시 수정)
6. 금액 위조 (음수, 0, 소수점 오버플로우)
7. 페이로드 조작 (필수 필드 누락, 타입 불일치, prototype pollution)

## LATS 탐색 패턴
각 INV에 대해:
1. 5개 공격 경로 구상
2. 예상 심각도 점수 부여
3. 높은 순으로 실제 테스트 코드 작성
4. 성공한 공격 → P0/P1 분류 → 즉시 수정
5. 실패한 공격 → regression 테스트로 보존

## 갭 처리 매트릭스
| 심각도 | 처리      | ADR  | Stage D 재실행 |
|--------|-----------|------|---------------|
| P0     | 즉시 수정 | 불필요 | 필수          |
| P1     | 수정      | 필요  | 필수          |
| P2     | 수정+문서화| 선택 | 권장          |
| P3     | ADR 결정  | 필수  | 불필요        |

## B_review
- 재현 절차 없는 지적 → "추정" (낮은 우선순위)
- 계약 변경 → semver 영향 평가 필수
- P1 이상 수정 시 ADR 자동 생성
- worklog/B_review.md 업데이트
