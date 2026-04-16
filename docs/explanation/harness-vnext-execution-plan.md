# Harness vNext Execution Plan

## 목적

이 문서는 `my-module` 저장소의 현재 Workflow OS 하네스를 유지하면서도, 프로젝트 전체를 더 높은 정확도, 안정성, 관측성, 보안성, 비용 효율로 끌어올리기 위한 실행 계획이다.

핵심 방향은 아래 4가지다.

1. 기존 `Work Packet + validation profile + operator cockpit + evidence` 구조는 유지한다.
2. 여기에 `mode router + structured contract + eval plane + security gate + cost routing`을 추가한다.
3. 프롬프트 문구만 바꾸지 말고, 프롬프트 운영 제어면(control plane)을 저장소 안에 만든다.
4. 현재 진행 중인 runtime/governance 흐름과 충돌하지 않도록, vNext는 별도 브랜치와 별도 packet 체인으로 추진한다.

## 현재 기준선

- 현재 저장소에는 이미 아래 핵심 기반이 있다.
  - `requirements/harness-engineering.yaml`
  - `requirements/validation-profiles.yaml`
  - `docs/harness/CONTINUOUS_PROMPT.md`
  - `scripts/session_bootstrap.js`
  - `scripts/operator_cockpit.js`
  - `src/infrastructure/telemetry.js`
- 현재 부족한 것은 하네스 문구보다 운영 계층이다.
  - 명시적 `mode` 분기
  - 출력 스키마와 truthfulness 계약
  - offline/online eval
  - red-team security gate
  - prompt/model/cost routing observability
- 현 시점 워크트리는 artifact 변경이 이미 있으므로, 이 계획은 `current-wp`와 queue를 직접 수정하지 않고 별도 packet으로 실행한다.

## 최종 목표 상태

최종적으로 하네스는 아래 제어면을 가져야 한다.

1. Input Contract Plane
   - 모든 요청을 `goal/context/constraints/done_when/work_mode/verification`으로 정렬
   - 데이터 신뢰 경계와 출력 형식을 명시
2. Mode Router
   - `Research`, `Build`, `Debug`, `Operate`, `Policy`
   - `packet_type`와 별도 축으로 관리
3. Execution Engine
   - 툴 사용, 내부 다경로 추론, 검증 루프, evidence 상태 관리
4. Eval Plane
   - golden set, 회귀, safety, cost, latency 기준선
5. Observability Plane
   - `prompt_version`, `mode`, `model`, `tokens`, `cache`, `tool_count`, `eval_run_id`
6. Release Plane
   - flag rollout, rollback, champion/challenger, prompt release evidence

## 실행 원칙

- 현재 `packet_type`는 저장소 작업 분류로 유지한다.
- 새 `mode`는 LLM 실행 전략으로 별도 도입한다.
- `Research`만 전역 스캔 허용, 나머지는 1구역 원칙 유지.
- 근거 없는 `PASS`는 금지한다.
- 구조화 출력과 검증 스키마가 없는 하네스 변경은 merge하지 않는다.
- 자동 최적화는 코어 하네스가 아니라 가변 모듈에만 적용한다.

## 브랜치 및 packet 전략

권장 브랜치:

```bash
feature/core-harness-vnext-control-plane
```

권장 packet 체인:

1. `WP-HARNESS-VNEXT-001`
   - 계획 문서와 추진 전략 고정
2. `WP-HARNESS-VNEXT-002`
   - 기준선 캡처와 계약 파일 추가
3. `WP-HARNESS-VNEXT-003`
   - mode router 도입
4. `WP-HARNESS-VNEXT-004`
   - structured output / truthfulness contract 도입
5. `WP-HARNESS-VNEXT-005`
   - eval harness 기본 세트 구축
6. `WP-HARNESS-VNEXT-006`
   - telemetry / metrics 확장
7. `WP-HARNESS-VNEXT-007`
   - security / RAG trust boundary gate
8. `WP-HARNESS-VNEXT-008`
   - cost / latency routing
9. `WP-HARNESS-VNEXT-009`
   - rollout / rollback / release evidence 체계화
10. `WP-HARNESS-VNEXT-010`
   - baseline recovery + commit guard 운영 정리
11. `WP-HARNESS-VNEXT-011`
   - runtime/model adapter 소비 경로 연결

## 단계별 상세 실행 계획

### Phase 0. Baseline Freeze

목표:

- 현재 하네스를 계량 가능한 기준선으로 고정한다.

추가/수정 대상:

- `docs/explanation/harness-vnext-execution-plan.md`
- `contracts/harness/intake.schema.json`
- `contracts/harness/output.schema.json`
- `evals/metrics/baseline.json`
- `evals/golden/harness-core.jsonl`

할 일:

- 현재 하네스 입력/출력 계약을 JSON Schema로 명문화한다.
- 최소 golden set을 만든다.
  - research형 10개
  - build형 10개
  - debug형 10개
  - policy/safety형 10개
- baseline metric을 채운다.
  - schema violation rate
  - false pass count
  - average input tokens
  - average output tokens
  - p95 latency
  - retry / re-ask rate

검증 명령:

```bash
npm run validate:requirements
npm run project:status
npm run wp:reconcile
```

완료 기준:

- 하네스 변경 전/후를 비교할 수 있는 baseline artifact가 존재한다.

롤백:

- `contracts/harness/*`, `evals/*`만 되돌리면 된다.

### Phase 1. Mode Router

목표:

- `packet_type`와 독립된 `mode`를 도입한다.

추가/수정 대상:

- `requirements/harness-engineering.yaml`
- `docs/harness/CONTINUOUS_PROMPT.md`
- `scripts/session_bootstrap.js`
- `scripts/operator_cockpit.js`
- `docs/reference/ai-harness-data-dictionary.md`

할 일:

- `mode_router` 블록 추가
  - `Research`
  - `Build`
  - `Debug`
  - `Operate`
  - `Policy`
- mode별 허용 규칙 추가
  - 구역 제한
  - 검증 강도
  - 툴 사용 허용
  - 인용 요구
- bootstrap / cockpit 출력에 아래 메타 추가
  - `mode`
  - `risk_level`
  - `evidence_status`
  - `output_contract`

검증 명령:

```bash
npm run validate:requirements
npm run lint
npm run project:status
npm run session:bootstrap -- --json
npm run operator:cockpit -- --json
```

완료 기준:

- 동일 `packet_type` 안에서도 조사형/구현형/운영형이 다른 경로로 라우팅된다.

롤백:

- `mode_router` 필드와 bootstrap/cockpit 출력 필드를 제거한다.

### Phase 2. Structured Output + Truthfulness Contract

목표:

- 하네스가 허위 완료 선언을 구조적으로 못 하게 만든다.

추가/수정 대상:

- `contracts/harness/output.schema.json`
- `requirements/harness-engineering.yaml`
- `requirements/validation-profiles.yaml`
- `docs/harness/CONTINUOUS_PROMPT.md`
- `scripts/resolve_validation_profile.js`

할 일:

- 출력 스키마에 아래 필드 추가
  - `verification_status`
  - `evidence_status`
  - `tests_run`
  - `tests_planned`
  - `open_questions`
  - `rollback_plan`
- 규칙 추가
  - 근거 없으면 `PASS` 금지
  - 실행 안 했으면 `planned`
  - 로그 없으면 `not_observed`
- validation profile에 “truthfulness checks”를 연결한다.

검증 명령:

```bash
npm run validate:requirements
npm run lint
npm run validate:composition
npm run commit:guard:verify
```

완료 기준:

- evidence 없는 완료 선언이 스키마/validator에서 실패한다.

롤백:

- 새 출력 필드를 optional로 낮추고 validator strictness를 제거한다.

### Phase 3. Eval Plane

목표:

- 프롬프트 변경을 코드처럼 평가하고 회귀를 막는다.

추가/수정 대상:

- `evals/golden/harness-core.jsonl`
- `evals/cases/research.jsonl`
- `evals/cases/build.jsonl`
- `evals/cases/debug.jsonl`
- `evals/cases/policy.jsonl`
- `evals/metrics/baseline.json`
- `scripts/` 아래 eval runner 추가
- `package.json`

할 일:

- 최소 5축 평가 정의
  - task success
  - schema compliance
  - faithfulness
  - safety
  - cost / latency
- eval runner 스크립트 추가
  - baseline vs candidate 비교
  - regression threshold 적용
- prompt release 전에 eval이 먼저 실행되도록 CI 명령 추가

검증 명령:

```bash
npm run validate:requirements
npm run lint
npm run test:contract
npm run test:e2e-smoke
```

완료 기준:

- 하네스 변경이 golden set과 safety set을 통과하지 않으면 promote되지 않는다.

롤백:

- eval runner를 advisory-only로 낮추고 blocking gate를 해제한다.

### Phase 4. Observability Plane

목표:

- 하네스 성능을 추적 가능한 지표로 본다.

추가/수정 대상:

- `src/infrastructure/telemetry.js`
- `scripts/record-metrics.js`
- `master-shell/observability/config.yaml`
- 필요 시 `scripts/health-dashboard.js`

할 일:

- 로그/트레이스에 아래 필드 추가
  - `prompt_version`
  - `mode`
  - `packet_type`
  - `model`
  - `reasoning_effort`
  - `tool_count`
  - `gen_ai.usage.input_tokens`
  - `gen_ai.usage.output_tokens`
  - `gen_ai.usage.cache_read.input_tokens`
  - `eval_run_id`
- OpenTelemetry GenAI semantic conventions에 가깝게 맞춘다.
- 세션 메트릭 파일에 token ROI와 cache hit 관측을 추가한다.

검증 명령:

```bash
npm run lint
npm run check:observability
npm run health:json
npm run wp:health
```

완료 기준:

- 어떤 하네스/모델 조합이 비용과 성능을 망치는지 trace와 metric으로 보인다.

롤백:

- 새 필드를 optional logging으로 낮추고 기존 structured log 포맷을 유지한다.

### Phase 5. Security Gate

목표:

- RAG/검색/문서 입력을 붙여도 prompt injection과 data leakage 리스크를 줄인다.

추가/수정 대상:

- `security/policies/trust-boundary.yaml`
- `security/redteam/owasp-core.yaml`
- `requirements/harness-engineering.yaml`
- `docs/harness/CONTINUOUS_PROMPT.md`
- `package.json`

할 일:

- 외부 문서는 데이터이며 지시가 아니라는 규칙을 명문화한다.
- red-team 세트 추가
  - prompt injection
  - system prompt exfiltration
  - excessive agency
  - tool abuse
  - data leakage
- 향후 Promptfoo 연결이 가능하도록 config placeholder를 둔다.

검증 명령:

```bash
npm run validate:requirements
npm run lint
npm run check:advisory-policy
npm run test:e2e-smoke
```

완료 기준:

- safety/policy mode에서 신뢰 경계가 계약과 테스트 케이스로 존재한다.

롤백:

- red-team gate를 blocking에서 warning으로 내린다.

### Phase 6. Cost / Latency Router

목표:

- 쉬운 작업은 싼 모델로, 어려운 작업은 강한 모델로 보낸다.

추가/수정 대상:

- `master-shell/catalog/context-routing-profiles.yaml`
- `master-shell/catalog/ai-runtime-recipes.yaml`
- `requirements/harness-engineering.yaml`
- `master-shell/feature-flags/flags.yaml`
- 필요 시 `scripts/project_status.js`

할 일:

- mode별 모델 라우팅 정책 추가
  - `Research`: frontier
  - `Build`/`Operate`: mini 기본
  - `intake normalization`: nano 가능
- 공통 prefix를 캐시 가능한 구조로 고정한다.
- 비실시간 평가/대량 replay는 batch 대상으로 분리한다.
- 긴 비동기 처리 후보는 background mode 플래그로 분리한다.

검증 명령:

```bash
npm run validate:requirements
npm run validate:composition
npm run check:feature-flags
npm run project:status
```

완료 기준:

- 같은 품질에서 평균 입력 토큰과 평균 응답 비용이 내려간다.

롤백:

- 모든 mode를 단일 기본 모델 정책으로 되돌린다.

### Phase 7. Rollout / Rollback / Release Evidence

목표:

- 하네스 변경을 배포 가능한 제품 릴리즈처럼 다룬다.

추가/수정 대상:

- `artifacts/provenance/provenance-policy.yaml`
- `scripts/generate_release_evidence.py`
- `scripts/generate_promotion_decision.py`
- `scripts/operator_cockpit.js`
- `master-shell/feature-flags/metadata.json`

할 일:

- `prompt_version`를 evidence에 고정한다.
- champion/challenger 비교 필드 추가
  - baseline prompt
  - candidate prompt
  - eval delta
  - rollback target
- feature flag 기반 단계 rollout 추가
  - dry-run
  - shadow
  - limited rollout
  - default

검증 명령:

```bash
npm run validate:requirements
npm run validate:composition
npm run generate:release-evidence
npm run wp:promote-pipeline
```

완료 기준:

- prompt 변경도 versioned release evidence로 남고 즉시 롤백 가능하다.

롤백:

- 이전 `prompt_version`와 이전 flag set으로 즉시 복귀한다.

## 권장 커밋 순서

1. `docs(harness): add harness vnext execution plan and baseline contracts`
2. `feat(harness): add mode router and operator metadata`
3. `feat(harness): enforce structured output and truthfulness contract`
4. `feat(evals): add harness golden set and regression runner`
5. `feat(observability): add prompt/version/token telemetry fields`
6. `feat(security): add trust boundary and red-team harness rules`
7. `feat(routing): add model and cost routing policies`
8. `feat(release): add prompt rollout and rollback evidence flow`

## 권장 검증 번들

각 phase 종료 시 최소 아래를 돌린다.

```bash
npm run validate:requirements
npm run lint
npm run validate:composition
npm run test:contract
npm test
npm run test:e2e-smoke
npm run project:status
```

추가 조건:

- eval runner가 붙은 이후부터는 golden set regression을 필수로 포함한다.
- security gate가 붙은 이후부터는 red-team smoke를 필수로 포함한다.

## 합격 기준

- schema violation rate `< 1%`
- false pass count `= 0`
- research형 성공률 `+15%p` 이상
- 반복 세션 평균 입력 토큰 `30%` 이상 절감
- 주요 safety attack 취약률 목표 이하
- `prompt_version` 기준 rollback 가능

## 이번 계획의 비목표

- 현재 진행 중인 `current-wp`를 덮어쓰지 않는다.
- 현재 queue나 checkpoint를 강제로 재배치하지 않는다.
- 기존 Workflow OS packet 모델을 폐기하지 않는다.
- 하네스 코어가 안정화되기 전 자동 prompt optimizer를 핵심 경로에 넣지 않는다.

## 참고 기준

- OpenAI Evals guide
- OpenAI Structured Outputs guide
- OpenAI Background mode guide
- OpenTelemetry GenAI/OpenAI semantic conventions
- OWASP LLM/GenAI security guidance
- DSPy, OPRO, ReAct 논문
