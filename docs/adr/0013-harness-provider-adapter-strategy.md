---
adr_id: "0013"
title: "ADR-0013: Harness Provider Adapter 전략 — Router-First Port + Null Fallback"
status: ACCEPTED
date: "2026-04-15"
deciders: ["architect-agent", "reviewer-agent"]
stage: B
domain: harness-provider-adapter
risk_level: HIGH
---

# ADR-0013: Harness Provider Adapter 전략 — Router-First Port + Null Fallback

## Status

ACCEPTED

## Context

현재 저장소는 `HarnessRuntimeRouter`를 통해 mode/flag/release metadata를 계산하고,
이 snapshot을 `session:bootstrap`, `operator:cockpit`, `/health`, `/readyz`에서 동일하게 노출한다.

하지만 `KI-HARNESS-001`이 남아 있다.

- routing snapshot은 존재하지만 실제 외부 provider adapter는 아직 연결되지 않았다.
- 따라서 운영 surface가 보여주는 route와 실제 LLM 실행 경로가 분리될 위험이 있다.
- live provider를 붙일 때 예산, timeout, retry, fallback, eval logging, OTel 필드가 저장소 계약으로 먼저 고정돼야 한다.

## Decision

다음 전략을 채택한다.

1. `HarnessRuntimeRouter`를 **provider selection의 단일 truth surface**로 유지한다.
2. 실제 provider SDK 호출은 `HarnessProviderAdapter`라는 **별도 port** 뒤로 격리한다.
3. 자격증명 부재, rollout off, sandbox 환경에서는 `NullHarnessProvider`를 **기본 fallback**으로 유지한다.
4. provider metadata는 응답 본문이 아니라 **telemetry/eval/release evidence**에 기록한다.
5. 첫 live provider 후보는 `openai-responses`로 두되, vendor 세부사항이 UI/route surface로 새지 않게 한다.

## Rationale

### 왜 router-first 인가

- 이미 운영 surface가 `HarnessRuntimeRouter` snapshot을 truth surface로 소비한다.
- 여기에 다른 selection 로직을 추가하면 bootstrap/cockpit과 실제 실행 경로가 어긋난다.
- 따라서 provider wiring도 route snapshot을 입력으로만 받아야 한다.

### 왜 port/adapter 인가

- provider SDK는 timeout, auth, retry, structured output, batch 정책이 vendor마다 다르다.
- 이 차이를 `createServer`나 UI surface로 올리면 결합이 커지고 테스트가 어려워진다.
- port 뒤로 숨기면 OpenAI 이후 다른 provider를 붙여도 routing/telemetry/output contract는 유지할 수 있다.

### 왜 null fallback을 남기나

- 현재 저장소는 샌드박스와 secret 부재 상황에서도 smoke/contract 루프를 돌려야 한다.
- live provider가 없다고 운영 surface 전체가 깨지면 안 된다.
- deterministic null fallback이 있으면 rollout 전에도 contract/observability/eval 경계를 검증할 수 있다.

## Consequences

### 긍정적

- route snapshot과 실제 provider selection이 같은 기준으로 정렬된다.
- live provider가 아직 없더라도 설계/검증/rollback 경계를 먼저 고정할 수 있다.
- 응답 본문 contract를 그대로 유지해 기존 harness validator와 truthfulness contract를 보존한다.

### 부정적

- provider metadata가 응답 본문에 직접 나타나지 않으므로 운영자는 telemetry/eval surface를 함께 봐야 한다.
- live provider 구현 단계에서 secret, timeout, retry 정책을 코드와 문서에 동시에 반영해야 한다.

## Rejected Alternatives

### createServer에 provider SDK 호출 직접 삽입

- 기각 이유: server wiring과 vendor 세부사항이 결합되고, null/live 전환 테스트가 어려워진다.

### route snapshot과 별도 provider selector 추가

- 기각 이유: bootstrap/cockpit과 실제 실행 경로가 어긋날 수 있다.

### provider metadata를 output schema에 추가

- 기각 이유: truthfulness/output contract의 소비자 범위를 넓혀 기존 harness validator와 eval baseline을 불필요하게 흔든다.

## Rollout / Rollback

### Rollout

1. `WP-HARNESS-VNEXT-014`에서 provider port + null/live adapter skeleton 구현
2. live-provider flag와 secret gating 추가
3. smoke/eval/telemetry evidence가 확보된 뒤 limited rollout

### Rollback

1. live-provider flag off
2. `NullHarnessProvider` 강제 fallback
3. release evidence의 rollback target으로 이전 prompt/provider 조합 기록

## References

- `contracts/harness/provider-adapter.yaml`
- `memory/stageA/harness-provider-adapter.yaml`
- `memory/stageB/harness-provider-adapter.yaml`
- `src/infrastructure/HarnessRuntimeRouter.js`
- `src/infrastructure/telemetry.js`
