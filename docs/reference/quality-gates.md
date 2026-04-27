# 품질 게이트 참조

> **WHAT** 중심 문서: Stage D에서 판정하는 품질 게이트 목록과 기준

## 게이트 카테고리

### 1. Correctness (정확성)

| 게이트 | 도구 예시 | PASS 기준 |
|--------|----------|----------|
| unit-tests | Jest, Vitest, pytest | 커버리지 ≥ 80%, 실패 0건 |
| contract-tests | Pact, Schemathesis, 저장소 내 drift validator | 계약 위반 0건 |
| integration-tests | 실제 의존성 사용 | 실패 0건 |
| e2e-smoke | Playwright, Cypress | 핵심 사용자 여정 통과 |

### 2. Code Health (코드 건강)

| 게이트 | 도구 예시 | PASS 기준 |
|--------|----------|----------|
| lint | ESLint, pylint | 오류 0건 (경고는 허용) |
| type-check | TypeScript, mypy, JSDoc boundary validator | 타입 오류 0건 |
| static-analysis | SonarQube, CodeClimate | Critical/High 이슈 0건 |

### 3. Security (보안)

| 게이트 | 도구 예시 | PASS 기준 |
|--------|----------|----------|
| secret-scan | Gitleaks, TruffleHog | 시크릿 감지 0건 |
| dependency-scan | Snyk, Trivy, npm audit | High/Critical CVE 0건 |
| authn-authz-regression | 자동화된 권한 테스트 | 권한 우회 0건 |
| input-validation | OWASP ZAP, 단위 테스트 | SQL/XSS/Injection 0건 |

### 4. Supply Chain & Operations (공급망 및 운영)

| 게이트 | 도구 예시 | PASS 기준 |
|--------|----------|----------|
| sbom | Syft, CycloneDX | SBOM 파일 생성 확인 |
| provenance-evidence | SLSA, Sigstore | Level 1 이상 증명 |
| rollback-verification | 롤백 절차 실행 | 5분 내 롤백 성공 |
| observability-check | 메트릭/트레이싱/로깅 확인 | RED 지표 수집 확인 |

## FAIL 시 처리

1. FAIL 항목을 worklog/fixes.md에 기록한다.
2. 수정 후 해당 게이트만 재실행한다 (전체 재실행 불필요).
3. 모든 게이트 PASS 시에만 Stage D 완료 선언.
4. Stage D FAIL이 3회 이상 반복되면 Stage E 진입을 검토한다.

## 현재 GitHub Actions 자동화 기준

현재 저장소는 네 개의 workflow를 truth surface로 사용한다.

1. `.github/workflows/requirements-validation.yml`
   `requirements/**`와 validator 관련 변경에 대해 `npm run validate:requirements`를 빠르게 실행한다.
2. `.github/workflows/quality-gates.yml`
   로컬에서 이미 구현된 Stage D 품질 게이트와 governance baseline 을 PR과 `main` push에서 재사용한다.
3. `.github/workflows/release-evidence.yml`
   `main` push와 수동 실행에서 SBOM, provenance, release evidence 생성과 artifact upload를 수행한다.
4. `.github/workflows/deployment-smoke.yml`
   수동 실행에서 registry에 선언된 GitHub environment로 배포 환경 smoke를 바인딩한다.

`quality-gates.yml`은 현재 다음 명령을 자동화한다.

```bash
npm run validate:requirements
npm run test:contract
npm test
npm run test:authn-authz
npm run test:e2e-smoke
npm run lint
npm run type-check
npm run validate:composition
npm run scan:secrets
npm run scan:dependencies
npm run check:advisory-policy
npm run check:branch-protection-policy
npm run check:deployment-smoke-binding
npm run check:deployment-environment-provisioning
npm run generate:sbom
npm run verify:provenance
npm run test:rollback
npm run check:observability
```

다음 항목은 아직 `quality-gates.yml`의 상시 CI 범위 밖에 있다.

1. GitHub 원격 branch protection 설정값 자체의 자동 조회/비교
2. 배포 환경 또는 외부 인프라가 필요한 full runtime smoke 의 상시 자동 트리거

`check:branch-protection-policy`는 저장소 안의 baseline 과 validator 를 강제한다.
이 게이트는 GitHub 원격 설정을 직접 읽지는 않는다.
즉, repository baseline 과 remote enforcement 는 서로 다른 층이며 둘 다 필요하다.

대신 배포 환경 smoke 는 별도 on-demand workflow 로 승격됐다.

1. `.github/workflows/deployment-smoke.yml`
   `workflow_dispatch` 입력으로 registry에 선언된 `environment_name` 을 받아 GitHub environment job binding 위에서 실제 배포 환경 smoke runner 를 실행한다.
2. `.github/workflows/quality-gates.yml`
   `check:deployment-smoke-binding` 으로 environment registry와 workflow 입력/환경 바인딩이 drift 나지 않도록 강제한다.
3. `check:deployment-environment-provisioning`
   registry와 provisioning policy, generated audit template 간 drift 를 막는다.
4. 배포 smoke artifact 는 `artifacts/deployment-smoke/latest.json`, `artifacts/deployment-smoke/target-resolution.json`, `artifacts/deployment-smoke/environment-provisioning-audit-template.json` 으로 남는다.
5. 원격 GitHub environment provisioning 자체는 저장소 밖이므로 상시 CI 가 아니라 operator-collected 운영 증적으로 유지한다.

## 저장소 기본 계약 검증 명령

```bash
npm run validate:requirements
```

이 명령은 Stage A 입력 계약을 다음 기준으로 검증한다.

1. `requirements.yaml`이 현재 저장소가 사용하는 top-level shape를 따른다.
2. `contracts.*`와 `composition.*` 경로가 실제 계약 파일을 가리킨다.
3. `quality_gates`가 저장소 기본선 항목을 빠뜨리지 않는다.
4. `routing`, `feature_flags`, `nfr` 섹션이 구조적으로 유효하다.

## 저장소 기본 contract drift 검증 명령

```bash
npm run test:contract
```

이 명령은 최소 기준으로 다음 드리프트를 잡아야 한다.

1. `capability.yaml` ↔ `ui-contract.yaml` 참조 불일치
2. `capability.yaml` ↔ `openapi.yaml` operationId/응답 계약 불일치
3. `events.schema.json` ↔ capability 이벤트 선언 불일치
4. HTTP 인터페이스 코드 ↔ openapi 경로 드리프트
5. `contracts/events/registry.yaml` ↔ domain event schema 정의 및 `produced_by` 경로 드리프트
6. `contracts/events/envelope.schema.json` 이 CloudEvents 필수 필드를 유지하는지 여부

## 저장소 기본 타입 경계 검증 명령

```bash
npm run type-check
```

현재 코어 기준선은 외부 의존 설치 없이 동작하는 JSDoc 기반 타입 경계 검증이다.

1. 핵심 포트 파일은 import typedef와 메서드 시그니처를 가져야 한다.
2. 핵심 엔티티 파일은 생성/재구성/변이 메서드의 입력과 반환 타입을 문서화해야 한다.
3. 핵심 인터페이스 파일은 요청/응답 시그니처를 문서화해야 한다.
4. 모든 핵심 경계 파일은 `@ts-check` 호환 상태를 유지해야 한다.

## 저장소 기본 authn/authz 회귀 검증 명령

```bash
npm run test:authn-authz
```

현재 코어 기준선은 각 도메인의 `tests/interface`를 독립 게이트로 승격해 다음을 보장한다.

1. 권한 없는 호출은 403으로 거부된다.
2. 읽기/쓰기/관리자 권한 경계가 도메인별로 회귀 없이 유지된다.
3. interface 레이어가 ADR-0002의 보안 경계 역할을 실제 테스트로 증명한다.

## 저장소 기본 e2e smoke 검증 명령

```bash
npm run test:e2e-smoke
```

현재 코어 기준선은 controller-level smoke에 더해 최소 network-level server wiring smoke를 포함한다.

1. 핵심 성공 경로가 인터페이스 계층에서 빠르게 검증된다.
2. `src/tests/smoke` 기준선이 실제 HTTP 서버를 기동해 transport, JSON body parsing, header-to-caller mapping 을 검증한다.
3. 존재하지 않는 리소스는 404를 유지하고 권한 실패 경로는 403을 유지한다.
4. 외부 인프라나 배포 환경을 포함한 full end-to-end smoke는 후속 packet에서 추가한다.

배포 환경 smoke는 아직 `quality-gates.yml` 에 자동 연결되지 않았다.
대신 Stage E 문서에 manual baseline 이 있다.

1. `npm run test:e2e-smoke` 는 in-repo transport smoke 이다.
2. `python3 scripts/resolve_deployment_target.py --environment <name>` 은 저장소 registry와 GitHub environment 변수를 기준으로 smoke target 을 해석한다.
3. `npm run smoke:deployment -- --base-url <url>` 은 실제 배포 URL 대상으로 health/task/billing 권한 경로를 검증하고 JSON evidence 를 남긴다.
4. `workflow_dispatch` 로 같은 runner 를 GitHub Actions 에서 실행할 수 있고, job 은 선택된 GitHub environment 에 바인딩된다.
5. `npm run generate:deployment-environment-audit-template` 은 원격 GitHub environment audit 템플릿을 생성한다.
6. `npm run check:deployment-environment-provisioning` 은 policy/template/registry drift 를 막지만, live remote 결과 자체를 조회하지는 않는다.
7. 로그/ingress/runtime wiring 확인과 원격 environment provisioning 확인은 여전히 운영자 확인이 필요하므로 `STATUS: operator-collected` 로 유지한다.

## 저장소 기본 공급망 검증 명령

```bash
npm run scan:dependencies
npm run generate:sbom
npm run verify:provenance
```

이 기준선은 저장소 수준에서 다음을 보장한다.

1. dependency lockfile 과 package manifest 가 서로 일치한다.
2. 현재 코어 baseline 에서는 runtime dependency 유입이 즉시 감지된다.
3. 잠긴 패키지의 integrity/license 메타데이터가 존재한다.
4. 실제 CI/CD 서명 체계 도입 전에도 공급망 증적이 재생성 가능하다.

## 저장소 기본 dependency scan 명령

```bash
npm run scan:dependencies
npm run check:advisory-policy
```

현재 코어 기준선은 외부 CVE API 없이도 다음을 검증한다.

1. SBOM 산출 경로가 고정된다.
2. `package.json` 과 `package-lock.json` root metadata 가 일치한다.
3. runtime dependency 유입이 없고, 현재는 dev tooling 만 잠겨 있다.
4. 잠긴 패키지는 integrity 와 허용 license 정보를 가진다.
5. 실제 advisory feed 연동은 Phase 2 에서 추가한다.

## 저장소 기본 advisory strategy 검증 명령

```bash
npm run check:advisory-policy
```

현재 코어 기준선은 다음을 보장한다.

1. 오프라인 baseline 과 온라인 advisory scan 의 역할이 문서와 정책 파일에 분리돼 있다.
2. `main` 차단 조건과 경고 조건이 정책 파일에 기록돼 있다.
3. 예외 승인 시 필요한 필드가 미리 정해져 있다.
