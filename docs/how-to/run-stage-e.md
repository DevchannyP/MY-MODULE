# Stage E 실행 방법

> **HOW** 중심 문서: 적대적 검증 및 자기개선 단계를 어떻게 실행하는가?

## Stage E 진입 조건

다음 중 하나 이상 해당 시 진입:
- Stage D FAIL이 3회 이상 반복
- 수동 개입이 지속적으로 증가
- 구조적 단순화가 필요하다고 판단

## 빠른 상태 확인

```bash
npm run stage:e
```

이 명령은 현재 저장소 상태를 읽는 dry-run executor다.
실제 파일을 변경하지 않고 Stage E prerequisite와 참조 문서를 JSON으로 출력한다.

## 실행 절차

### 1단계: 증상 분석

`worklog/incidents.md`와 `worklog/fixes.md`를 읽고 패턴을 파악한다.

반복되는 실패 유형을 분류:
- 계약 불일치: Stage A 재실행 필요
- 조합 문제: Stage B 재실행 필요
- 플러그인 문제: Stage C 재실행 필요
- 구현 문제: 코드 수정 후 Stage D 재실행

### 2단계: 적대적 검증

- 경계 케이스 테스트: 예상치 못한 입력, 동시성, 실패 주입
- 계약 위반 시뮬레이션: 의존 모듈이 계약을 위반하면 어떻게 되는가?
- 권한 우회 시도: 정의된 권한 모델이 실제로 작동하는가?

### 3단계: 구조 단순화 제안

복잡성이 근본 원인인 경우 ADR을 작성하여 구조 변경을 제안한다.

### 4단계: 자기개선 기록

root `memory/next-actions.yaml`에 구조 개선 사항을 기록한다.
레거시 자동화가 남아 있으면 `memory/project/next-actions.yaml`은 호환 계층으로만 보조 갱신한다.
`worklog/release-notes.md`에 이번 Stage E 결과를 기록한다.

### 5단계: 재실행

개선 사항을 적용하고 해당 Stage부터 재실행한다.

## 배포 환경 smoke baseline

현재 저장소에는 두 층의 smoke가 있다.

1. `npm run test:e2e-smoke`
   저장소 안에서 HTTP transport, JSON parsing, header-to-caller mapping, feature flag off-path 를 검증한다.
2. 배포 환경 smoke
   실제 배포 URL, ingress, 환경 변수, reverse proxy, runtime port binding 을 확인한다.

두 번째 항목은 상시 자동은 아니지만, registry와 GitHub environment binding 위의 operator-triggered workflow로 실행할 수 있다.
따라서 Stage E에서는 아래 순서로 truthfully 수행한다.

### 6단계: 배포 환경 preflight

로컬 또는 CI에서 먼저 아래를 통과시킨다.

```bash
npm run validate:requirements
npm run lint
npm run test:contract
npm test
npm run test:e2e-smoke
```

이 단계는 "배포해도 될 최소 내부 기준"이지, 실제 환경 검증 자체는 아니다.

### 7단계: 배포 환경 executable smoke

배포된 환경이 있을 때는 checklist 를 말로만 반복하지 말고 runner 로 실행한다.
저장소 안의 canonical 환경 목록은 `master-shell/operations/deployment-environments.yaml` 이다.

```bash
npm run smoke:deployment -- \
  --base-url "$BASE_URL" \
  --task-write-permissions "task:read,task:write" \
  --task-read-permissions "task:read"
```

이 runner 는 다음 항목을 검증하고 `artifacts/deployment-smoke/latest.json` 에 증적을 남긴다.

1. `GET /health` 가 `200`, `status=ok`, `traceId` 를 반환한다.
2. task-management 가 켜진 환경에서는 task 생성/조회 핵심 경로가 동작한다.
3. billing 쓰기 권한이 없는 호출이 `403` 과 `FORBIDDEN` 코드를 유지한다.
4. 선택적으로 `--flag-off-path` 를 주면 비활성화 경로가 `404` 와 `NOT_FOUND` 를 유지하는지 검증한다.

예시:

```bash
npm run smoke:deployment -- \
  --base-url "$BASE_URL" \
  --task-write-permissions "task:read,task:write" \
  --task-read-permissions "task:read" \
  --flag-off-path "/tasks" \
  --flag-off-permissions "task:read"
```

모든 배포 환경에서 flag-off 경로를 항상 가질 수는 없다.
이 경우 runner 는 해당 항목을 `SKIPPED` 로 기록하고, 운영자는 worklog 에 이유를 남긴다.

### 8단계: 남는 수동 운영 확인

runner 가 있어도 아래는 여전히 운영자 확인 영역이다.

1. 대상 URL이 실제 배포 endpoint/ingress 를 가리키는지 확인한다.
2. reverse proxy, env wiring, runtime port binding 이 배포 플랫폼에서 기대대로 연결됐는지 확인한다.
3. 플랫폼 로그에 trace_id 또는 동등 상관 ID 가 남는지 확인한다.
4. smoke 결과 JSON 경로와 수동 확인 결과를 `worklog/release-notes.md` 또는 해당 packet worklog 에 기록한다.
5. 원격 GitHub environment provisioning 상태는 generated audit template 에 live 결과를 채워 별도 증적으로 남긴다.

GitHub Actions 에서 실행할 때는 `Actions > Deployment Smoke > Run workflow` 를 사용한다.
이 workflow 는 먼저 선택한 `environment_name` 을 `master-shell/operations/deployment-environments.yaml` 과 대조하고,
선택된 GitHub environment 의 변수(`DEPLOYMENT_BASE_URL` 등)로 target 을 해석한다.
자동 대상 환경이 없는 동안에는 이 흐름을 `STATUS: operator-triggered` 로 유지한다.

원격 provisioning audit 준비는 아래처럼 수행한다.

```bash
npm run generate:deployment-environment-audit-template
```

이 명령은 `artifacts/deployment-smoke/environment-provisioning-audit-template.json` 을 생성한다.
운영자는 이 템플릿의 placeholder 를 실제 GitHub API 결과로 채우고, 다음 항목을 확인해야 한다.

1. environment 가 실제로 존재하는지
2. required vars 가 모두 설정됐는지
3. canary/production 에 reviewer, self-review 방지, branch policy 가 baseline 이상인지
4. 채운 결과를 해당 packet worklog 나 release evidence 와 함께 보관했는지
