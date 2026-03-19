# Stage D 실행 방법

> **HOW** 중심 문서: 품질/보안/공급망/관측성 게이트 판정을 어떻게 실행하는가?

## 사전 조건

- Stage A, B, C가 모두 PASS 상태여야 한다.
- 구현 코드가 존재해야 한다.

## 빠른 상태 확인

```bash
npm run stage:d
```

이 명령은 현재 저장소 상태를 읽는 dry-run executor다.
실제 파일을 변경하지 않고 현재 라우팅, prerequisite, 권장 검증 명령을 JSON으로 출력한다.

현재 GitHub Actions에서는 `.github/workflows/quality-gates.yml`이 로컬 Stage D baseline 대부분을 자동 실행한다.
release evidence 는 `.github/workflows/release-evidence.yml` 에서 자동화되어 있고,
배포 환경 smoke 는 `.github/workflows/deployment-smoke.yml` 에서 environment-bound operator-triggered 경로로 실행한다.
원격 GitHub environment provisioning baseline 은 `check:deployment-environment-provisioning` 으로 registry/policy/template drift 를 막는다.

## 실행 절차

### 1단계: Correctness 게이트

```bash
npm test                    # unit tests
npm run test:contract       # contract tests
npm run test:integration    # integration tests
npm run test:e2e-smoke      # e2e smoke
```

`npm run test:e2e-smoke`는 controller-level smoke와 최소 network-level server wiring smoke를 함께 실행한다.

FAIL 시: `worklog/fixes.md`에 기록 후 수정.

### 2단계: Code Health 게이트

```bash
npm run lint
npm run type-check
npm run static-analysis
```

### 3단계: Security 게이트

```bash
npm run scan:secrets        # Gitleaks 등
npm run scan:dependencies   # lockfile/integrity/license/runtime-deps baseline
npm run check:advisory-policy
npm run test:authn-authz
npm run test:input-validation
```

### 4단계: Supply Chain & Operations 게이트

```bash
npm run generate:sbom
npm run verify:provenance
npm run test:rollback
npm run check:observability
npm run check:deployment-environment-provisioning
```

### 5단계: 결과 기록

- PASS: root `memory/current-state.yaml`에 현재 Work Packet 기준 상태를 갱신한다.
- 레거시 스크립트 호환이 필요하면 `memory/project/current-state.yaml`도 함께 맞춘다.
- FAIL: `worklog/fixes.md`에 실패 항목 기록. 수정 후 해당 게이트 재실행.

### Stage D FAIL 3회 반복 시

`worklog/incidents.md`에 기록하고 Stage E 진입을 검토한다.

## 관련 문서

- docs/reference/quality-gates.md
- docs/reference/security-policy.md
- docs/reference/supply-chain-policy.md
- docs/reference/observability-policy.md
