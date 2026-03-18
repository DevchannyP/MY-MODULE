# Stage C 실행 방법

> **HOW** 중심 문서: 마스터 UI 편입 단계를 어떻게 실행하는가?

## 사전 조건

- Stage A, B가 모두 PASS 상태여야 한다.
- `contract/ui-contract.yaml`이 완성되어 있어야 한다.
- `master-shell/plugin-registry/registry.yaml`이 존재해야 한다.

## 실행 절차

### 1단계: Plugin Registry 등록

`master-shell/plugin-registry/registry.yaml`에 플러그인 항목을 추가한다.
(docs/reference/plugin-registry-schema.md 참조)

필수 필드:
- `id`, `name`, `module_id`
- `entry_point`, `navigation.group`, `navigation.label`
- `ui_contract`, `capability_contract` 경로
- `feature_flag` 이름

### 2단계: Feature Flag 설정

`requirements/requirements.yaml`의 `feature_flags` 섹션에 플래그를 추가한다.
기본값은 `false`로 설정한다 (안전한 쪽).

`master-shell/feature-flags/flags.yaml`에도 전역 플래그를 등록한다.

### 3단계: Navigation 등록

`master-shell/navigation/nav.yaml`에 메뉴 항목을 추가한다.
- 레이블은 도메인 언어로 작성한다 (기술 용어 금지).
- navigation_group은 plugin-registry와 일치해야 한다.

### 4단계: Rollout 정책 설정

초기 롤아웃은 `strategy: canary`와 낮은 percentage로 시작한다.
전체 롤아웃은 Stage D 품질 게이트 PASS 후 진행한다.

### 5단계: Observability 연결

`master-shell/observability/`에 이 플러그인의 대시보드 링크와 알림 설정을 추가한다.

### 6단계: Memory 저장

`memory/stageC/[module-id]-plugin.yaml`을 생성한다.

### 품질 게이트 확인

Stage C 완료 기준:
- [ ] plugin-registry에 등록 완료
- [ ] feature_flag 기본값 false로 설정
- [ ] navigation에 도메인 언어 레이블로 등록
- [ ] observability 연결 완료
- [ ] memory/stageC/ 파일 저장 완료
