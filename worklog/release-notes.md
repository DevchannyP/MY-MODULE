# Release Notes

## v0.1.0 - 2026-03-17 - Skeleton Initialization

### 변경 사항

**초기 저장소 뼈대 생성 (Workflow OS 1차 실행)**

### 생성된 구조

```
requirements/
├── requirements.schema.json
├── requirements.yaml
├── glossary.yaml
├── domain-map.yaml
├── constraints.yaml
└── nfr.yaml

docs/
├── explanation/workflow-os-concept.md
├── reference/ (9개 파일)
├── how-to/ (6개 파일)
├── tutorial/ (4개 파일)
└── adr/0001-record-architecture-decisions.md

templates/
├── module-template/README.md
├── domain-app-template/README.md
├── contract-template/README.md
├── plugin-template/README.md
├── worklog-template.md
├── review-template.md
├── memory-stageA-template.yaml
├── memory-stageB-template.yaml
└── memory-stageC-template.yaml

domains/
master-shell/ (plugin-registry/, navigation/, feature-flags/, observability/, catalog/)
memory/ (stageA/, stageB/, stageC/, project/)
worklog/
```

### 미해결 항목

memory/project/unresolved-risks.yaml 참조 (5개 항목)

### 다음 릴리즈 예정

- Stage A 실행 결과 (실제 모듈 계약 생성)
- ADR 추가 (시크릿 관리, CI/CD 선택)

---

## v0.2.0 - 2026-03-18 - Stage A~E 완료 (task-management 모듈)

### 변경 사항

**Stage A~E 전체 파이프라인 1회차 실행 완료**

### 생성된 도메인 구현

```
domains/productivity/task-tracking/
├── contract/
│   ├── capability.yaml          ← v0.1.0 (INV004 추가, Stage E 개선)
│   ├── openapi.yaml
│   ├── events.schema.json
│   └── ui-contract.yaml
└── src/
    ├── domain/
    │   ├── entities/Task.js
    │   ├── value-objects/TaskStatus.js
    │   ├── events/TaskEvents.js
    │   └── services/TaskDomainService.js
    ├── application/
    │   ├── CreateTaskUseCase.js
    │   ├── GetTaskUseCase.js
    │   ├── ListTasksUseCase.js
    │   ├── TransitionTaskStatusUseCase.js
    │   └── ReassignTaskUseCase.js
    └── infrastructure/
        └── InMemoryTaskRepository.js
```

### 테스트 현황

| 테스트 종류 | 결과 |
|-------------|------|
| 단위 테스트 (domain/infra) | PASS (48/48) |
| 통합 테스트 (usecase 수준) | PASS |
| 적대적 검증 (Stage E) | PASS (43/43) |

### Stage E 적대적 검증 결과

**발견된 갭 3건 — 전부 조치 완료**

| 갭 | 심각도 | 내용 | 조치 |
|----|--------|------|------|
| 갭-1 | P2 | capability.yaml에 INV004 누락 | capability.yaml + stageA memory 갱신 |
| 갭-2 | P3 | permissions_required UseCase 미강제 | ADR 0002 — interface 레이어 강제 결정 |
| 갭-3 | P3 | InMemoryRepository 낙관적 잠금 없음 | ADR 0003 — 프로덕션 DB 어댑터 필수화 |

### 생성된 ADR

- **ADR 0002**: 권한 강제 레이어 결정 (interface 레이어)
- **ADR 0003**: 낙관적 잠금 정책 (프로덕션 DB 필수)

### Stage D 상태

**PARTIAL_PASS** (NOT_CONFIGURED 9건 미해소)
- 해소 조건: ESLint 구성, interface 레이어 구현, CI/CD 구성
- 전체 PASS 시: `enable_task_management: true` 활성화 예정

### 미해결 항목

- NOT_CONFIGURED 9건 (worklog/D_quality_gate.md 참조)
- ADR 0002 기반 interface 레이어(TaskController.js) 구현 필요
- ADR 0003 기반 프로덕션 DbTaskRepository.js 구현 필요 (DB 어댑터 도입 시)

### 다음 릴리즈 예정

- ESLint 구성 후 lint 게이트 PASS
- interface 레이어 구현 후 authn-authz 게이트 PASS
- Stage D 재실행 → 전체 PASS → v0.3.0 (feature flag 활성화)

---

## v0.3.0 - 2026-03-19 - Core Git Governance & Release Evidence

### 변경 사항

**코어 저장소의 형상관리 운영 기준선 추가**

### 추가된 운영 자산

```
docs/adr/0007-git-branch-and-commit-governance.md
docs/reference/git-governance.md
docs/how-to/run-git-workflow.md
.github/pull_request_template.md
templates/learning-log-template.md
templates/commit-message-template.txt
scripts/generate_release_evidence.py
artifacts/release-evidence/README.md
worklog/G_git_governance.md
worklog/core-learning-log.md
```

### 핵심 효과

- `main` 기준 브랜치 전략 고정
- 작업 단위 커밋 기준 정의
- PR 체크리스트 추가
- release evidence JSON 생성 기준선 추가
- 학습형 작업 로그 템플릿 추가

### 다음 릴리즈 예정

- dependency scan 기준선 실동작화
- 실제 원격 브랜치/PR 자동화 연결

---

## v0.3.1 - 2026-03-19 - Dependency Scan Baseline Activation

### 변경 사항

**dependency-scan 게이트를 placeholder에서 실동작 검증기로 전환**

### 추가된 자산

```
scripts/validate_dependency_baseline.py
```

### 핵심 효과

- `scan:dependencies`가 실제 검증 명령으로 동작
- `package.json` ↔ `package-lock.json` 정합성 검증
- runtime dependency 유입 차단
- integrity / license 메타데이터 검증

### 검증

- `npm run scan:dependencies`
- `npm run lint`
- `npm run test:contract`
- `npm test`

### 다음 릴리즈 예정

- advisory feed 연동 전략 수립
- 실제 서버 기동 smoke 기준선 강화

---

## v0.3.2 - 2026-03-19 - Advisory Feed Strategy Baseline

### 변경 사항

**온라인 advisory scan 연동 정책을 ADR과 정책 파일로 고정**

### 추가된 자산

```
docs/adr/0008-online-advisory-scan-strategy.md
docs/reference/advisory-feed-policy.md
artifacts/advisory/advisory-policy.yaml
scripts/validate_advisory_policy.py
```

### 핵심 효과

- 오프라인 dependency baseline 과 온라인 advisory scan 역할 분리
- `main` 차단 기준 고정
- 예외 승인 필드 고정
- 정책 자체를 검증하는 명령 추가

### 검증

- `npm run check:advisory-policy`
- `npm run scan:dependencies`
- `npm run lint`
- `npm test`

### 다음 릴리즈 예정

- GitHub branch protection 기준선 정리
- 실제 서버 기동 smoke 기준선 강화

---

## v0.3.3 - 2026-03-19 - GitHub Branch Protection Baseline

### 변경 사항

**GitHub 원격 보호 규칙의 저장소 내부 기준선을 policy file 과 validator 로 고정**

### 추가된 자산

```
docs/adr/0009-github-branch-protection-baseline.md
docs/reference/github-branch-protection.md
artifacts/github/branch-protection-policy.yaml
scripts/validate_branch_protection_policy.py
```

### 핵심 효과

- `main` 보호 규칙 고정
- required checks 목록 고정
- PR 템플릿과 Git 흐름 문서에 required checks 반영
- branch protection 정책 자체를 검증하는 명령 추가

### 검증

- `npm run check:branch-protection-policy`
- `npm run lint`
- `npm test`

### 다음 릴리즈 예정

- 실제 서버 기동 smoke 기준선 강화
- GitHub 원격 설정 점검 절차 구체화
