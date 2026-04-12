# Validation Profiles

이 문서는 Work Packet `type`별 최소 검증 묶음을 고정한다. 목적은 세션마다 "이번 작업에 무슨 테스트를 돌려야 하나"를 다시 길게 설명하지 않는 것이다.

기준 파일은 [requirements/validation-profiles.yaml](/root/workspace/my-module/requirements/validation-profiles.yaml) 이다.

## 원칙

- profile은 최소 권장 검증이다.
- 특정 packet의 `validation` 필드가 더 구체적이면 그것을 추가로 실행한다.
- 같은 명령은 중복 없이 1회만 추천한다.
- Stage D/E는 stage override로 더 엄격해진다.

## Packet Type 기준

| type | 의미 | 최소 검증 초점 |
| --- | --- | --- |
| `planning` | packet/route/context 판단 | `project:status`, `wp:next`, `wp:reconcile`, `wp:check-fit` |
| `policy` | 규칙/제약/정책 변경 | `validate:composition`, policy check |
| `domain` | 도메인 로직/계약/저장 경로 | `test:contract`, `test`, `test:integration`, `test:e2e-smoke` |
| `shell` | master UI / plugin composition | `validate:composition`, `lint`, `test:e2e-smoke` |
| `executor` | scheduler/apply/promotion orchestration | `lint`, `test:e2e-smoke`, `wp:reconcile` |
| `governance` | CI/release/protection/deployment governance | governance validators + composition/lint |
| `arch` | 구조/상태면/cross-cutting 변경 | `lint`, `type-check`, `validate:composition`, `test:e2e-smoke` |
| `infra` | validator/tooling/baseline | `lint`, `type-check`, `scan:dependencies` |
| `meta` | docs/truthfulness/meta automation | `project:status`, `wp:reconcile` |

## 사용법

세션 시작:

```bash
npm run session:bootstrap
```

현재 packet 검증 프로파일만 따로 확인:

```bash
node scripts/resolve_validation_profile.js
node scripts/resolve_validation_profile.js --json
```

## 왜 필요한가

- 토큰 절약: 검증 설명을 매번 채팅으로 다시 쓰지 않는다.
- 일관성: 같은 packet type은 같은 최소 검증 기준을 따른다.
- 점진성: 기본 profile + packet.validation + stage override를 합쳐 필요한 만큼만 강화한다.
