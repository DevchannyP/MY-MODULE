# Advisory Feed 정책 참조

이 문서는 "온라인 취약점 피드"를 언제, 어떻게, 무엇으로 판정할지 설명한다.

## 1. 아주 쉽게 설명하면

현재 저장소에는 이미 "문이 잘 잠겼는지 확인하는 검사"가 있다.
그게 오프라인 dependency baseline 이다.

하지만 세상 밖 뉴스에서
"이 자물쇠는 어제부터 위험해졌어요"라는 새 소식이 나올 수 있다.

그 새 소식을 받아오는 검사가 온라인 advisory feed 다.

## 2. 두 층으로 나누는 이유

### 오프라인 baseline

- 저장소 안에서 바로 확인 가능
- lockfile, integrity, license, runtime dependency 유입 통제

### 온라인 advisory

- 저장소 밖의 새 CVE 정보 반영
- advisory source 와 네트워크가 필요

둘을 나누면 좋은 점:

1. 네트워크 장애와 보안 문제를 헷갈리지 않는다.
2. 저장소 자체 문제와 외부 뉴스 문제를 분리할 수 있다.
3. 다른 프로젝트도 같은 모델을 쉽게 재사용할 수 있다.

## 3. 권장 provider 순서

1. `npm audit --omit=dev --audit-level=high`
2. GitHub Advisory DB
3. Snyk 같은 추가 상용 스캐너

## 4. 차단 규칙

### 바로 차단

- runtime dependency 에 High/Critical 취약점 존재
- 예외 승인 없이 remediation 계획도 없음

### 경고로 시작

- devDependency 취약점
- advisory source 일시 장애
- 이미 완화책이 있고 작업이 큐에 등록됨

## 5. 저장소 내부 기준선 파일

- 정책 파일: `artifacts/advisory/advisory-policy.yaml`
- 정책 검증: `npm run check:advisory-policy`
- 실제 온라인 스캔 연결: Phase 2

## 6. 현재 제한

이 저장소는 아직 advisory source 에 직접 접속하지 않는다.
지금은 "어떤 방식으로 붙일지"를 먼저 고정한 상태다.
