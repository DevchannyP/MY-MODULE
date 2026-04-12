# Workflow OS - my-module

`my-module`은 계약 중심 Workflow OS 코어 저장소다.
하나의 마스터 OS 위에서 AI 기획, 학습, 실행 packet, 도메인 모듈 조합, 운영 증적을 함께 다루는 것을 목표로 한다.

이 저장소의 기본 원칙은 아래 3가지다.

1. 코어는 고정하고 edge 계획과 모듈만 안전하게 확장한다.
2. 작은 Work Packet 단위로 필요한 파일만 읽어 토큰 비용과 변경 리스크를 줄인다.
3. 코드, 계약, memory, worklog, release evidence를 함께 맞춰야 완료로 본다.

## 프로젝트 개요

- 목적: 계약 기반 모듈 생성·조합·검증·운영을 위한 Workflow OS 코어 플랫폼
- 운영 모델: Stage 일괄 실행이 아니라 Work Packet 반복 사이클
- 현재 주요 모듈: `task-management`, `billing`, `video`
- 현재 주요 surface: `master planner`, `project status`, `quality gates`, `promotion/context pipeline`

## 기술 스택

- Runtime: Node.js, Python 3
- 테스트: Node test runner, smoke/property/adversarial tests
- 정적 검증: ESLint, custom validators
- 계약/메모리: YAML, JSON, OpenAPI, event schema
- 저장소 거버넌스: GitHub Actions, branch protection baseline, release evidence artifacts

## 디렉토리 구조

```text
my-module/
├── requirements/          # 입력 진실원, 제약, 도메인 맵
├── domains/               # 도메인 구현, 계약, 테스트
├── master-shell/          # plugin registry, catalog, flags, observability
├── scripts/               # 검증기, 생성기, status/packet utilities
├── docs/                  # reference / how-to / adr / troubleshooting
├── memory/                # root session state + stage snapshots + legacy fallback
├── worklog/               # Work Packet evidence
├── artifacts/             # generated planner / release / provisioning / pipeline artifacts
└── .github/               # PR template and workflow metadata
```

## 실행 방법

### 1. 현재 상태 읽기

```bash
sed -n '1,160p' memory/checkpoint.yaml
sed -n '1,200p' memory/current-state.yaml
sed -n '1,200p' memory/current-wp.yaml
sed -n '1,220p' memory/wp-queue.yaml
```

### 2. 기준선 검증

```bash
npm run validate:requirements
npm run lint
npm run validate:composition
npm run test:contract
npm test
```

### 3. 런타임/상태 확인

```bash
npm run project:status
npm run test:e2e-smoke
python3 scripts/generate-master-planner.py --silent
```

## 빌드 및 테스트 방법

```bash
npm run validate:requirements
npm run lint
npm run test:contract
npm test
npm run test:e2e-smoke
npm run db:migrate:test
```

추가 검증:

```bash
npm run type-check
npm run scan:dependencies
npm run check:advisory-policy
npm run check:branch-protection-policy
npm run generate:release-evidence
```

## 핵심 기능 / 모듈

- `master planner`
  프로젝트 시작 전 질문지, Planning Studio, Context Packet, Benchmark Action Pack, Live Ops Feed를 한 surface에서 읽는다.
- `project status`
  현재 Work Packet, Stage route 상태, promotion/context readiness, 필수 개선 3가지를 구조화해 출력한다.
- `domain modules`
  `task-management`, `billing`, `video`는 계약과 구현, smoke, authz, adversarial 검증을 포함한다.
- `promotion/context pipeline`
  context lock, drift, reread, handoff bundle, promotion decision, apply checkpoint를 artifact 단위로 관리한다.

## 자주 발생하는 오류와 대응

자세한 내용은 [troubleshooting.md](/root/workspace/my-module/docs/troubleshooting.md)를 본다.

빠른 체크:

- `validate:requirements FAIL`
  `requirements/requirements.yaml`, `requirements/constraints.yaml`, 경로 참조를 먼저 확인한다.
- `validate:composition FAIL`
  `master-shell/plugin-registry/registry.yaml`, navigation, feature flags, catalog 연결을 확인한다.
- `test:contract FAIL`
  계약 파일과 구현/registry produced_by 경로가 어긋난 것이다.
- `test:e2e-smoke FAIL`
  서버 바인딩, feature flag, transport guardrail, runtime script 경로를 먼저 확인한다.
- `project:status` 값이 비정상
  `memory/current-wp.yaml`과 `memory/wp-queue.yaml`의 canonical packet 정합성을 먼저 확인한다.

## 설정 / 환경 주의사항

- root `memory/*.yaml`이 canonical 상태 surface다.
- `memory/project/*`는 일부 레거시 스크립트와 문서 호환용 fallback이다.
- `artifacts/`는 생성 산출물이므로 변경 목적을 설명할 수 있을 때만 Git 반영한다.
- `npm run test:e2e-smoke`는 로컬 포트 바인딩이 가능한 환경에서 실행해야 한다.
- `db:migrate:test`는 Node의 experimental SQLite warning이 보일 수 있으나 현재 기준선에서는 정상이다.
- 원격 GitHub deployment environment 실증 증적은 여전히 operator-collected 항목이 있다.

## Git 브랜치 전략

요약만 적고, 상세 규칙은 [branch-strategy.md](/root/workspace/my-module/docs/branch-strategy.md)를 따른다.

- `main`: 항상 안정 기준선. 직접 push 금지.
- `develop`: 다음 통합 기준선. 제한적 직접 push 또는 PR-only 정책 중 하나로 운영.
- `feature/*`: 일반 기능/개선
- `fix/*`, `bugfix/*`: 핵심 오류 수정
- `hotfix/*`: `main` 긴급 수정
- `release/*`: 배포 직전 안정화
- `recovery/*`: 롤백/복구
- `sandbox/*`: 실험/고위험 검토

현재 권장 작업 브랜치 패턴:

```bash
fix/core-<short-topic>
feature/core-<short-topic>
docs/core-<short-topic>
```

## 기여 / 작업 규칙

- 변경은 가능한 한 작은 Work Packet 또는 작은 Git 커밋 단위로 쪼갠다.
- 코드만 고치지 말고 contract, memory, worklog, docs 영향도 같이 확인한다.
- root memory를 먼저 맞추고 legacy memory는 필요 시만 보조 갱신한다.
- 완료 선언 전 최소 검증 명령과 rollback 포인트를 설명 가능해야 한다.
- `main`에 직접 push하지 않는다.

## 배포 / 반영 절차

1. 작업 브랜치 생성
2. 의미 단위별로 수정과 커밋 분리
3. 기준선 검증 실행
4. release evidence 생성 필요 여부 확인
5. 원격 브랜치 push
6. PR 생성
7. 리뷰/required checks 통과 후 병합

배포 직전 체크리스트는 [release-checklist.md](/root/workspace/my-module/docs/release-checklist.md)를 따른다.

## 문서 위치 안내

- 브랜치 전략: [branch-strategy.md](/root/workspace/my-module/docs/branch-strategy.md)
- 개발/작업 흐름: [development-guide.md](/root/workspace/my-module/docs/development-guide.md)
- AI 하네스 업그레이드 계획: [ai-harness-upgrade-plan.md](/root/workspace/my-module/docs/explanation/ai-harness-upgrade-plan.md)
- 반복 프롬프트: [repeatable-cli-master-prompt.md](/root/workspace/my-module/docs/how-to/repeatable-cli-master-prompt.md)
- 하네스 자료사전: [ai-harness-data-dictionary.md](/root/workspace/my-module/docs/reference/ai-harness-data-dictionary.md)
- 검증 프로파일: [validation-profiles.md](/root/workspace/my-module/docs/reference/validation-profiles.md)
- 트러블슈팅: [troubleshooting.md](/root/workspace/my-module/docs/troubleshooting.md)
- 릴리즈 체크리스트: [release-checklist.md](/root/workspace/my-module/docs/release-checklist.md)
- Git 거버넌스 기준: [git-governance.md](/root/workspace/my-module/docs/reference/git-governance.md)
- Memory 스키마: [memory-schema.md](/root/workspace/my-module/docs/reference/memory-schema.md)
- 품질 게이트: [quality-gates.md](/root/workspace/my-module/docs/reference/quality-gates.md)
