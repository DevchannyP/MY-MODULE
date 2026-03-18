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

## 저장소 기본 계약 검증 명령

```bash
npm run test:contract
```

이 명령은 최소 기준으로 다음 드리프트를 잡아야 한다.

1. `capability.yaml` ↔ `ui-contract.yaml` 참조 불일치
2. `capability.yaml` ↔ `openapi.yaml` operationId/응답 계약 불일치
3. `events.schema.json` ↔ capability 이벤트 선언 불일치
4. HTTP 인터페이스 코드 ↔ openapi 경로 드리프트

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

현재 코어 기준선은 외부 서버가 아닌 controller-level smoke다.

1. 핵심 성공 경로가 인터페이스 계층에서 빠르게 검증된다.
2. 존재하지 않는 리소스는 404를 유지한다.
3. 권한 실패 경로는 403을 유지한다.
4. 실제 네트워크 서버 smoke는 Phase 2 운영 환경에서 추가한다.

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
