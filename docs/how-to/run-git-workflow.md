# Git 작업 흐름 실행 가이드

## 1. 작업 브랜치 만들기

브랜치 이름은 Work Packet 단위로 쪼개고, 목적이 드러나야 한다.

권장 패턴:

```bash
wp/<packet-id-lower>/<short-slug>
```

예:

```bash
git checkout -b wp/gov-002/branch-protection-ci
```

도메인 계약 작업이면:

```bash
git checkout -b wp/dom-002/event-registry-contract
```

## 2. 작업하면서 같이 고칠 것

코드를 바꿀 때는 보통 아래 파일도 같이 봐야 한다.

- `memory/current-state.yaml`
- `memory/next-actions.yaml`
- `memory/current-wp.yaml`
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
git push -u origin feat/core-release-evidence
```

## 6. PR 설명에 꼭 넣을 것

1. 왜 이 작업이 필요한가
2. 어떤 위험을 줄였는가
3. 어떤 검증을 통과했는가
4. 다음 작업은 무엇인가

한 PR에는 한 Work Packet만 담는 것을 기본으로 한다.
한 packet이 여러 층을 건드리면, queue가 과도하게 큰 것이다.

## 7. GitHub branch protection 확인 항목

1. `main` direct push 가 막혀 있는가
2. 최소 1회 review 가 필요한가
3. required checks 가 policy file 과 같은가
4. force push 와 branch deletion 이 막혀 있는가
5. repository CI 가 `npm run check:branch-protection-policy` 를 실제로 실행하는가
