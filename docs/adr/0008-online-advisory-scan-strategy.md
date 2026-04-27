# ADR 0008: 온라인 Advisory Feed 연동 전략

**날짜**: 2026-03-19
**상태**: 수락됨 (Accepted)
**결정자**: core-platform
**발견 경위**: dependency-scan baseline 은 실동작화됐지만, 외부 advisory DB 연동 정책이 아직 저장소 안에 고정되지 않았다.

## 맥락

현재 코어 저장소는 `scan:dependencies`로 다음을 오프라인에서 검증한다.

1. `package.json` 과 `package-lock.json` 이 같은 말을 하는가
2. runtime dependency 가 새로 들어오지 않았는가
3. 잠긴 패키지에 `integrity` 와 `license` 가 있는가

이 검증은 재현 가능하고 빠르다.
하지만 외부에서 새로 공개된 CVE 정보는 스스로 알 수 없다.

그래서 다음 단계에서는 온라인 advisory feed 가 필요하다.

## 결정

dependency scan 을 두 층으로 나눈다.

### 1. 오프라인 baseline 층

- 명령: `npm run scan:dependencies`
- 목적: 잠금, 무결성, runtime dependency 유입 통제
- 특징: 네트워크 없이도 항상 재현 가능

### 2. 온라인 advisory 층

- 1차 후보: `npm audit --audit-level=high --omit=dev`
- 보강 후보: GitHub Advisory DB, Snyk
- 목적: 외부에 공개된 신규 CVE 정보를 반영
- 특징: 네트워크와 advisory source 상태에 영향을 받음

## 차단 정책

### main 병합 차단

다음 조건이면 `main` 병합을 차단한다.

1. runtime dependency 에 High/Critical advisory 가 존재
2. 예외 승인 없이 미완료 remediation 상태

### 경고만 기록

다음 조건이면 일단 경고와 worklog 기록으로 처리한다.

1. devDependency 에 High/Critical advisory 존재
2. 런타임 영향이 없고 대체 계획이 이미 존재
3. advisory source 일시 장애로 온라인 검사만 실패

## 예외 정책

예외는 자유 텍스트가 아니라 ADR 또는 worklog 근거가 필요하다.

최소 기록 항목:

1. advisory 식별자
2. 영향 범위
3. 왜 즉시 업데이트할 수 없는지
4. 임시 완화책
5. 재검토 날짜

## 결과

1. 오프라인 baseline 과 온라인 advisory scan 의 역할이 섞이지 않는다.
2. 네트워크 장애와 실제 취약점 발견을 구분해서 다룰 수 있다.
3. 다른 프로젝트와 연결할 때도 같은 보안 운영 모델을 재사용할 수 있다.

## 대안

- **오프라인 baseline 만 유지**
  - 거부: 신규 CVE 공개를 자동 반영하지 못한다.
- **온라인 advisory 만 유지**
  - 거부: 네트워크 문제와 저장소 무결성 문제를 분리하지 못한다.
- **런타임/개발 의존성 구분 없이 모두 차단**
  - 거부: 코어 저장소 운영 흐름이 과도하게 경직된다.

## 후속 작업

- advisory feed 정책 문서 추가
- 정책 검증 스크립트 추가
- GitHub / CI 환경에서 실제 온라인 명령 연동
