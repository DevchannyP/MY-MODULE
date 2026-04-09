---
adr_id: "0012"
title: "ADR-0012: UI Shell 구성 전략 — 바닐라 JS + 정적 배포"
status: ACCEPTED
date: "2026-03-30"
deciders: ["architect-agent"]
stage: B
domain: ui-shell
risk_level: MEDIUM
---

# ADR-0012: UI Shell 구성 전략 — 바닐라 JS + 정적 배포

## Status

ACCEPTED

## Context

Workflow OS는 현재 정적 HTML 생성 파이프라인(`build-static-ui.js`)을 통해
도메인 카탈로그, 학습 가이드, 홈 화면을 생성하고 있다.

WP-UI-001에서 System OS API 계약이 완성되었으며(capability 9개, OpenAPI 엔드포인트 9개,
SSE 이벤트 5종, UI 화면 7개), 이제 이 계약을 실제 UI로 구현하기 위한
조합 아키텍처를 결정해야 한다.

### 현재 상태
- `scripts/generate-ui-home.js` (대규모 정적 생성기) — YAML/JSON 근거를 읽어 루트 홈 HTML을 생성
- `scripts/generate-catalog-site.js` — 도메인 카탈로그 정적 HTML 생성
- `scripts/build-static-ui.js` — 위 생성기들을 병렬 실행하는 오케스트레이터
- 프레임워크 의존성 0 (순수 Node.js + 브라우저 바닐라 JS)
- `package.json` dev dependencies: ESLint, Turbo, Husky, fast-check 등 개발 도구만 존재

### 요구사항
1. 7개 System OS 화면의 실시간 데이터 갱신 (SSE)
2. 관리자 인터랙션 (플래그 토글, 롤백 트리거)
3. 기존 빌드 파이프라인과의 호환
4. 공급망 기준선(SBOM/provenance) 유지

## Decision

**바닐라 JavaScript + 정적 배포 전략을 채택한다.**

구체적으로:
1. **빌드 타임**: `scripts/lib/ui-shell.js`가 공통 Shell (NavHeader, CSS, JS)을 생성
2. **빌드 타임**: `scripts/lib/system-api-client.js`가 YAML/JSONL 파일을 읽어 데이터 수집
3. **런타임**: `artifacts/shared/shell.js`가 SSE 연결 관리 + DOM 갱신
4. **런타임**: `artifacts/shared/shell.css`가 디자인 토큰 + 컴포넌트 스타일 제공
5. **빌드 파이프라인**: 기존 `build-static-ui.js`의 `Promise.all` 병렬 구조 유지

## Rationale

### 프레임워크 도입 비용 분석

| 기준 | 바닐라 JS | React SPA | Vue SPA | htmx | Alpine.js |
|------|-----------|-----------|---------|------|-----------|
| 빌드 도구 추가 | 없음 | webpack/vite + babel | vite + vue-compiler | 없음 | 없음 |
| node_modules 증가 | 0 | ~300MB | ~150MB | ~50KB | ~30KB |
| 기존 파이프라인 호환 | 완전 호환 | 단절 (빌드 체인 교체) | 단절 | 부분 호환 | 부분 호환 |
| SBOM 재산출 | 불필요 | 필수 (수십 개 신규 dep) | 필수 | 필수 (1개) | 필수 (1개) |
| 학습 곡선 | 없음 | 중간 | 중간 | 낮음 | 낮음 |
| 컴포넌트 재사용성 | 낮음 (함수 기반) | 높음 | 높음 | 중간 | 중간 |
| SSE 통합 | 네이티브 EventSource | 라이브러리 필요 | 라이브러리 필요 | 내장 | 수동 |

### 채택 근거
1. **기존 패턴과의 일관성**: `generate-ui-home.js`는 이미 2,800줄 이상의 바닐라 JS로
   복잡한 대시보드를 성공적으로 생성하고 있다. 이 패턴이 검증된 상태이다.
2. **빌드 파이프라인 유지**: `build-static-ui.js`의 3단계 병렬 생성 구조를 그대로 사용한다.
3. **의존성 0 유지**: 현재 runtime dependency가 0인 상태를 유지하여 공급망 복잡도를 억제한다.
4. **SSE 네이티브 지원**: 브라우저 내장 `EventSource`를 직접 사용하므로 별도 라이브러리 불필요.
5. **점진적 전환 가능**: 향후 화면 복잡도가 임계를 넘으면 Alpine.js나 htmx를 점진 도입 가능.

## Consequences

### 긍정적
- 배포 단순성 유지 (정적 파일만 서빙)
- 빌드 시간 증가 없음
- 공급망 기준선 재산출 불필요
- 기존 테스트 인프라(DOM 구조 검증) 재활용 가능

### 부정적
- 컴포넌트 재사용성이 함수 수준으로 제한됨
- 복잡한 상태 관리(모달 체인, 필터 조합)를 수동 관리해야 함
- UI 테스트가 DOM 문자열 검증에 의존하여 리팩터링 비용 증가 가능

### 전환 트리거
다음 조건 중 2개 이상 충족 시 프레임워크 도입을 재검토한다:
1. 화면 수가 15개를 초과할 때
2. 동일 UI 패턴이 3회 이상 복사-붙여넣기될 때
3. 상태 관리 버그가 3건 이상 발생할 때
4. 새로운 도메인 팀이 독립 UI 개발을 요구할 때

## Alternatives Considered

### React SPA
- 장점: 컴포넌트 재사용, 풍부한 생태계, 선언적 UI
- 기각 이유: 빌드 도구 체인 전면 교체, 수백 MB node_modules 추가, 기존 정적 생성 패턴 단절

### Vue SPA
- 장점: React보다 가벼움, 단일 파일 컴포넌트
- 기각 이유: 여전히 빌드 도구 필요, 기존 파이프라인 단절

### htmx
- 장점: HTML 속성 기반 동적 갱신, 서버 렌더링과 궁합 좋음
- 기각 이유: 현재 서버가 HTML 조각을 반환하는 구조가 아님, SSE 통합 시 커스텀 확장 필요

### Alpine.js
- 장점: 가벼움(~30KB), 바닐라 JS와 공존 가능
- 기각 이유: 현재 화면 7개 수준에서는 과도한 추상화, 향후 전환 트리거 충족 시 1순위 후보

## References
- WP-UI-001 결과: `contracts/system-api/capability.yaml`, `contracts/ui-shell/ui-contract.yaml`
- Stage B 조합 메모리: `memory/stageB/ui-shell-composition.yaml`
- 기존 빌드 파이프라인: `scripts/build-static-ui.js`
- 어댑터 레지스트리: `master-shell/catalog/adapter-registry.yaml`
