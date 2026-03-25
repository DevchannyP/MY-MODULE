# 학습 보고서: Stage A — productivity/task-tracking

> 일자: 2026-03-25 | 순번: #003 | 작성: AI Agent (reporter)
> Stage: A | 도메인: productivity/task-tracking
> 게이트 결과: PASS | 테스트: N/A (Stage A는 설계 단계)

---

## 기(起) — 배경과 문제 정의

task-tracking은 Workflow OS의 **기반 도메인(foundational domain)**이다. 3개 이벤트를 발행하는 upstream(상류) 도메인으로서, 이 이벤트들이 없으면 알림(notification), 통계(analytics), 리포팅(reporting) 도메인은 데이터 기반을 잃는다.

**이 도메인이 해결하는 핵심 문제:**

1. 상태 전이가 허용된 경로만 따른다 (`PENDING → IN_PROGRESS → DONE / CANCELLED` 단방향)
2. 완료/취소된 작업은 재활성화할 수 없다 — 감사 추적(audit trail) 신뢰성 보장
3. 담당자 변경은 별도 이벤트로 추적된다 — 상태 변경과 분리

**아키타입**: `crud-entity` + `state_machine` 조합. 가장 단순한 아키타입이므로 파이프라인의 기준 사례(reference implementation)가 되었다.

### 핵심 용어
| 용어 | 한글 | 의미 |
|------|------|------|
| capability | 기능 단위 | 도메인이 외부에 공개하는 단일 행동. command(상태 변경) 또는 query(조회)로 구분 |
| invariant | 불변식 | 어떤 상황에서도 반드시 참이어야 하는 도메인 규칙 |
| state machine | 상태 기계 | 허용된 상태와 전이 경로를 정의한 모델. 역전이(rollback) 금지가 핵심 |
| operationId | 연산 식별자 | OpenAPI의 camelCase 엔드포인트 이름. capability ID (kebab-case)에서 자동 변환 |
| ProblemDetails | 오류 응답 형식 | RFC 7807 표준을 따르는 구조화된 HTTP 오류 응답 스키마 |
| upstream domain | 상류 도메인 | 이벤트를 발행하여 다른 도메인이 소비하는, 의존 방향의 원점에 있는 도메인 |

---

## 승(承) — 설계 결정

### capability.yaml — 5개 역량 + 3개 이벤트

| capability ID | 타입 | 설명 | 권한 |
|---|---|---|---|
| `create-task` | command | 작업 생성, PENDING 상태 고정 | `task:write` |
| `get-task` | query | task_id로 단건 조회 | `task:read` |
| `list-tasks` | query | 필터 + 페이지네이션 목록 조회 | `task:read` |
| `transition-task-status` | command | 상태 전이 (INV002 수호자) | `task:write` |
| `reassign-task` | command | 담당자 교체, DONE 시 차단 | `task:write` |

command와 query를 명시적으로 구분한 이유: 향후 CQRS(Command Query Responsibility Segregation) 패턴 적용 시 계약 레벨의 힌트로 활용.

### 불변식(Invariant) 목록

| ID | 내용 | 수호 capability |
|---|---|---|
| INV001 | 담당자 없는 작업 생성 불가 | `create-task`, `reassign-task` |
| INV002 | DONE 또는 CANCELLED → IN_PROGRESS 역전이 불가 | `transition-task-status` |
| INV003 | due_date는 오늘 이상이어야 함 | `create-task` |
| INV004 | DONE 상태 작업은 담당자 변경 불가 | `reassign-task` |

INV004는 초기 설계에 없었으나 Stage E 적대적 검증(adversarial test) 중 발견되어 소급 반영되었다. **교훈**: 계약 단계에서 적대적 사고를 도입하면 엣지 케이스를 조기에 포착할 수 있다.

### 상태 기계 전이 규칙

```
PENDING ──────────────────────────────┐
   │                                  │
   ▼                                  ▼
IN_PROGRESS ──────────────────> CANCELLED
   │
   ▼
 DONE

금지된 전이:
  DONE       → IN_PROGRESS  (INV002 위반)
  CANCELLED  → IN_PROGRESS  (INV002 위반)
  DONE       → CANCELLED    (INV002 위반)
```

역전이 금지는 단순한 비즈니스 규칙이 아니라 감사 추적(audit trail)의 신뢰성을 보장하는 보안적 요건이다.

### openapi.yaml — kebab_to_camel 변환 규칙

```yaml
# capability ID → openapi operationId 변환 (validate_contract_drift.py가 자동 검증)
create-task              → createTask
get-task                 → getTask
list-tasks               → listTasks
transition-task-status   → transitionTaskStatus
reassign-task            → reassignTask
```

이 변환 규칙은 `validate_contract_drift.py`의 `kebab_to_camel()` 함수가 자동 검증한다.

---

## 전(轉) — 핵심 계약 스니펫 (기초 → 심화)

### Level 1: 기초 — capability.yaml로 기능 목록 파악하기

```yaml
# domains/productivity/task-tracking/contract/capability.yaml (발췌)
- id: "create-task"
  type: "command"
  input_schema:
    required: [title, assignee_id]
    properties:
      title:       { type: string, minLength: 1, maxLength: 200 }
      assignee_id: { type: string }
      due_date:    { type: string, format: date }
  output_schema:
    properties:
      status: { type: string, enum: [PENDING] }  # 생성 직후 상태는 항상 PENDING
  postconditions:
    - "작업이 PENDING 상태로 생성된다"
    - "TaskCreated 이벤트가 발행된다"
  invariants: [INV001, INV003]
```

포인트: `output_schema`의 `status` 필드가 `enum: [PENDING]` 단일값으로 고정. 구현체가 실수로 `IN_PROGRESS` 상태로 작업을 만들어도 계약 검증기가 이를 거부한다.

### Level 2: 중급 — openapi.yaml 상태 전이 엔드포인트

```yaml
# PATCH /tasks/{task_id}/status — "상태 속성만 변경"임을 HTTP 메서드로 명시
/tasks/{task_id}/status:
  patch:
    operationId: "transitionTaskStatus"  # kebab "transition-task-status"의 camelCase 변환
    requestBody:
      content:
        application/json:
          schema:
            required: [new_status]
            properties:
              new_status: { type: string, enum: [IN_PROGRESS, DONE, CANCELLED] }
              # PENDING은 없다 — 생성 시에만 PENDING이 된다
    responses:
      "200": { description: "상태 전이 성공" }
      "400": { $ref: "#/components/responses/BadRequest" }  # INV002 위반 시
```

`new_status`의 enum에 `PENDING`이 없는 것이 핵심 — 이미 생성된 작업을 다시 PENDING으로 되돌리는 것을 계약이 막는다.

### Level 3: 심화 — events.schema.json old_status의 enum 비대칭

```json
// 방어 심층화(defense in depth) 패턴: 비즈니스 규칙을 타입에 인코딩
"TaskStatusChanged": {
  "properties": {
    "payload": {
      "required": ["task_id", "old_status", "new_status"],
      "properties": {
        "old_status": {
          "enum": ["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"]  // 4개
        },
        "new_status": {
          "enum": ["IN_PROGRESS", "DONE", "CANCELLED"]  // 3개 — PENDING 없음
        }
      }
    }
  }
}
```

`old_status`에는 `PENDING`이 있지만 `new_status`에는 없다. capability.yaml INV002, openapi.yaml의 `TransitionStatusRequest`, events.schema.json 세 계층이 동일한 역전이 금지 규칙을 각자의 방법으로 강제한다.

`old_status`를 payload에 포함한 이유: 소비자 도메인이 "PENDING→IN_PROGRESS 전이 시에만 알림 발송"처럼 전이 유형에 따라 차등 처리를 해야 하기 때문. 이벤트는 한 번 발행되면 수정할 수 없으므로 예측 가능한 컨텍스트는 항상 포함해야 한다.

---

## 결(結) — 학습된 것

1. **kebab_to_camel 변환이 계약 정합성의 핵심**: capability ID와 openapi operationId를 자동 매핑하면 드리프트 감지가 자동화된다. 규칙 하나로 두 파일의 동기화를 보장.

2. **`reassign`과 `transition`을 분리하면 이벤트 소싱이 명확해진다**: 단일 `update` API보다 목적별 분리 API가 이벤트 추적 가능성(traceability)을 높인다.

3. **enum 비대칭은 비즈니스 규칙을 타입 시스템으로 인코딩하는 방법**: `old_status`와 `new_status`의 enum 차이가 스키마 레벨에서 역전이 불가 원칙을 강제한다. 런타임 검사 코드가 아닌 타입에 녹이면 검증 비용이 제로에 수렴한다.

4. **task-tracking이 기준 사례(reference)**: billing, video가 이 계약 구조(capability→openapi→events→ui-contract)를 따랐다. 새 도메인 추가 시 이 패턴을 복제하면 validate_contract_drift.py 검증을 바로 통과할 수 있다.

**다음 단계**: Stage D에서 23/23 테스트. 상태 기계 역전이 금지(INV002) 경계값 테스트가 핵심.
