# Git 작업 흐름 실행 가이드

## 1. 작업 브랜치 만들기

브랜치 이름은 작업의 목적이 보여야 한다.

```bash
git checkout -b feat/core-release-evidence
```

문서 작업이면:

```bash
git checkout -b docs/core-git-governance
```

## 2. 작업하면서 같이 고칠 것

코드를 바꿀 때는 보통 아래 파일도 같이 봐야 한다.

- `memory/project/current-state.yaml`
- `memory/project/next-actions.yaml`
- `memory/project/unresolved-risks.yaml`
- 관련 `docs/adr/`
- 관련 `worklog/`

## 3. 커밋 예시

```bash
git add package.json scripts/generate_release_evidence.py
git commit -m "feat(core): add release evidence generator"
```

```bash
git add docs/adr/0007-git-branch-and-commit-governance.md docs/reference/git-governance.md .github/pull_request_template.md
git commit -m "docs(vcs): define git branch and pr workflow"
```

## 4. 검증

```bash
npm run lint
npm run test:contract
npm run type-check
npm test
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
