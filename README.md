# Workflow OS - my-module

**목적**: requirements/requirements.yaml 하나만 교체하면 격리 모듈 생성→도메인 조합→마스터 UI 편입→품질 게이트→적대적 검증의 전체 사이클이 반복 가능한 저장소 운영체제.

---

## 빠른 시작

### 1. 요구사항 입력

```yaml
# requirements/requirements.yaml
module:
  id: "your-module-id"
  name: "도메인 언어로 된 이름"
  domain: "your-domain"
  bounded_context: "your-context"
stage: "A"
```

### 2. Stage A 실행

docs/how-to/run-stage-a.md 참조

### 3. 다음 Stage 순서대로 진행

A → B → C → D → (필요 시 E)

---

## 저장소 구조

```
my-module/
├── requirements/          # 요구사항 (이것만 교체하면 전체 재실행 가능)
│   ├── requirements.yaml  # ← 주 설정 파일
│   ├── glossary.yaml      # 도메인 용어 사전
│   ├── domain-map.yaml    # 도메인 구성도
│   ├── constraints.yaml   # 아키텍처 제약
│   └── nfr.yaml           # 비기능 요구사항
├── docs/
│   ├── explanation/       # WHY 중심 개념 문서
│   ├── reference/         # WHAT 중심 참조 문서
│   ├── how-to/            # HOW 중심 절차 문서
│   ├── tutorial/          # 학습용 예제/퀴즈
│   └── adr/               # 아키텍처 결정 기록
├── templates/             # 모듈/계약/플러그인 템플릿
├── domains/               # 도메인 모듈 (Stage A 이후 생성)
├── master-shell/          # 마스터 UI 포털 설정
│   ├── plugin-registry/   # 등록된 플러그인 목록
│   ├── navigation/        # 도메인 포털 네비게이션
│   ├── feature-flags/     # 기능 플래그
│   ├── observability/     # 관측성 설정
│   └── catalog/           # 도메인 카탈로그
├── memory/                # Stage별 산출물 스냅샷
│   ├── stageA/
│   ├── stageB/
│   ├── stageC/
│   └── project/           # 현재 상태, 리스크, 다음 작업
└── worklog/               # 실행 로그, 리뷰, 수정, 릴리즈 노트
```

## 핵심 규칙 (constraints.yaml 참조)

| 규칙 | 설명 |
|------|------|
| C001 | 모듈 간 직접 코드 참조 금지 |
| C002 | 도메인 코어는 UI/DB/프레임워크 모름 |
| C003 | 각 모듈은 최소 1개 이상의 public contract 필수 |
| C004 | 구조 판단은 ADR 없이 지나가지 않음 |
| C005 | 품질 게이트 FAIL이면 완료 선언 불가 |

## Stage 진입 조건

| Stage | 트리거 |
|-------|--------|
| A | bounded context / 용어 / 권한 / 불변조건 / contract 변경 |
| B | stageA memory / domain-map / 화면 구성 / composition 변경 |
| C | plugin registry / navigation / feature flag / rollout 변경 |
| D | 구현 완료 또는 수정 후 검증 필요 |
| E | 반복 실패 / 수동 개입 증가 / 구조 단순화 필요 |

## 현재 상태

**phase**: skeleton-initialized (2026-03-17)

Stage A~E 모두 NOT_STARTED. requirements/requirements.yaml에 실제 모듈 정보를 입력하고 Stage A를 실행하면 된다.

→ memory/project/next-actions.yaml 참조

## 관련 문서

- **개념 이해**: docs/explanation/workflow-os-concept.md
- **라우팅 규칙**: docs/reference/routing-rules.md
- **Stage A 실행**: docs/how-to/run-stage-a.md
- **현재 상태**: memory/project/current-state.yaml
- **다음 작업**: memory/project/next-actions.yaml
- **미해결 리스크**: memory/project/unresolved-risks.yaml
