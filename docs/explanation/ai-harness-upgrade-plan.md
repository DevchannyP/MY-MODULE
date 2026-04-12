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

### Spiral 1. Harness Contract 정착

- 완료 기준: intake schema, 설계/검증 정책, 패턴 적용 기준이 파일로 고정된다.
- 산출물: `requirements/harness-engineering.yaml`, data dictionary, 반복 프롬프트

### Spiral 2. Prompt Compression

- 완료 기준: 세션 프롬프트가 짧아지고 파일 로드 규칙으로 대체된다.
- 산출물: [docs/how-to/repeatable-cli-master-prompt.md](/root/workspace/my-module/docs/how-to/repeatable-cli-master-prompt.md)

### Spiral 3. Master UI Flow Visualization

- 완료 기준: control center에서 현재 lane과 work flow가 칸반형으로 보인다.
- 산출물: `scripts/generate-mindmap.js`, `ui/control-center-runtime`

### Spiral 4. Session Continuity Hardening

- 완료 기준: 같은 프롬프트 반복 시 current state와 current WP를 기반으로 다음 작업을 이어서 수행한다.
- 후보 작업:
  - `wp:next`, `wp:reconcile`, `project:status`를 묶은 session bootstrap
  - current packet drift 감지 자동화
  - prompt seed에서 읽을 파일 최소화

### Spiral 5. Verification Harness Hardening

- 완료 기준: packet 유형별 최소 검증 묶음이 명시된다.
- 후보 작업:
  - bugfix: unit + regression + integration
  - UI: smoke + interaction
  - governance: validator + artifact smoke

### Spiral 6. Branch and Promotion Automation

- 완료 기준: 새 packet 시작, 검증 통과, 커밋/PR 준비 흐름이 더 자동화된다.
- 후보 작업:
  - branch bootstrap helper
  - verified auto-commit guard
  - release evidence / promotion pipeline 연결

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

1. control center runtime에 칸반 lane 데이터를 더 노출해 외부 surface에서도 같은 흐름을 재사용하게 만든다.
2. session bootstrap script를 만들어 세션 시작 시 읽는 파일과 명령을 더 줄인다.
3. packet 유형별 검증 프로파일을 표준화한다.
4. branch bootstrap과 verified auto-commit을 현재 `wp:*` 흐름과 결합한다.
