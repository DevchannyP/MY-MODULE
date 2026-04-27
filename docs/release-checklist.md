# Release Checklist

이 문서는 `main` 또는 `release/*`로 반영하기 전 마지막 확인용 체크리스트다.

## 1. 변경 범위 확인

- 변경 목적이 설명 가능한가
- 코드, contract, memory, docs 영향 범위를 설명 가능한가
- 불필요한 generated artifact, temp file, secret 파일이 staged 되지 않았는가

## 2. 필수 검증

```bash
npm run validate:requirements
npm run lint
npm run validate:composition
npm run test:contract
npm test
npm run type-check
npm run scan:dependencies
npm run check:advisory-policy
npm run check:branch-protection-policy
```

런타임과 상태 확인:

```bash
npm run project:status
npm run db:migrate:test
npm run test:e2e-smoke
python3 scripts/generate-master-planner.py --silent
```

## 3. 문서와 증적

- README가 현재 명령과 구조를 반영하는가
- 필요한 how-to / troubleshooting / governance 문서가 함께 갱신됐는가
- release evidence 생성이 필요한 변경이면 아래를 실행했는가

```bash
npm run generate:release-evidence
```

## 4. Git 반영 전 확인

- `main`에 직접 push하지 않는가
- 브랜치 이름이 목적과 맞는가
- 커밋이 변경 목적별로 분리됐는가
- PR 설명에 검증, 위험, rollback이 들어가는가

## 5. 병합 전 확인

- required checks가 전부 통과했는가
- 최소 1인 리뷰가 완료됐는가
- stale review dismissal이 필요한 변경인지 확인했는가
- 배포나 운영 영향이 크면 `release/*` 또는 `hotfix/*` 경로를 택했는가
