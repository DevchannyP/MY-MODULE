# Workflow OS 연속 실행 하네스

이 문서는 세션마다 긴 지시를 다시 쓰지 않고, 같은 짧은 프롬프트로 현재 상태를 복구하고 다음 작업을 이어가기 위한 canonical 운영 계약이다.

## 가장 짧은 프롬프트

```text
계속
```

위 한 단어면 충분하다. 에이전트는 아래 순서를 내부적으로 실행해야 한다.

## 요청 유형별 짧은 프롬프트

```text
계속
검토
다음
```

- `계속`: 현재 상태를 읽고 가장 우선순위 높은 다음 한 단계까지 이어서 수행
- `검토`: 현재 packet, 리스크, 다음 작업만 구조화해서 보고
- `다음`: 현재 packet을 닫을 수 있는지 검증하고 `next-actions` 기준 다음 작업으로 넘어갈 준비

자유 형식 요청도 허용한다.

```text
파일첨부 삭제 버그 수정해줘
billing 환불 기능 추가
마스터 UI에서 현재 lane이 잘 안 보여
```

모든 자유 형식 요청은 Intake Packet으로 자동 재구성한다.

## 세션 시작 시 먼저 읽는 파일

1. `requirements/harness-engineering.yaml`
2. `memory/checkpoint.yaml`
3. `memory/current-state.yaml`
4. `memory/current-wp.yaml`
5. `memory/wp-queue.yaml`
6. `memory/next-actions.yaml`
7. `docs/explanation/ai-harness-upgrade-plan.md`
8. 필요 시 `docs/how-to/repeatable-cli-master-prompt.md`

주의:

- `root memory`가 canonical이다.
- `memory/project/*`는 legacy fallback이다.
- 채팅은 규칙 전달용이 아니라 이번 packet의 차이만 전달하는 용도다.

## 내부 실행 프로토콜

### 1. 상태 복구

- 현재 Work Packet, 마지막 완료 packet, 다음 액션, 브랜치 dirty 상태를 복구한다.
- 가능하면 `npm run session:bootstrap`과 `npm run project:status` 출력까지 맞춰 본다.

### 2. Intake Packet 재구성

모든 요청을 아래 6개 필드로 강제 정렬한다.

```yaml
goal: "무엇을 달성해야 하는가"
context:
  - "관련 함수, 파일, 데이터 구조, 계약"
constraints:
  - "건드리면 안 되는 영역"
done_when:
  - "사용자 관점 완료조건"
work_mode:
  - "먼저 원인 분석"
  - "그다음 변경 포인트만 제시"
  - "마지막에 테스트 시나리오 제시"
verification:
  - "변경 후 반드시 확인할 관찰 지점"
```

### 3. 계획 우선

- 버그 수정: 원인 분석 → 최소 변경 change point 확정 → 구현 → 회귀 테스트
- 기능 추가: 요구사항 → 계약/경계 → 구현 → 검증
- 구조 변경: Stage A/B/C 영향도 먼저 판정

바로 코딩하면 안 되는 경우:

- 저장 구조를 건드릴 가능성이 있는 경우
- 백엔드/DB/계약 변경이 연쇄 영향을 만들 수 있는 경우
- 범위가 2개 이상 도메인으로 번지는 경우

### 4. 작은 change set

- 한 번에 하나의 change set만 수행한다.
- change set마다 검증을 붙인다.
- 큰 리라이트 대신 기존 저장소의 경계와 스크립트를 재사용한다.

### 5. 검증 루프

`requirements/validation-profiles.yaml`과 현재 packet 유형에 맞게 검증을 고른다.

기본 예시:

- 버그 수정: 단위 + 회귀 + 저장/조회 통합 경로
- UI 변경: 정적 UI 생성 + 관련 smoke
- 거버넌스 변경: validator + 산출물 smoke
- 시스템 변경: lint + contract + smoke + 필요한 경우 system/e2e

완료 선언 전에는 아래를 항상 남긴다.

- 검증 결과
- 남은 리스크
- 다음 작업 1개

## 현재 프로젝트 기준 세분화 실행 축

### Track 1. Canonical 상태 정렬

- 목표: 문서, 스크립트, UI가 모두 `root memory`를 같은 truth source로 사용
- 현재 상태: 대부분 완료, 일부 문서 drift 존재
- 우선 파일: `docs/harness/CONTINUOUS_PROMPT.md`, `docs/how-to/repeatable-cli-master-prompt.md`

### Track 2. Session Continuity

- 목표: 같은 프롬프트 반복 시 `current-wp`, `next-actions`, `wp-queue`를 읽고 자연스럽게 다음 단계로 이동
- 현재 상태: bootstrap 스크립트는 있음, 프롬프트 운영 규칙과 UI 노출을 더 맞춰야 함
- 우선 파일: `scripts/session_bootstrap.js`, `memory/next-actions.yaml`, `artifacts/index.html`

### Track 3. Master UI Flow

- 목표: 현재 lane, 다음 action, validation state, spiral cycle을 첫 화면에서 확인
- 현재 상태: 칸반/spiral은 존재, active focus와 validation strip 보강 필요
- 우선 파일: `scripts/generate-ui-home.js`

### Track 4. Verification Harness

- 목표: packet 유형별 최소 검증 묶음을 표준화
- 현재 상태: 개별 스크립트는 풍부하나 bugfix/UI/governance별 최소 세트 정의는 더 명확해질 여지
- 우선 파일: `requirements/validation-profiles.yaml`, `scripts/resolve_validation_profile.js`

### Track 5. SCM/Promotion Hardening

- 목표: 브랜치 제안, commit guard, promotion evidence를 하나의 operator 흐름으로 결합
- 현재 상태: 부품은 있음, 한 번에 이어지는 운영 경로를 더 직접적으로 보여줄 필요
- 우선 파일: `scripts/branch_bootstrap.js`, `scripts/verified_auto_commit_guard.js`, `scripts/operator_cockpit.js`

## 아키텍처 적용 원칙

사용자 요구의 방향은 반영하되, 저장소에 불리한 과설계는 강제하지 않는다.

- 캡슐화: 엔티티, 유스케이스, 포트 경계에서 적용
- 정보은닉: 계약과 runtime contract만 외부 공개
- 모듈화: 도메인, shared, infrastructure, scripts를 현재 구조 안에서 강화
- 결합도: 포트/어댑터 기준으로 낮춤
- 응집도: 기능적 응집을 최우선
- 상속: 진짜 subtype일 때만
- 다형성: 상속보다 포트/어댑터 다형성 우선
- 싱글턴: config, registry, telemetry 같은 process-wide coordinator에만
- 빌더: 복잡한 packet, fixture, multi-step 객체 구성에만
- 팩토리/템플릿 메서드: 반복 생성이나 고정 lifecycle이 있을 때만

## 보고 형식

```text
원인 분석:
변경 포인트:
검증 결과:
남은 리스크:
다음 작업:
```

이 형식은 짧게 유지한다. changelog처럼 길게 늘어놓지 않는다.
