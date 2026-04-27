---
name: stage-d-implement
description: Stage D 품질 게이트 구현. Clean Architecture 안쪽→바깥으로 구현. 15가지 품질 게이트 실행. CoVe 자기검증 포함.
---

## 읽기 순서
1. memory/stageA/[id].yaml
2. domains/[id]/contracts/ (4종)
3. memory/reflections/[id]-stageD-*.yaml (이전 실패 교훈)
4. memory/L0-hot/failure-patterns.yaml (반복 실패 패턴 먼저 방어)

## 구현 순서 (의존성 규칙: 안쪽→바깥)
1. domain/value-objects/    (Object.freeze(this))
2. domain/entities/          (불변: 새 인스턴스 반환)
3. domain/services/
4. domain/events/
5. application/ports/        (인터페이스, _접두사)
6. application/[Action]UseCase.js (권한 검사 먼저)
7. infrastructure/InMemory*.js
8. interface/Controller.js   (authz + 직렬화)
9. tests/domain/             (INV 불변조건 단위 테스트)
10. tests/application/
11. tests/interface/         (authz regression)

## 코딩 패턴 (변경 금지)
- 엔티티: `return new Entity({ ...this._snapshot(), status: newStatus })`
- 값 객체: 생성자에서 `Object.freeze(this)`
- 컬렉션: `this.items = Object.freeze([...(items || [])])`
- 오류: `throw Object.assign(new Error('INV-XXX: ...'), { code: 'CONFLICT' })`
- 유스케이스: `execute(cmd, caller)` 첫 줄에서 권한 검사
- 포트: `async findById(_id) { throw new Error('Not implemented'); }`

## 품질 게이트 15가지
1. 단위 테스트 (node --test)
2. 불변조건 커버리지 100%
3. 계약 드리프트 검증 (validate-contracts.js)
4. E2E 스모크
5. ESLint 0 errors
6. 문법 검사 (node --check)
7. 정적 분석
8. 시크릿 스캔 0건
9. 의존성 스캔
10. authz regression 100% PASS
11. 입력 검증
12. 아키텍처 경계 검사 (architecture-fitness.js)
13-15. SBOM/빌드증명/관측성 — NOT_CONFIGURED 허용

## Chain-of-Verification (게이트 PASS 후)
1. "이 테스트가 정말 INV를 검증하는가?" 검토
2. "PASS해도 위반 가능한 입력이 존재하는가?" 탐색
3. 불일치 발견 시 테스트 보완 → 재검증
4. memory/stageD/[domain]-cove.yaml에 결과 기록

## 판정
- PASS = 필수(1~12) 전부 PASS
- PARTIAL_PASS = 필수 PASS + Phase2 NOT_CONFIGURED
- FAIL = 필수 1개 이상 FAIL → reflection-loop skill 호출

## Chain-of-Verification (게이트 15가지 PASS 후 자기검증)

검증 질문 (각 INV에 대해):
1. "테스트 {test_name}은 정말 INV-{XXX}를 검증하는가?"
2. "이 테스트가 PASS해도 INV가 위반될 수 있는 입력이 존재하는가?"
3. "enforcement 레이어가 domain-entity인데, use-case에서도 확인하는가?"

불일치 발견 시:
- 테스트 보완 → 재검증
- 경계값 테스트 추가
- enforcement 레이어 누락 → 해당 레이어에 검증 코드 추가

결과 기록: memory/stageD/[domain]-cove.yaml
```yaml
cove_results:
  timestamp: "ISO-8601"
  questions_generated: N
  mismatches_found: N
  corrections_made: []
```
