# Stage A 실행 방법

> **HOW** 중심 문서: 격리 모듈 생성 단계를 어떻게 실행하는가?

## 사전 조건

- `requirements/requirements.yaml`의 `stage` 필드가 `"A"`인지 확인한다.
- `requirements/glossary.yaml`에 핵심 용어가 정의되어 있는지 확인한다.

## 빠른 상태 확인

```bash
npm run stage:a
```

이 명령은 현재 저장소 상태를 읽는 dry-run executor다.
실제 파일을 변경하지 않고 Stage A 진입 가능 여부와 참조 문서를 JSON으로 출력한다.

## 실행 절차

### 1단계: 요구사항 검토

```bash
# Stage A 입력 계약 검증
npm run validate:requirements

# 현재 입력값 확인
cat requirements/requirements.yaml
```

검증 실패 시 Stage A를 진행하지 말고 `requirements/requirements.yaml`을 먼저 수정한다.

### 2단계: Bounded Context 확정

1. `requirements/glossary.yaml`에 이 모듈의 도메인 용어를 추가한다.
2. `requirements/domain-map.yaml`에 이 모듈의 위치를 등록한다.
3. `requirements/constraints.yaml`의 제약이 이 모듈에 어떻게 적용되는지 검토한다.

### 3단계: Public Contract 생성

모듈 디렉토리 아래에 `contract/` 폴더를 생성하고:
```
domains/[domain-id]/[context-id]/
├── contract/
│   ├── openapi.yaml        # HTTP API 계약
│   ├── events.schema.json  # 이벤트 계약
│   ├── ui-contract.yaml    # UI 계약
│   └── capability.yaml     # 기능 계약
```

**계약 작성 기준:**
- `capability.yaml` 먼저 작성 (도메인 기능 목록)
- `ui-contract.yaml`은 capability를 참조하여 작성
- `openapi.yaml`은 HTTP 전송 계층 명세
- `events.schema.json`은 발행/구독 이벤트 명세

### 4단계: 권한 및 불변조건 정의

`contract/capability.yaml`의 `permissions_required`와 `invariants`를 채운다.

### 5단계: Memory 저장

`memory/stageA/[module-id].yaml`을 생성한다. (templates/memory-stageA-template.yaml 참조)

### 6단계: 품질 게이트 확인

Stage A 완료 기준:
- [ ] glossary.yaml에 용어 등록 완료
- [ ] domain-map.yaml에 모듈 위치 등록 완료
- [ ] contract/ 폴더에 4개 계약 파일 존재
- [ ] capability.yaml에 최소 1개 capability 정의
- [ ] invariants 정의 완료
- [ ] memory/stageA/[module-id].yaml 저장 완료

## 재실행 조건

다음 중 하나라도 변경되면 Stage A를 재실행한다:
- bounded context 경계 변경
- 도메인 용어 변경
- 권한 모델 변경
- 불변조건 변경
- public contract 파일 변경

## 관련 문서

- docs/explanation/workflow-os-concept.md
- docs/reference/routing-rules.md
- templates/module-template/README.md
