# ADR 0009: GitHub Branch Protection 기준선

**날짜**: 2026-03-19
**상태**: 수락됨 (Accepted)
**결정자**: core-platform
**발견 경위**: 저장소 내부 git 거버넌스는 생겼지만, 원격 GitHub의 branch protection 과 required checks 는 아직 정책 파일로 고정되지 않았다.

## 맥락

지금 저장소에는 아래 규칙이 이미 있다.

1. `main` 은 기준선 브랜치다.
2. 작업은 짧은 브랜치에서 한다.
3. PR 에 검증과 memory/worklog 가 함께 들어와야 한다.

하지만 이 규칙이 GitHub 원격 설정과 연결되지 않으면 이런 문제가 생긴다.

1. 문서에는 "main 직접 푸시 금지"라고 적혀 있어도 실제 저장소에서는 가능할 수 있다.
2. required checks 가 없으면 검증 실패 상태로도 병합될 수 있다.
3. 다른 프로젝트가 이 저장소 규칙을 재사용할 때 원격 보호 기준이 빠질 수 있다.

## 결정

GitHub branch protection 을 두 층으로 다룬다.

### 1. 저장소 내부 기준선

저장소 안에는 아래를 정책 파일로 고정한다.

- 보호 대상 브랜치: `main`
- 직접 푸시: 금지
- required PR reviews: 최소 1
- required checks:
  - `lint`
  - `test:contract`
  - `type-check`
  - `test`
  - `scan:dependencies`
  - `check:advisory-policy`
  - `generate:release-evidence`
- force push: 금지
- branch deletion: 금지

### 2. 원격 GitHub 설정 층

실제 branch protection 적용은 GitHub 저장소 설정에서 수행한다.
이 저장소는 그 설정이 따라야 할 기준선을 문서와 policy file 로 제공한다.

## 결과

1. 저장소 내부 규칙과 GitHub 원격 보호 규칙이 같은 문장을 보게 된다.
2. 다른 프로젝트도 이 policy file 을 복사해서 같은 보호 모델을 적용할 수 있다.
3. 자동화 에이전트가 "어떤 checks 가 main 병합 전에 필수인가"를 명확히 알 수 있다.

## 대안

- **GitHub 설정만 믿고 저장소 안에는 기록하지 않기**
  - 거부: 다른 환경으로 옮길 때 규칙이 사라진다.
- **저장소 내부 문서만 두고 required checks 는 자유로 두기**
  - 거부: 실제 merge 정책이 흔들린다.

## 후속 작업

- branch protection policy file 추가
- policy validator 추가
- GitHub 설정 체크리스트 추가
