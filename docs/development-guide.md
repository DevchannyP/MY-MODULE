# Development Guide

이 문서는 신규 참여자가 현재 저장소 구조 기준으로 작업을 시작하고 끝내는 가장 짧은 경로를 정리한다.

## 1. 시작 전에 읽을 파일

아래 순서대로 읽는다.

```bash
sed -n '1,160p' memory/checkpoint.yaml
sed -n '1,220p' memory/current-state.yaml
sed -n '1,220p' memory/current-wp.yaml
sed -n '1,260p' memory/wp-queue.yaml
```

필요하면 아래도 본다.

```bash
sed -n '1,220p' memory/next-actions.yaml
sed -n '1,260p' docs/reference/memory-schema.md
sed -n '1,260p' docs/reference/routing-rules.md
```

## 2. 작업 브랜치 시작

오류 수정이면:

```bash
git checkout -b fix/core-<short-topic>
```

일반 개선이면:

```bash
git checkout -b feature/core-<short-topic>
```

문서/거버넌스면:

```bash
git checkout -b docs/core-<short-topic>
```

## 3. 어떤 파일을 같이 봐야 하는가

- 코드 수정
  관련 contract, smoke test, validator, README 영향까지 본다.
- planner/status 수정
  `scripts/`, `master-shell/catalog/`, `artifacts/master-planner/`, `src/tests/smoke/`를 같이 본다.
- memory 관련 수정
  root `memory/*.yaml`을 기준으로 보고, `memory/project/*`는 레거시 호환이 필요할 때만 본다.

## 4. 기본 검증 순서

가벼운 수정:

```bash
npm run lint
npm run validate:composition
npm run project:status
```

일반 기준선:

```bash
npm run validate:requirements
npm run lint
npm run test:contract
npm test
npm run test:e2e-smoke
```

배포/거버넌스 점검이 포함되면:

```bash
npm run scan:dependencies
npm run check:advisory-policy
npm run check:branch-protection-policy
npm run generate:release-evidence
```

## 5. 수정 원칙

- 기존 구조와 네이밍을 유지한다.
- 원인 확인 없이 대규모 리팩토링하지 않는다.
- 생성 산출물은 생성기와 함께 맞출 수 있을 때만 갱신한다.
- 문서만 고치더라도 실제 명령과 경로가 현재 저장소와 일치해야 한다.

## 6. memory / worklog 동기화 원칙

- root `memory/current-state.yaml`, `memory/current-wp.yaml`, `memory/next-actions.yaml`이 우선이다.
- `memory/project/*`는 레거시 상세나 호환이 필요한 경우에만 보조 갱신한다.
- 작업 이유와 검증 결과는 `worklog/` 또는 PR 설명에서 추적 가능해야 한다.

## 7. 커밋과 PR

권장 커밋 예시:

```text
fix(status): restore canonical work packet context budget fallback
docs(governance): align branch workflow and pr template
```

PR에는 아래를 넣는다.

1. 변경 이유
2. 수정 파일
3. 검증 결과
4. 위험과 rollback

## 8. 종료 전 마지막 확인

- 빌드/실행/CRUD 차단 오류를 새로 만들지 않았는가
- 문서와 실제 명령이 일치하는가
- 불필요한 artifact, secrets, env 파일이 staged 되지 않았는가
- `main` 직접 push가 아니라 PR 경로로 반영할 준비가 되었는가
