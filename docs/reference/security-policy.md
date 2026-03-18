# 보안 정책 참조

> **WHAT** 중심 문서: 이 저장소에 적용되는 보안 정책

## 인증/인가

- 모든 API 엔드포인트는 인증이 필요하다. (예외는 ADR로 정당화 필요)
- 최소 권한 원칙(PoLP)을 적용한다.
- 권한 정의는 Stage A에서 bounded context와 함께 확정한다.

## 시크릿 관리

- 코드, 로그, 환경변수 파일에 시크릿 하드코딩 금지.
- `.env` 파일은 `.gitignore`에 포함해야 한다.
- 시크릿은 외부 시크릿 관리 시스템을 사용한다. [확인 필요: 어떤 시스템을 사용할지 결정 필요]

## 의존성 보안

- High/Critical CVE가 있는 의존성은 사용하지 않는다.
- 의존성 버전은 고정(pin)한다.
- 주 1회 이상 dependency scan을 실행한다.

## 입력 검증

- 모든 외부 입력은 경계(boundary)에서 검증한다.
- SQL Injection, XSS, Command Injection 등 OWASP Top 10 방어를 적용한다.
- 도메인 코어는 검증된 입력만 받는 구조로 설계한다.

## 공급망 보안

- SBOM(Software Bill of Materials)을 각 빌드마다 생성한다.
- 빌드 증명(provenance)을 기록한다.
- 서드파티 라이브러리는 라이선스 검토 후 사용한다. [확인 필요: 라이선스 정책 확정 필요]
