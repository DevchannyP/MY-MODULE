# Prompt Harness Full Review And Plan

## 문서 목적

이 문서는 `my-module` 저장소 전체를 기준으로 현재 프롬프트 하네스의 구조, 강점, 갭, 개선 우선순위, 실행 계획을 한 파일에 정리한 저장소 기준면이다.

목표는 단순히 "프롬프트를 더 잘 쓰자"가 아니다. 이 저장소가 이미 갖고 있는 `requirements + contracts + memory + work packet + eval + observability + release evidence` 구조를 이용해, 프롬프트 하네스를 운영 제어면(control plane) 수준으로 끌어올리는 것이다.

기준 시점:

- 분석 시점: `2026-04-19`
- 확인한 실행 결과:
  - `npm run project:status`
  - `npm run session:bootstrap -- --json`
  - `node scripts/run-harness-evals.js --json`
  - `node scripts/validate-harness-contract.js`
  - `python3 scripts/validate_harness_security.py`

확인된 현재 기준선:

- `requirements_stage`: `D`
- `current_wp`: `SPIRAL-19-COMPLETE`
- `wp-queue`: `83/83 done`, `next_wp: NONE`
- promotion pipeline: `available=true`, `promotion_ready=true`, `drift_status=clean`
- harness eval baseline: `PASS`, golden set `10`, case files `5`
- harness contract validation: `PASS`
- harness security baseline validation: `PASS`

저장소 규모 요약:

- `docs`: 55 files
- `scripts`: 156 files
- `contracts`: 10 files
- `requirements`: 12 files
- `master-shell`: 28 files
- `src`: 123 files
- `domains`: 145 files
- `evals`: 7 files
- `memory`: 50 files
- `worklog`: 119 files
- `artifacts`: 615 files

---

## 1. 프로젝트 전체 구조 설명

### 1.1 이 저장소가 실제로 하는 일

이 저장소는 단순한 앱 저장소가 아니라, 다음을 하나로 묶은 Workflow OS 코어다.

1. 도메인 애플리케이션 저장소
2. 계약 중심 조합 플랫폼
3. Work Packet 기반 운영 시스템
4. AI 하네스 제어면
5. 품질/보안/릴리즈 증적 저장소

즉, 이 저장소에서 프롬프트 하네스는 별도 부속물이 아니라 운영 레이어 한 축이다.

### 1.2 최상위 폴더별 역할

| 경로 | 역할 | 현재 의미 |
| --- | --- | --- |
| `requirements/` | 입력 진실원 | 어떤 모듈을 어떤 Stage에서 어떤 제약으로 운영하는지 정의 |
| `contracts/` | 시스템 전역 계약 | harness, events, system-api, ui-shell 같은 cross-cutting contract |
| `domains/` | 실제 비즈니스 도메인 | `billing`, `productivity/task-tracking`, `video` 구현과 테스트 |
| `src/` | 코어 런타임 | HTTP 서버, feature flag, telemetry, harness runtime router, shared runtime |
| `scripts/` | 운영 자동화 엔진 | validation, stage runner, status, packet, evidence, UI generator, eval runner |
| `master-shell/` | 조합/관측 메타데이터 | plugin registry, navigation, flags, observability, catalog |
| `memory/` | canonical session state | current-state, current-wp, queue, stage snapshots |
| `evals/` | 하네스 평가 입력 | golden set, case files, metric baseline |
| `security/` | 보안 정책과 red-team baseline | trust boundary, OWASP core attack categories |
| `docs/` | how-to / explanation / reference / ADR | 운영 규약과 설계 설명 |
| `worklog/` | 실제 작업 증적 | Work Packet별 실행 근거 |
| `artifacts/` | 생성 산출물 | release evidence, planner, mindmap, quality, eval reports |

### 1.3 Requirements 레이어

`requirements/requirements.yaml`은 현재 활성 모듈 기준 진실원이다.

- 현재 활성 모듈: `task-management`
- 현재 stage: `D`
- quality gate 묶음, feature flag, routing, composition을 함께 가진다

`requirements/domain-map.yaml`은 저장소 안의 도메인 레지스트리다.

- `productivity/task-tracking`
- `billing`
- `video`

`requirements/constraints.yaml`은 저장소 전체 하드 제약이다.

- 모듈 간 직접 코드 참조 금지
- 도메인 코어 외부 프레임워크 import 금지
- 계약 없는 모듈 금지
- ADR 없는 구조 판단 금지
- FAIL 상태 완료 선언 금지

`requirements/nfr.yaml`은 성능, 신뢰성, 보안, 관측성, 공급망 기준선이다.

프롬프트 하네스 관점에서 이 레이어는 "무엇을 지켜야 하는가"를 정의한다.

### 1.4 Contracts 레이어

`contracts/harness/`는 현재 프롬프트 하네스의 공식 계약 축이다.

- `intake.schema.json`
  - 입력 packet 기본 스키마
  - `goal/context/constraints/done_when/work_mode/verification` 필수
- `output.schema.json`
  - 출력 truthfulness 계약 후보
  - `verification_status`, `evidence_status`, `tests_run`, `rollback_plan` 등을 요구
- `provider-adapter.yaml`
  - runtime router가 계산한 route를 provider invocation으로 연결하는 계약

즉, 하네스는 이미 "프롬프트 문구"가 아니라 "입력/출력/라우팅 계약"으로 진화 중이다.

### 1.5 Domains 레이어

도메인은 총 3개다.

#### `domains/productivity/task-tracking`

- 용도: 작업 생성, 조회, 상태 전이, 담당자 변경
- 구조:
  - domain: `Task`, `TaskStatus`, `TaskEvents`
  - application: use case 5개
  - infrastructure: InMemory, SQLite, Postgres, Outbox
  - interface: `TaskController`
- 특징:
  - clean architecture를 가장 정석적으로 반영
  - optimistic locking, outbox, event publishing까지 포함

#### `domains/billing`

- 용도: 인보이스, 결제, 정산 예외 처리
- 구조:
  - domain: `Invoice`, `Payment`, `BillingException`, `Money`, `InvoiceStatus`
  - application: invoice/payment/exception 흐름
  - infrastructure: InMemory, SQLite, Postgres
  - interface: `BillingController`
- 특징:
  - 금액 정합성과 상태 불변조건이 강하다
  - 프롬프트 하네스의 `risk_level`, truthfulness, approval, evidence 설계를 검증하기 좋은 도메인

#### `domains/video`

- 용도: 영상 업로드, 트랜스코딩, 접근정책, 아카이브
- 구조:
  - domain: `Video`, `TranscodeJob`
  - application: upload/list/get/transcode/archive/access-policy
  - infrastructure: InMemory, SQLite, Postgres
  - interface: `VideoController`
- 특징:
  - 상태 전이와 비동기 작업 경계가 있어 `mode router`, `operate`, `debug` 하네스 실험에 적합

테스트 수량:

- `billing/tests`: 26 files
- `productivity/task-tracking/tests`: 21 files
- `video/tests`: 17 files

### 1.6 `src/` 코어 런타임 레이어

`src/index.js`

- 서버 시작점
- startup diagnostic 실행
- graceful shutdown 처리

`src/server/createServer.js`

- 저장소의 실질적 런타임 중심축
- task/billing/video/system/harness/control center 관련 HTTP surface가 여기에 집중
- feature flag, telemetry, event bus, rate limit, idempotency, dynamic UI, stage run, automation bridge까지 묶음

이 파일은 현재 기능적으로 강하지만, 하네스 관점에서는 너무 많은 책임이 모여 있다.

`src/infrastructure/HarnessRuntimeRouter.js`

- 현재 하네스 mode 기반 라우팅의 단일 truth surface
- `Research/Build/Debug/Operate/Policy`를 `frontier/standard/mini` tier와 연결
- release evidence와 feature flag를 route metadata에 포함

`src/infrastructure/ai/HarnessProviderAdapter.js`

- provider chain 결정
- fallback 적용
- telemetry 기록
- eval artifact append

`src/infrastructure/ai/OpenAIResponsesProvider.js`

- OpenAI Responses API payload 빌드
- timeout/model tier 처리
- output text 추출
- usage/token 집계

`src/infrastructure/telemetry.js`

- OpenTelemetry 스타일 tracer/meter/logger 경량 구현
- RED metrics와 GenAI client metrics를 같이 관리

### 1.7 Scripts 레이어

이 저장소의 실제 운영 자동화는 대부분 `scripts/`에 있다.

프롬프트 하네스와 직접 연결되는 핵심 스크립트:

- `scripts/project_status.js`
  - 현재 저장소 상태를 구조화 출력
- `scripts/session_bootstrap.js`
  - 세션 시작 시 읽을 파일/명령/검증 profile을 제안
- `scripts/resolve_validation_profile.js`
  - packet type과 stage 기반 최소 검증 묶음 계산
- `scripts/operator_cockpit.js`
  - bootstrap, branch, commit guard, release evidence를 하나로 묶음
- `scripts/run-harness-evals.js`
  - golden set과 case files를 오프라인 검증
- `scripts/validate-harness-contract.js`
  - schema / golden set / harness yaml / provider contract 정합성 검증
- `scripts/validate_harness_security.py`
  - trust boundary / red-team baseline 존재 여부 검증

즉, 이 저장소는 "하네스가 있다고 주장"하는 수준이 아니라, 이미 validator와 runner를 갖고 있다.

### 1.8 Master Shell 레이어

`master-shell/`은 도메인과 시스템 surface를 마스터 UI에 편입시키는 메타 레이어다.

- `plugin-registry/registry.yaml`
  - 어떤 플러그인이 어떤 계약과 observability, rollout, rollback을 갖는지 정의
- `navigation/nav.yaml`
  - 마스터 UI 메뉴 구조
- `feature-flags/flags.yaml`
  - 런타임 활성화 제어
- `observability/config.yaml`
  - dashboard, alert group, global logging/tracing 기준
- `catalog/`
  - benchmark, domain, runtime recipe, execution packet, planning mode 등 지식 카탈로그

프롬프트 하네스의 상위 목적은 결국 이 master shell에서 "현재 어떤 packet이 어떤 lane에 있고 무엇을 해야 하는가"를 정확히 드러내는 것이다.

### 1.9 Memory 레이어

`memory/`는 현재 canonical session surface다.

핵심 파일:

- `memory/checkpoint.yaml`
- `memory/current-state.yaml`
- `memory/current-wp.yaml`
- `memory/next-actions.yaml`
- `memory/wp-queue.yaml`

보조 파일:

- `memory/stageA~E/`
- `memory/project/*` legacy fallback

프롬프트 하네스가 세션을 이어가는 핵심은 이 레이어를 먼저 읽는 데 있다.

### 1.10 Evals / Security / Worklog / Artifacts

`evals/`

- 현재 golden set 10개
- case file 5개
- mode coverage는 5개 mode 모두 포함

`security/`

- trust boundary 정책 존재
- OWASP core red-team baseline 존재

`worklog/`

- Work Packet 증적과 수기 보조 문서 축적

`artifacts/`

- 생성물 저장소
- planner, quality, rollback, release evidence, sbom, provenance, eval report, mindmap 등 다수 보유

이 네 레이어는 "하네스가 잘 말하느냐"보다 "하네스가 거짓 없이 운용되느냐"를 지지한다.

---

## 2. 현재 프롬프트 하네스가 실제로 어떻게 동작하는가

현재 하네스는 아래 경로로 이어진다.

1. 운영 규칙 정의
   - `requirements/harness-engineering.yaml`
   - `docs/harness/CONTINUOUS_PROMPT.md`
   - `docs/how-to/repeatable-cli-master-prompt.md`
2. 현재 상태 복구
   - `memory/checkpoint.yaml`
   - `memory/current-state.yaml`
   - `memory/current-wp.yaml`
   - `memory/wp-queue.yaml`
   - `memory/next-actions.yaml`
3. session bootstrap
   - `scripts/session_bootstrap.js`
4. packet별 검증 프로파일 계산
   - `requirements/validation-profiles.yaml`
   - `scripts/resolve_validation_profile.js`
5. runtime route 계산
   - `src/infrastructure/HarnessRuntimeRouter.js`
6. provider invocation
   - `src/infrastructure/ai/HarnessProviderAdapter.js`
   - `src/infrastructure/ai/OpenAIResponsesProvider.js`
7. telemetry / eval artifact / release evidence
   - `src/infrastructure/telemetry.js`
   - `artifacts/evals/harness/latest/harness-eval-report.json`
   - `artifacts/release-evidence/release-evidence.json`
8. operator surface 노출
   - `scripts/operator_cockpit.js`
   - `src/shared/uiRuntimeContracts.js`
   - `scripts/generate-ui-home.js`
   - `scripts/generate-mindmap.js`

이 설계는 이미 꽤 좋다. 문제는 "없는 것"보다 "있지만 아직 닫히지 않은 것"이 더 많다는 점이다.

---

## 3. 현재 기준선의 강점

### 3.1 canonical state가 실제로 존재한다

이 저장소는 root `memory/`를 중심으로 세션 지속성을 확보한다. 많은 저장소가 프롬프트 하네스를 채팅 습관 수준에 두는데, 여기서는 파일 기반 운영면이 이미 있다.

### 3.2 하네스 계약이 명문화되어 있다

`intake.schema.json`, `output.schema.json`, `provider-adapter.yaml`, `harness-engineering.yaml` 조합은 매우 좋은 출발점이다.

### 3.3 mode router가 이미 분리돼 있다

`Research/Build/Debug/Operate/Policy` 분기를 갖고 있고, route metadata도 release evidence와 flags에서 읽는다.

### 3.4 fallback과 observability가 붙어 있다

많은 하네스가 provider 호출 실패를 숨기는데, 여기서는 fallback, metrics, logs, eval artifact append가 존재한다.

### 3.5 work packet와 validation profile이 결합돼 있다

프롬프트 하네스가 "무조건 코딩"이 아니라 packet type과 stage에 맞는 검증 bundle을 계산하도록 설계돼 있다.

### 3.6 docs, scripts, tests가 함께 움직인다

설명 문서, validator, runtime, smoke test가 따로 놀지 않고 같은 구조를 가리키는 편이다.

### 3.7 security baseline이 있다

trust boundary와 OWASP core attack 분류가 있어, prompt injection 대응을 구조화할 발판이 있다.

---

## 4. 최고 수준 품질을 막는 핵심 갭

아래 항목이 현재 저장소에서 가장 중요한 개선 지점이다.

### GAP-01. 하네스 규칙이 여러 문서에 분산되어 있어 drift 위험이 높다

관련 파일:

- `CLAUDE.md`
- `requirements/harness-engineering.yaml`
- `docs/harness/CONTINUOUS_PROMPT.md`
- `docs/how-to/repeatable-cli-master-prompt.md`
- `docs/explanation/ai-harness-upgrade-plan.md`
- `docs/explanation/harness-vnext-execution-plan.md`

문제:

- 운영 규칙, 사용자용 설명, 향후 계획이 강하게 겹친다.
- 현재도 대체로 정렬되어 있지만, 문서 수가 늘수록 drift가 다시 생긴다.
- "최종 진실원"과 "파생 설명"의 경계가 문서 구조만으로는 충분히 강제되지 않는다.

개선 방향:

- 하네스 문서를 4계층으로 명확히 나눠야 한다.
  - L1 계약: `requirements/harness-engineering.yaml`
  - L2 실행 규약: `docs/harness/CONTINUOUS_PROMPT.md`
  - L3 operator seed: `docs/how-to/repeatable-cli-master-prompt.md`
  - L4 roadmap: `docs/explanation/*`
- 문서 간 필수 키 drift validator를 추가해야 한다.

### GAP-02. output schema가 런타임 응답을 강제하지 않는다

관련 파일:

- `contracts/harness/output.schema.json`
- `src/infrastructure/ai/HarnessProviderAdapter.js`
- `src/server/createServer.js`

문제:

- 스키마는 존재하지만 실제 provider 응답이 이 스키마를 end-to-end로 강제받는 구조는 아직 약하다.
- 현재 `/api/harness/prompt-recommendation`은 prompt 추천과 provider metadata 응답에 가깝고, 완전한 truthfulness envelope 실행기로 닫히지 않았다.

개선 방향:

- 런타임에서 output schema validator를 실제 적용
- schema mismatch를 provider failure가 아니라 contract failure로 분리
- `verification_status`, `evidence_status`, `rollback_plan`, `tests_run` 같은 필드를 실제 응답 수준으로 승격

### GAP-03. mode router가 아직 너무 적은 신호만 본다

관련 파일:

- `src/infrastructure/HarnessRuntimeRouter.js`
- `requirements/harness-engineering.yaml`
- `contracts/harness/provider-adapter.yaml`

문제:

- 현재 라우팅은 주로 `mode + feature flag` 중심이다.
- 실제 운영에는 아래 축이 더 필요하다.
  - `packet_type`
  - `risk_level`
  - `trust_level`
  - `context_budget`
  - `latency_budget`
  - `evidence_required`
  - `interactive vs batch`

개선 방향:

- mode router를 `task mode router`에서 `execution policy router`로 확장
- route snapshot에 리스크/보안/비용/증적 강도를 포함

### GAP-04. provider 입력 payload가 너무 얇다

관련 파일:

- `src/infrastructure/ai/OpenAIResponsesProvider.js`

문제:

- 현재 payload는 compacting은 잘 되어 있지만, 제어 신호가 약하다.
- trusted instruction / untrusted context / required output / forbidden claims / evidence policy 구분이 payload 구조에 강하게 반영되지 않는다.

개선 방향:

- payload를 다음 섹션으로 분리
  - stable instruction
  - trusted repo contract
  - untrusted data context
  - required output contract
  - verification requirements
  - refusal / uncertainty policy
- JSON string dump만이 아니라 섹션형 입력으로 구조화

### GAP-05. security validation이 구조 존재 검증에 치우쳐 있다

관련 파일:

- `security/policies/trust-boundary.yaml`
- `security/redteam/owasp-core.yaml`
- `scripts/validate_harness_security.py`

문제:

- 현재는 required snippet 존재 여부를 검사한다.
- 그러나 최고 수준 하네스는 "정책 파일이 있다"가 아니라 "정책 위반 시 실제로 실패한다"를 검증해야 한다.

개선 방향:

- behavioral red-team eval 추가
- prompt injection / prompt exfiltration / tool abuse / excessive agency 시나리오를 golden eval과 smoke test에 편입
- `/api/harness/prompt-recommendation` surface 대상으로 adversarial test 추가

### GAP-06. eval plane이 아직 오프라인 최소 기준선 수준이다

관련 파일:

- `evals/golden/harness-core.jsonl`
- `evals/cases/*.jsonl`
- `evals/metrics/baseline.json`
- `scripts/run-harness-evals.js`

문제:

- 현재 baseline은 좋지만 작다.
- golden 10개, mode당 2개는 world-class 수준에는 부족하다.
- live model grader, latency, retry, cost, safety score가 아직 미완성이다.

개선 방향:

- 최소 5축으로 확장
  - task success
  - schema compliance
  - truthfulness
  - safety
  - cost/latency
- domain-aware case를 추가
  - billing high-risk
  - video async/debug
  - task-tracking optimistic locking

### GAP-07. telemetry는 준비돼 있지만 live metric loop가 덜 닫혔다

관련 파일:

- `src/infrastructure/telemetry.js`
- `artifacts/evals/harness/latest/harness-eval-report.json`
- `evals/metrics/baseline.json`

문제:

- baseline에서 `average_input_tokens`, `average_output_tokens`, `p95_latency_ms`, `retry_rate`가 pending이다.
- metric naming은 좋지만 eval and release decision에 닫힌 루프가 아직 부족하다.

개선 방향:

- provider invocation마다 metric snapshot을 누적
- eval report와 release evidence에 동일 metric key를 반영
- prompt version별 비교표를 생성

### GAP-08. null provider fallback이 운영 환경에서 너무 조용할 수 있다

관련 파일:

- `src/infrastructure/ai/HarnessProviderAdapter.js`
- `contracts/harness/provider-adapter.yaml`

문제:

- 로컬과 샌드박스에서는 좋은 설계다.
- 하지만 운영/CI/실환경에서는 misconfiguration을 가려버릴 수 있다.

개선 방향:

- environment class 별 정책 분리
  - local: fallback 허용
  - CI: fallback 허용하되 `mixed/planned` 강제
  - staging/prod: fail-closed 또는 explicit degraded mode만 허용

### GAP-09. validation profile이 terminal stage를 충분히 모델링하지 않는다

관련 파일:

- `requirements/validation-profiles.yaml`
- `scripts/resolve_validation_profile.js`
- `memory/current-wp.yaml`

문제:

- 현재 `current_wp.stage`가 `complete`일 때도 governance profile이 일반 작업처럼 계산된다.
- queue가 비어 있는 상태와 진행 중 packet 상태를 같은 방식으로 다루는 것은 operator UX에 잡음을 만든다.

개선 방향:

- `COMPLETE`, `DONE`, `CLOSED`에 대한 terminal profile 도입
- queue-empty 상태를 위한 next-step bundle 분리
- bootstrap의 recommended commands를 상태별로 차등화

### GAP-10. rollout 상태와 runtime flag 상태 사이에 의미 drift 가능성이 있다

관련 파일:

- `master-shell/plugin-registry/registry.yaml`
- `master-shell/feature-flags/flags.yaml`

문제:

- registry에서는 `active`, `full`, `100%`로 보이는데 기본 flags는 여전히 `false`인 항목이 있다.
- 이것은 "정책상 활성"인지 "런타임 기본값은 비활성"인지 문맥을 모르면 혼동된다.

개선 방향:

- rollout state를 다음 3축으로 분리
  - policy readiness
  - default runtime exposure
  - actual environment exposure

### GAP-11. generated artifact가 너무 많아 source-of-truth 탐색을 방해한다

관련 경로:

- `artifacts/` 전체

문제:

- 생성 산출물이 615개로 크다.
- 프롬프트 하네스가 프로젝트를 읽을 때 source와 generated를 구분하지 않으면 문맥 오염과 토큰 낭비가 커진다.

개선 방향:

- source-classification manifest 추가
- harness가 기본적으로 읽어야 하는 source 목록과 무시해야 하는 generated 목록 분리
- `artifacts/`는 요청 기반 opt-in 읽기 원칙을 명시

### GAP-12. `createServer.js`에 하네스 책임이 과도하게 모여 있다

관련 파일:

- `src/server/createServer.js`

문제:

- domain API
- control center
- harness prompt recommendation
- PTY bridge
- stage run
- release evidence
- UI runtime response

가 하나의 큰 서버 조립 파일에 모여 있다.

개선 방향:

- harness HTTP surface를 별도 module로 추출
- control center runtime service와 harness prompt service를 분리
- 테스트는 유지하되 책임 경계를 명확히 나눔

### GAP-13. prompt recommendation과 execution harness가 아직 완전히 분리되지 않았다

문제:

- 현재 저장소는 "프롬프트 최적화", "운영 상태 복구", "실행 지시", "검증 제안"을 모두 하나의 하네스 개념 안에 넣고 있다.
- 이 상태는 초기에는 빠르지만 장기적으로 품질 기준을 모호하게 만든다.

개선 방향:

- `Prompt Optimizer`
- `Execution Planner`
- `Verification Planner`
- `Operator Reporter`

를 논리적으로 분리한 뒤, 공통 input contract만 공유하게 해야 한다.

---

## 5. 목표 상태: 세계 최고 수준 프롬프트 하네스 구조

최종 목표는 아래 8면(control planes)을 가진 하네스다.

### 5.1 Intake Plane

- 모든 요청을 표준 intake packet으로 정규화
- `packet_type`, `mode`, `risk_level`, `trust_level`, `output_contract`까지 포함

### 5.2 State Plane

- root `memory/`만 canonical
- queue empty / packet active / packet blocked / packet complete를 명시 구분

### 5.3 Routing Plane

- `mode`만이 아니라 risk, trust, budget, interactivity로 라우팅

### 5.4 Prompt Construction Plane

- stable instruction
- trusted repo contract
- untrusted context
- required output
- refusal policy
- verification policy

로 입력을 조립

### 5.5 Truthfulness Plane

- PASS는 evidence가 있을 때만 가능
- not run, planned, mixed를 first-class status로 운영

### 5.6 Security Plane

- trust boundary 정책
- red-team behavioral eval
- tool abuse refusal
- citation / uncertainty enforcement

### 5.7 Eval Plane

- offline golden
- live grader
- regression pack
- safety pack
- cost/latency pack

### 5.8 Release Plane

- prompt versioning
- champion/challenger
- rollout / rollback
- release evidence

---

## 6. 실행 계획

아래 계획은 현재 저장소 구조를 보존하면서 품질을 최고 수준으로 올리기 위한 현실적 순서다.

### Phase 0. 문서/계약 축 정리

목표:

- 하네스 문서 drift를 막는 것부터 시작한다.

수정 대상:

- `requirements/harness-engineering.yaml`
- `docs/harness/CONTINUOUS_PROMPT.md`
- `docs/how-to/repeatable-cli-master-prompt.md`
- 신규 `scripts/validate_harness_docs_sync.py` 또는 동등 validator

완료 기준:

- 각 문서의 역할이 중복 없이 고정
- intake fields, canonical reads, final report format drift 자동 검출

우선순위:

- P0

### Phase 1. output contract를 런타임에 강제

목표:

- output schema를 "문서"가 아니라 "실행 계약"으로 만든다.

수정 대상:

- `contracts/harness/output.schema.json`
- `src/infrastructure/ai/HarnessProviderAdapter.js`
- `src/server/createServer.js`
- `scripts/validate-harness-contract.js`

완료 기준:

- runtime 응답이 schema validation을 통과
- schema mismatch는 구조화된 FAIL로 귀결
- `PASS`에 evidence 없으면 거부

우선순위:

- P0

### Phase 2. routing policy 확장

목표:

- mode-only 라우팅에서 policy-driven 라우팅으로 확장

수정 대상:

- `requirements/harness-engineering.yaml`
- `contracts/harness/provider-adapter.yaml`
- `src/infrastructure/HarnessRuntimeRouter.js`

추가 필드:

- `packet_type`
- `risk_level`
- `trust_level`
- `context_budget`
- `latency_budget`
- `evidence_required`
- `interactive_class`

완료 기준:

- 동일 Build mode라도 low-risk shell 작업과 high-risk billing 작업이 다른 route를 선택

우선순위:

- P0

### Phase 3. prompt payload 구조화

목표:

- provider input 자체의 품질과 안전성을 높인다.

수정 대상:

- `src/infrastructure/ai/OpenAIResponsesProvider.js`
- `security/policies/trust-boundary.yaml`

실행 내용:

- trusted/untrusted 분리
- output contract 명시
- uncertainty / citation / refusal 요구 반영
- base prompt와 runtime metadata를 구획화

완료 기준:

- payload 구조가 문서/정책과 1:1 대응
- research/policy 요청에서 citation and uncertainty 규칙이 명시됨

우선순위:

- P0

### Phase 4. behavioral security eval 추가

목표:

- 보안 정책 존재 여부가 아니라 실제 행태를 검증한다.

수정 대상:

- `evals/cases/`에 security/red-team 케이스 추가
- `scripts/run-harness-evals.js`
- 신규 smoke 또는 adversarial test

완료 기준:

- prompt injection
- system prompt exfiltration
- tool abuse
- excessive agency

가 실제 eval report에 포함

우선순위:

- P0

### Phase 5. live eval + metric closure

목표:

- pending metric을 닫는다.

수정 대상:

- `src/infrastructure/telemetry.js`
- `src/infrastructure/ai/HarnessProviderAdapter.js`
- `evals/metrics/baseline.json`
- `artifacts/evals/harness/latest/*`

완료 기준:

- average input/output tokens
- p95 latency
- retry rate
- provider fallback rate
- schema violation rate

를 prompt version별로 비교 가능

우선순위:

- P1

### Phase 6. operator UX와 terminal state 개선

목표:

- queue empty / current complete 상태에서도 noise 없는 operator UX 제공

수정 대상:

- `requirements/validation-profiles.yaml`
- `scripts/resolve_validation_profile.js`
- `scripts/session_bootstrap.js`
- `scripts/operator_cockpit.js`
- `src/shared/uiRuntimeContracts.js`

완료 기준:

- `complete/done/closed` 전용 profile
- next action이 PR/merge/new WP 정의 같은 실제 후속 작업으로 바뀜
- recommended commands가 상태에 맞게 줄어듦

우선순위:

- P1

### Phase 7. source/generated 분리와 읽기 정책 강화

목표:

- 하네스가 무엇을 읽어야 하는지 더 똑똑해진다.

수정 대상:

- 신규 `contracts/harness/context-sources.yaml` 또는 동등 문서
- `scripts/session_bootstrap.js`
- `docs/reference/ai-harness-data-dictionary.md`

완료 기준:

- canonical source
- optional source
- generated artifact
- forbidden-by-default source

가 분리된다.

우선순위:

- P1

### Phase 8. server 책임 분리

목표:

- 하네스 경계의 유지보수성과 테스트 명확성을 높인다.

수정 대상:

- `src/server/createServer.js`
- 신규 `src/server/routes/harness*.js` 혹은 동등 분리 구조

완료 기준:

- harness HTTP surface, control center surface, stage-run surface 책임 분리
- smoke test는 기존 수준 유지

우선순위:

- P2

---

## 7. 가장 먼저 해야 할 10개 개선점

1. `output.schema.json`을 실제 runtime validator에 연결한다.
2. `PASS`와 `evidence_status=observed`를 결합하는 truthfulness gate를 추가한다.
3. `HarnessRuntimeRouter`에 `risk_level`, `trust_level`, `packet_type` 입력을 추가한다.
4. `OpenAIResponsesProvider` payload를 trusted/untrusted 분리 구조로 바꾼다.
5. `validate_harness_security.py`를 behavioral eval 기반으로 확장한다.
6. `evals/cases/security*.jsonl`을 추가한다.
7. terminal stage 전용 validation profile을 만든다.
8. plugin registry의 rollout state와 runtime exposure state를 분리 명시한다.
9. source/generated 분류 manifest를 추가한다.
10. `createServer.js`에서 harness surface를 분리한다.

---

## 8. 파일별 권장 수정 맵

| 파일 | 권장 조치 | 우선순위 |
| --- | --- | --- |
| `requirements/harness-engineering.yaml` | 하네스 계약의 최상위 진실원으로 축소/강화 | P0 |
| `docs/harness/CONTINUOUS_PROMPT.md` | operator 실행 규약만 남기고 roadmap 내용 제거 | P0 |
| `docs/how-to/repeatable-cli-master-prompt.md` | 사용자 seed prompt 전용으로 단순화 | P0 |
| `contracts/harness/output.schema.json` | runtime truthfulness 필드 보강 및 validator 연동 | P0 |
| `contracts/harness/provider-adapter.yaml` | route input 신호 확장, prod fallback 정책 분기 | P0 |
| `src/infrastructure/HarnessRuntimeRouter.js` | mode-only 라우팅에서 policy-driven 라우팅으로 확장 | P0 |
| `src/infrastructure/ai/OpenAIResponsesProvider.js` | prompt payload 구획화, 안전/출력 계약 명시 | P0 |
| `src/infrastructure/ai/HarnessProviderAdapter.js` | output validation, environment-aware fallback, richer telemetry | P0 |
| `scripts/run-harness-evals.js` | safety/live grading/cost metrics 추가 | P0 |
| `scripts/validate_harness_security.py` | snippet validator에서 behavior validator로 확장 | P0 |
| `requirements/validation-profiles.yaml` | terminal state와 harness-specific bundles 추가 | P1 |
| `scripts/session_bootstrap.js` | empty-queue/complete-state UX 보정 | P1 |
| `scripts/operator_cockpit.js` | mode/risk/evidence 중심 operator chain 강화 | P1 |
| `src/shared/uiRuntimeContracts.js` | operator UI 계약에 truthfulness/evidence 필드 노출 | P1 |
| `master-shell/plugin-registry/registry.yaml` | policy readiness vs runtime exposure 분리 | P1 |
| `master-shell/feature-flags/flags.yaml` | exposure semantics 보완 | P1 |
| `src/server/createServer.js` | harness/control-center 책임 분리 | P2 |

---

## 9. 완료 기준

이 계획이 진짜 완료되었다고 말하려면 아래 조건이 필요하다.

1. 하네스 입력/출력 계약이 문서가 아니라 runtime validator로 강제된다.
2. mode router가 risk/trust/budget/evidence 신호를 사용한다.
3. security는 snippet 존재가 아니라 behavioral eval로 검증된다.
4. eval은 golden offline만이 아니라 live/safety/cost까지 포함한다.
5. telemetry가 prompt version별 품질/비용/지연 비교를 제공한다.
6. operator surface가 queue empty, current complete, degraded provider 상태를 정확히 설명한다.
7. source/generated 분리가 명시돼 context 낭비가 줄어든다.
8. rollout/rollback이 provider/harness 버전과 연결된다.

---

## 10. 최종 판단

이 프로젝트는 이미 평균 이상의 프롬프트 하네스를 갖고 있다. 특히 canonical memory, validation profile, mode router, provider adapter, telemetry, eval baseline, release evidence, operator surface가 모두 같은 저장소 안에 있다는 점이 강하다.

하지만 "최고 성능"과 "완벽한 품질" 기준으로 보면 아직 핵심이 덜 닫힌 곳이 명확하다.

- 계약은 있지만 runtime enforcement가 약한 곳
- 보안 정책은 있지만 behavioral verification이 약한 곳
- eval이 있지만 live/safety/cost closure가 약한 곳
- routing이 있지만 mode 외 신호가 적은 곳
- operator UX가 있지만 terminal/degraded state 모델링이 약한 곳

따라서 이 저장소의 다음 최우선은 새 기능 추가보다 아래 순서다.

1. truthfulness enforcement
2. routing policy enrichment
3. behavioral security eval
4. live metric closure
5. operator and source classification hardening

이 순서로 가면 현재 저장소 구조를 버리지 않고도 프롬프트 하네스를 최고 수준에 가깝게 올릴 수 있다.
