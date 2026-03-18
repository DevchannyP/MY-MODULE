# Stage D 실행 방법

> **HOW** 중심 문서: 품질/보안/공급망/관측성 게이트 판정을 어떻게 실행하는가?

## 사전 조건

- Stage A, B, C가 모두 PASS 상태여야 한다.
- 구현 코드가 존재해야 한다.

## 실행 절차

### 1단계: Correctness 게이트

```bash
npm test                    # unit tests
npm run test:contract       # contract tests
npm run test:integration    # integration tests
npm run test:e2e-smoke      # e2e smoke
```

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
```

### 5단계: 결과 기록

- PASS: `memory/project/current-state.yaml`의 `quality_gate_result`를 `PASS`로 갱신.
- FAIL: `worklog/fixes.md`에 실패 항목 기록. 수정 후 해당 게이트 재실행.

### Stage D FAIL 3회 반복 시

`worklog/incidents.md`에 기록하고 Stage E 진입을 검토한다.

## 관련 문서

- docs/reference/quality-gates.md
- docs/reference/security-policy.md
- docs/reference/supply-chain-policy.md
- docs/reference/observability-policy.md
