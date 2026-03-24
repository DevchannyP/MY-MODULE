# GitHub Branch Protection 기준

이 문서는 GitHub 원격 저장소가 어떤 보호 규칙을 가져야 하는지 설명한다.

## 1. 아주 쉽게 설명하면

`main` 은 "최종 정답을 모아두는 창고"다.
창고 문은 아무나 열면 안 된다.

그래서 아래가 필요하다.

1. 직접 밀어 넣기 금지
2. 검사 통과 확인
3. 리뷰 확인
4. 강제 덮어쓰기 금지

## 2. 보호 대상

- 필수 보호 브랜치: `main`
- 권장 보호 브랜치: `develop`

## 3. 최소 보호 규칙

- direct push 금지
- PR merge 전 최소 1회 review
- stale review dismissal 권장
- force push 금지
- branch deletion 금지

`develop`에는 아래 둘 중 하나를 권장한다.

1. `main`과 동일한 PR-only 정책
2. 제한된 maintainer만 direct push 가능, 그 외에는 PR-only

## 4. required checks

코어 저장소 기준 `main` 최소 required checks:

1. `npm run lint`
2. `npm run test:contract`
3. `npm run type-check`
4. `npm test`
5. `npm run scan:dependencies`
6. `npm run check:advisory-policy`
7. `npm run generate:release-evidence`

## 5. 저장소 내부 파일

- 정책 파일: `artifacts/github/branch-protection-policy.yaml`
- 정책 검증: `npm run check:branch-protection-policy`

`develop` 보호 규칙은 원격 GitHub 설정에서 별도로 운영하되, 문서 기준은 이 문서와 [branch-strategy.md](/root/workspace/my-module/docs/branch-strategy.md)를 따른다.

## 6. 원격 설정과 저장소 문서의 관계

- 저장소 문서: "어떻게 해야 하는가"를 기록
- GitHub 설정: "실제로 막는 장치"

둘 다 있어야 한다.
