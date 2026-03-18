# 공급망 정책 참조

> **WHAT** 중심 문서: 소프트웨어 공급망 보안 정책

## SBOM (Software Bill of Materials)

- 형식: SPDX 또는 CycloneDX
- 생성 시점: 각 릴리즈 빌드마다
- 저장 위치: `artifacts/sbom/workflow-os.spdx.json`
- 도구: Syft 또는 CycloneDX CLI 권장
- 코어 저장소 baseline 명령: `npm run generate:sbom`

## 빌드 증명 (Provenance)

- SLSA Level 1 이상 달성을 목표로 한다.
- 빌드 환경, 입력, 출력을 기록한다.
- baseline policy: `artifacts/provenance/provenance-policy.yaml`
- baseline evidence: `artifacts/provenance/workflow-os-provenance.json`
- 코어 저장소 baseline 명령: `npm run verify:provenance`

## 의존성 고정

- `package-lock.json` 또는 `yarn.lock` 등 잠금 파일을 버전 관리에 포함한다.
- `npm install` 대신 `npm ci`를 사용한다.
- 의존성 업데이트는 PR을 통해서만 진행한다.

## 서드파티 라이브러리 관리

- 새로운 의존성 추가 시 라이선스 확인 필수.
- 허용 라이선스: MIT, Apache-2.0, BSD [확인 필요: 라이선스 정책 확정 필요]
- GPL 등 카피레프트 라이선스는 ADR로 정당화 필요.

## 롤백 정책

- 모든 릴리즈는 롤백 절차가 검증되어야 한다.
- 롤백 소요 시간: 5분 이내 (nfr.yaml의 RTO 참조).
- 롤백 절차: docs/how-to/rollback-and-flags.md 참조.

## 저장소 기준선 검증 명령

```bash
npm run generate:sbom
npm run verify:provenance
```

이 기준선은 실제 CI/CD 서명 체계 전 단계에서 다음을 보장한다.

1. SBOM 산출 경로가 고정되어 있다.
2. provenance evidence가 입력과 산출물 digest를 가진다.
3. 공급망 증적 파일이 저장소 내부에서 재생성 가능하다.
