# 학습 보고서: Stage A — productivity/task-tracking

> 일자: 2026-03-25 | 순번: #003 | 작성: AI Agent (reporter)
> Stage: A | 도메인: productivity/task-tracking
> 게이트 결과: PASS | 테스트: N/A (Stage A는 설계 전용)

---

## 기(起) — 배경과 문제 정의

task-tracking은 Workflow OS의 **기반 도메인(foundational domain)**이다. 가장 먼저 구현되어 Stage A~E 파이프라인의 기준 사례(reference implementation)가 되었다.

**이 도메인이 존재하는 이유:**

팀원이 작업을 생성하고, 상태를 전이하고, 담당자를 변경하는 과정에서 다음을 보장해야 한다:
1. 상태 전이가 허용된 경로만 따른다 (OPEN→IN_PROGRESS→DONE, OPEN→CANCELLED 등)
2. 완료/취소된 작업은 재활성화할 수 없다
3. 담당자 변경은 별도 이벤트로 추적된다 (상태 변경과 분리)

**아키타입**: `crud-entity` + `state_machine` 조합. 가장 단순한 아키타입이므로 파이프라인 검증에 이상적.

### 핵심 용어
| 용어 | 한글 | 의미 |
|------|------|------|
| Task | 작업 | 핵심 집합체. title, status, assignee, due_date |
| operationId | 작업 식별자 | openapi의 camelCase ID. capability ID (kebab-case)에서 자동 변환 |
| kebab_to_camel | 변환 규칙 | `create-task` → `createTask`. validate_contract_drift.py가 자동 검증 |

---

## 승(承) — 설계 결정

### capability.yaml — 5개 역량 + 3개 이벤트

```yaml
# domains/productivity/task-tracking/contract/capability.yaml
capabilities:
  - id: create-task      # POST /tasks
  - id: get-task         # GET  /tasks/{task_id}
  - id: list-tasks       # GET  /tasks
  - id: transition-task-status  # POST /tasks/{task_id}/status
  - id: reassign-task    # PATCH /tasks/{task_id}/assignee

events_emitted:
  - id: TaskCreated
  - id: TaskStatusChanged
  - id: TaskReassigned    # 상태 변경과 독립된 이벤트
```

`reassign-task`를 `transition-task-status`와 분리한 이유: 담당자 변경이 상태 전이와 동시에 일어날 때, 두 이벤트를 하나로 묶으면 이벤트 소싱 재생 시 인과관계가 모호해진다. 독립 이벤트로 분리하면 "누가 언제 담당자를 바꿨는가"를 명확히 추적 가능.

### openapi.yaml — kebab_to_camel 규칙

```yaml
# capability ID → openapi operationId 변환
create-task              → createTask
get-task                 → getTask
list-tasks               → listTasks
transition-task-status   → transitionTaskStatus
reassign-task            → reassignTask
```

이 변환 규칙을 `validate_contract_drift.py`의 `kebab_to_camel()` 함수가 자동 검증한다. capability.yaml에 새 역량을 추가하면 openapi에 동일한 operationId가 있는지 자동으로 확인된다.

### 라우팅 패턴 — controller 경로 매핑

```javascript
// TaskController.js가 반드시 구현해야 하는 경로 (계약에서 파생)
path === '/tasks'                           // list-tasks, create-task
path.match(/^\/tasks\/([^/]+)$/)           // get-task
path.match(/^\/tasks\/([^/]+)\/status$/)   // transition-task-status
path.match(/^\/tasks\/([^/]+)\/assignee$/) // reassign-task
```

`validate_contract_drift.py`가 `controller_source`에서 이 패턴 문자열의 존재를 검증한다. openapi 경로와 controller 구현이 항상 동기화된다.

---

## 전(轉) — 구현 패턴

### Level 1: 상태 기계 정의

```
OPEN ──→ IN_PROGRESS ──→ DONE
  ↓            ↓
CANCELLED   CANCELLED

허용된 전이:
  OPEN → IN_PROGRESS (작업 시작)
  OPEN → CANCELLED   (즉시 취소)
  IN_PROGRESS → DONE (완료)
  IN_PROGRESS → CANCELLED (중간 취소)

금지된 전이:
  DONE → * (완료 후 불변)
  CANCELLED → * (취소 후 불변)
```

### Level 2: 이벤트 스키마 구조

```json
// domains/productivity/task-tracking/contract/events.schema.json
{
  "definitions": {
    "TaskCreated": {
      "required": ["task_id", "title", "created_by"],
      "properties": { "task_id": {}, "title": {}, "created_by": {} }
    },
    "TaskStatusChanged": {
      "required": ["task_id", "from_status", "to_status"],
      "properties": { "from_status": {}, "to_status": {} }
    },
    "TaskReassigned": {
      "required": ["task_id", "from_assignee", "to_assignee"]
    }
  }
}
```

`TaskStatusChanged`에 `from_status`를 포함한 이유: 이벤트 재생 시 "어떤 전이였는가"를 이벤트만으로 알 수 있어야 한다. `to_status`만 있으면 재생 순서가 뒤바뀌었을 때 감지 불가.

### Level 3: contract drift 검증 체계

```
capability.yaml ──[operationId 일치]──→ openapi.yaml
       ↓                                       ↓
  events_emitted                       response schema props
       ↓                                       ↓
events.schema.json ←──[정의 존재]── validate_contract_drift.py
       ↓
ui-contract.yaml ──[capability_id 참조]── 자동 검증
```

---

## 결(結) — 학습된 것

1. **kebab_to_camel 변환이 계약 정합성의 핵심**: capability ID와 openapi operationId를 자동 매핑하면, 개발자가 수동으로 두 파일을 동기화할 필요가 없다. 변환 규칙 하나로 드리프트 감지가 자동화된다.

2. **`reassign`과 `transition`을 분리하면 이벤트 소싱이 명확해진다**: 단일 `update` API보다 목적별 분리 API가 이벤트 추적 가능성(traceability)을 높인다.

3. **task-tracking이 기준 사례(reference)**: 이후 billing, video 도메인이 이 도메인의 계약 구조(capability→openapi→events→ui-contract)를 따랐다. 새 도메인 추가 시 이 패턴을 복제하면 validate_contract_drift.py 검증을 바로 통과할 수 있다.

**다음 단계**: Stage D에서 23/23 테스트. 상태 기계 경계값(DONE에서 전이 시도) 테스트가 핵심.
