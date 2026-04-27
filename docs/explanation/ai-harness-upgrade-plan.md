# AI Harness Upgrade Plan

## 목적

이 저장소를 "긴 프롬프트를 매번 다시 설명하는 구조"에서 "짧은 반복 프롬프트 + 파일에 고정된 하네스 규약 + 현재 상태 기반 점진 실행" 구조로 전환한다.

핵심은 아래 5개다.

1. 목표·맥락·제약·완료조건을 구조적으로 준다.
2. 어려운 일은 바로 코딩하지 않고 먼저 계획한다.
3. 반복 규칙은 채팅이 아니라 파일에 고정한다.
4. 작업을 작게 나눠 점진적으로 진행한다.
5. 항상 검증 루프를 붙인다.

## 현재 프로젝트 진단

이 저장소는 이미 하네스 기반으로 발전할 토대가 있다.

- 상태 기준면: [memory/current-state.yaml](/root/workspace/my-module/memory/current-state.yaml), [memory/current-wp.yaml](/root/workspace/my-module/memory/current-wp.yaml), [memory/wp-queue.yaml](/root/workspace/my-module/memory/wp-queue.yaml)
- 운영 문서: [README.md](/root/workspace/my-module/README.md), [HOW_TO_USE.md](/root/workspace/my-module/HOW_TO_USE.md)
- 점진 실행 단위: Work Packet DAG와 `wp:*` 스크립트
- 검증 체계: `npm test`, `test:e2e-smoke`, `validate:*`, `check:*`
- UI 기반 관찰점: `master planner`, `mindmap control center`, `control-center-runtime`

강점:

- root memory가 이미 canonical state로 정리돼 있다.
- Work Packet 단위 실행과 검증 스크립트가 있다.
- master UI와 control runtime이 이미 존재한다.
- smoke/property/adversarial 테스트가 구축돼 있다.

갭:

- 하네스 규칙이 여러 문서에 흩어져 있어 세션 프롬프트가 길어진다.
- 요청을 intake packet으로 강제하는 단일 계약이 없다.
- UI에 현재 작업 흐름이 표 형태로는 보이지만 칸반형 시각화는 약하다.
- "설계 원칙"과 "패턴 사용 기준"이 아직 과도하게 일반론적이라 실제 적용 기준이 약하다.

## 요구사항 정의

### 기능 요구사항

- `FR-01` 모든 세션은 intake packet으로 시작해야 한다.
- `FR-02` 어려운 요청은 원인 분석 후 change point를 먼저 확정해야 한다.
- `FR-03` 반복 규칙은 파일 기반으로 고정돼야 한다.
- `FR-04` master UI는 현재 lane, 다음 액션, 검증 상태를 보여야 한다.
- `FR-05` 변경은 작은 단위로 수행되고 각 단위 뒤에 검증이 따라야 한다.
- `FR-06` 같은 프롬프트를 반복 입력해도 현재 상태를 읽고 다음 작업으로 이어져야 한다.

### 비기능 요구사항

- `NFR-01` 세션 프롬프트는 짧아야 한다. 긴 규칙은 파일로 이동한다.
- `NFR-02` 토큰 사용은 현재 packet과 관련된 파일만 읽도록 최적화한다.
- `NFR-03` 구조적 판단은 현재 저장소 기술 스택과 결을 맞춰야 한다.
- `NFR-04` 강제적 패턴 사용으로 복잡도를 늘리지 않는다.
- `NFR-05` 검증 결과 없는 완료 선언을 금지한다.
- `NFR-06` 다음 세션 재개 비용이 낮아야 한다.

## 설계 결정

### 1. 짧은 프롬프트 + 파일 고정 규칙

반복 프롬프트는 짧게 유지하고, 자세한 규칙은 [requirements/harness-engineering.yaml](/root/workspace/my-module/requirements/harness-engineering.yaml)에 고정한다.

### 2. Work Packet 유지, Intake Packet 추가

이 저장소의 기존 Work Packet 체계는 유지한다. 대신 사용자 요청을 먼저 Intake Packet으로 정규화하고, 그 결과를 현재 Work Packet과 연결한다.

### 3. Composition-first

사용자가 언급한 캡슐화, 추상화, 정보은닉, 모듈화, 낮은 결합도, 높은 응집도는 채택한다. 다만 이 저장소는 JavaScript 중심 DDD/포트-어댑터 구조라서 아래처럼 해석하는 것이 더 유지보수성과 성능에 유리하다.

- 캡슐화: 상태와 불변조건을 entity/use case/port 경계에 묶는다.
- 추상화: 필요한 포트와 runtime contract에만 적용한다.
- 다형성: 상속보다 포트/어댑터 변형으로 구현한다.
- 상속: 진짜 subtype 의미가 있을 때만 제한적으로 사용한다.
- 싱글턴: config, registry, telemetry 같은 process-wide coordinator에만 허용한다.
- 빌더: packet 생성, 복잡한 fixture 조립, 다단계 객체 구성에만 사용한다.
- 팩토리/템플릿 메서드: 반복되는 adapter 생성이나 고정 lifecycle에만 도입한다.

이 판단은 성능과 유지보수성을 위한 실용적 해석이다. 이 저장소 전반에 강제로 클래식 OOP 패턴을 도입하는 것은 오히려 과설계가 될 가능성이 높다.

### 4. Spiral Model

작업 흐름은 한 번에 끝내는 waterfall이 아니라 아래 나선형 반복으로 본다.

1. Intake
2. Planning
3. Execution
4. Validation
5. Complete
6. Next spiral

master UI에는 이 흐름을 칸반 lane으로 시각화한다.

## 현재 프로젝트 기준 세분화 실행 계획

### Track 0. Canonical Truth Alignment

- 목표: 문서, UI, 스크립트가 모두 같은 canonical state를 읽는다.
- 현재 상태: root memory 구조는 정착됐지만 일부 연속 실행 문서는 legacy 경로 표현이 남아 있다.
- 완료조건:
  - `memory/current-state.yaml`, `memory/current-wp.yaml`, `memory/wp-queue.yaml`, `memory/next-actions.yaml`가 모든 운영 문서에서 일관되게 언급된다.
  - 세션 프롬프트와 실제 bootstrap 스크립트의 읽기 순서가 일치한다.
- 핵심 파일:
  - `docs/harness/CONTINUOUS_PROMPT.md`
  - `docs/how-to/repeatable-cli-master-prompt.md`
  - `scripts/session_bootstrap.js`

### Track 1. Intake-First Execution

- 목표: 어떤 자유 형식 요청도 6필드 Intake Packet으로 자동 재구성한다.
- 현재 상태: 계약은 있으나, 사용자용 운영 문서와 UI가 이를 더 직접적으로 보여줄 필요가 있다.
- 완료조건:
  - `goal/context/constraints/done_when/work_mode/verification`가 모든 운영 surface에서 같은 이름으로 보인다.
  - 버그 수정과 기능 추가 예시가 분리돼 있다.
- 핵심 파일:
  - `requirements/harness-engineering.yaml`
  - `docs/reference/ai-harness-data-dictionary.md`
  - `docs/how-to/repeatable-cli-master-prompt.md`

### Track 2. Session Continuity Hardening

- 목표: 같은 프롬프트를 반복 입력하면 현재 packet이 끝났는지, 다음 packet이 무엇인지, 어느 레인에 있는지 자동으로 파악한다.
- 현재 상태: `session:bootstrap`과 `project:status`는 존재하지만, 시각화와 운영 문구가 더 직결될 필요가 있다.
- 완료조건:
  - `계속` 프롬프트만으로 상태 복구가 가능한 운영 규약이 문서화된다.
  - `current-wp`와 `next-actions`가 다른 경우에도 active focus가 분명하게 드러난다.
- 핵심 파일:
  - `scripts/session_bootstrap.js`
  - `memory/next-actions.yaml`
  - `scripts/generate-ui-home.js`

### Track 3. Master UI Flow Visualization

- 목표: 마스터 UI 첫 화면에서 현재 lane, 다음 action, validation state, spiral cycle을 즉시 확인한다.
- 현재 상태: 칸반과 spiral은 존재하지만 active focus strip이 약하다.
- 완료조건:
  - 홈 화면에 현재 레인, 다음 액션, 검증 상태, 반복 프롬프트가 보인다.
  - 칸반은 backlog 분석 빌드 검증 완료 흐름을 유지하되, 현재 focus packet이 빈 보드처럼 보이지 않게 한다.
- 핵심 파일:
  - `scripts/generate-ui-home.js`
  - `artifacts/index.html`
  - 관련 smoke test

### Track 4. Verification Harness Hardening

- 목표: packet 유형별 최소 검증 프로파일을 명시하고, 완료 선언 전에 자동으로 연결한다.
- 현재 상태: 스크립트는 충분하지만 bugfix/UI/governance별 최소 세트의 설명 가능성이 더 필요하다.
- 완료조건:
  - bugfix: unit + regression + integration
  - UI: generate + smoke + interaction
  - governance: validator + artifact smoke
  - 구조/계약: contract drift + composition + 필요한 smoke
- 핵심 파일:
  - `requirements/validation-profiles.yaml`
  - `scripts/resolve_validation_profile.js`
  - `scripts/verified_auto_commit_guard.js`

### Track 5. SCM and Promotion Flow

- 목표: 브랜치 생성, 검증 통과, 자동 커밋 후보, evidence 생성이 하나의 operator 흐름으로 이어진다.
- 현재 상태: 부품은 존재한다. 다만 UX와 운영 지침 관점에서 하나의 체인으로 더 쉽게 보여줄 여지가 있다.
- 완료조건:
  - `branch:bootstrap` 추천 브랜치가 packet 유형과 일치한다.
  - `commit:guard`가 검증 통과 전 커밋 후보를 막는다.
  - promotion/release evidence 흐름이 operator cockpit에서 이해 가능하다.
- 핵심 파일:
  - `scripts/branch_bootstrap.js`
  - `scripts/verified_auto_commit_guard.js`
  - `scripts/operator_cockpit.js`

### Track 6. Runtime and Data Posture

- 목표: 현재 단독 개발 구조를 유지하면서도 추후 확장 가능한 저장/동시성 경계를 고정한다.
- 현재 상태: SQLite/In-Memory 포트-어댑터 분리는 갖춰져 있다.
- 완료조건:
  - Repository port 중심 구조를 유지한다.
  - 공유 가변 상태는 process-wide coordinator에만 남긴다.
  - CPU 바운드 작업은 worker 분리 후보로만 관리하고, I/O는 async-first로 유지한다.
  - 자료사전과 migration 전략이 계약 변경과 함께 갱신된다.
- 핵심 파일:
  - `domains/**/ports|application/ports`
  - `docs/db/migration-strategy.md`
  - `docs/reference/ai-harness-data-dictionary.md`

## 벤치마킹 포인트

아래는 공식 자료를 기준으로 채택한 원칙이다.

- OpenAI Prompting: 프롬프트는 버전 관리, 변수화, 재사용이 가능해야 하고, linked eval을 계속 돌려야 한다는 점을 채택했다.
  출처: https://platform.openai.com/docs/guides/prompting
- OpenAI Evals: behavior를 먼저 정의하고 반복 평가하는 구조를 채택했다.
  출처: https://platform.openai.com/docs/guides/evals
- OpenAI Agent evals: workflow-level 평가와 trace grading 개념을 검증 루프 설계에 반영했다.
  출처: https://platform.openai.com/docs/guides/agent-evals
- Anthropic Prompt Engineering: success criteria 선행, XML/구조적 태그, 긴 문맥에서 문서와 질의를 분리하는 방식을 intake packet 구조화에 반영했다.
  출처: https://docs.anthropic.com/en/docs/prompt-engineering
  출처: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags
  출처: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/long-context-tips
- GitHub Copilot Coding Agent: 에이전트가 브랜치/PR을 만들더라도 최종 리뷰는 사람이 해야 한다는 운영 모델을 채택했다.
  출처: https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/create-a-pr
  출처: https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/review-copilot-prs

위 자료를 그대로 복제한 것은 아니다. 이 저장소 구조에 맞게 아래 원칙으로 변환 적용했다는 점이 핵심이다.

- 구조화된 입력
- 계획 우선
- 작은 단위 실행
- 파일 기반 고정 규칙
- 검증 중심 반복
- 사람 검토가 있는 브랜치/PR 거버넌스

## 계속 사용할 운영 방식

앞으로 같은 프롬프트를 반복 입력할 때 에이전트는 아래 순서로 움직여야 한다.

1. canonical state 읽기
2. 요청을 intake packet으로 재구성
3. 원인 분석
4. change point 최소화
5. 작은 change set 실행
6. 검증
7. 다음 한 단계 기록

## 현재 턴 이후 우선순위

1. 연속 실행 문서와 `session:bootstrap`의 truth source를 완전히 일치시킨다.
2. 마스터 UI 홈에서 active focus, current lane, validation state를 더 직접적으로 보이게 한다.
3. packet 유형별 검증 프로파일을 표준화하고 `commit:guard`와 연결한다.
4. operator cockpit, branch bootstrap, promotion evidence를 하나의 실행 체인으로 정리한다.
