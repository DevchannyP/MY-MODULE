# Git 작업 흐름 실행 가이드

## 1. 작업 브랜치 만들기

브랜치 이름은 작업 종류와 목적이 드러나야 한다.
Work Packet id는 브랜치명보다 PR, 커밋, worklog에서 남기는 방식을 우선한다.

현재 packet 기준 추천안을 먼저 보려면 아래를 사용한다.

```bash
npm run operator:cockpit
npm run branch:bootstrap
```

실제 커밋 전에는 검증 가드로 먼저 확인한다.

```bash
npm run commit:guard
npm run commit:guard:verify
```

권장 패턴:

```bash
feature/core-<short-topic>
fix/core-<short-topic>
docs/core-<short-topic>
hotfix/core-<short-topic>
```

예:

```bash
git checkout -b fix/core-project-status-context-budget
```

```bash
git checkout -b docs/core-branch-strategy-baseline
```

## 2. 작업하면서 같이 고칠 것

코드를 바꿀 때는 보통 아래 파일도 같이 봐야 한다.

- `memory/current-state.yaml`
- `memory/next-actions.yaml`
- `memory/current-wp.yaml`
- `memory/wp-queue.yaml`
- 필요 시 `memory/project/unresolved-risks.yaml` (레거시 상세 리스크)
- 관련 `docs/adr/`
- 관련 `worklog/`

## 3. 커밋 예시

```bash
git add .github/workflows/quality-gates.yml docs/reference/quality-gates.md
git commit -m "ci(governance): enforce branch protection baseline"
```

```bash
git add contracts/events/registry.yaml scripts/validate_contract_drift.py
git commit -m "feat(contracts): validate central event registry drift"
```

## 4. 검증

```bash
npm run lint
npm run test:contract
npm run type-check
npm test
npm run scan:dependencies
npm run check:advisory-policy
npm run check:branch-protection-policy
npm run generate:release-evidence
```

## 5. 원격 푸시

```bash
git push -u origin fix/core-project-status-context-budget
```

## 6. PR 설명에 꼭 넣을 것

1. 왜 이 작업이 필요한가
2. 어떤 위험을 줄였는가
3. 어떤 검증을 통과했는가
4. 다음 작업은 무엇인가

한 PR에는 한 설명 가능한 목적만 담는 것을 기본으로 한다.
하나의 packet이 여러 층을 건드리더라도 변경 이유와 검증 범위를 설명할 수 있어야 한다.

## 7. GitHub branch protection 확인 항목

1. `main` direct push 가 막혀 있는가
2. `develop` 도 direct push 제한 또는 PR-only 정책인지 확인했는가
3. 최소 1회 review 가 필요한가
4. required checks 가 policy file 과 같은가
5. force push 와 branch deletion 이 막혀 있는가
6. repository CI 가 `npm run check:branch-protection-policy` 를 실제로 실행하는가
