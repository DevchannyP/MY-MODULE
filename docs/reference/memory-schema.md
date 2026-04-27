# Memory 스키마 참조

> **WHAT** 중심 문서: root memory와 stage memory의 역할

## Memory 디렉토리 구조

```text
memory/
├── checkpoint.yaml         # 세션 종료 요약과 다음 세션 시작점
├── current-state.yaml      # 현재 작동/수동/문제 상태
├── current-wp.yaml         # 지금 선택된 Work Packet
├── next-actions.yaml       # 사람이 빠르게 보는 다음 순서
├── wp-queue.yaml           # Work Packet 큐와 우선순위
├── stageA/                 # Stage A 산출물
├── stageB/                 # Stage B 산출물
├── stageC/                 # Stage C 산출물
└── project/                # 레거시 프로젝트 상태 파일 (호환용)
```

root `memory/*.yaml`이 세션 handoff의 기본면이다.
`memory/project/*`는 아직 일부 기존 스크립트와 문서가 참조하는 레거시 호환 계층이다.

## checkpoint.yaml 스키마

```yaml
session_date: "YYYY-MM-DD"
wps_completed: []
wps_partial: []
wps_not_started: []
verification_summary:
  total_commands_run: 0
  passed: 0
  failed: 0
  skipped: 0
next_session:
  start_by_reading: []
  first_wp: "WP-YYYY-MM-DD-NN"
  context_needed: ""
```

## current-state.yaml 스키마

```yaml
as_of: "YYYY-MM-DD"
session_mode: "work-packet-cycle"
current_wp_queue: "memory/wp-queue.yaml"
last_completed_wp:
  id: "WP-YYYY-MM-DD-NN"
  completed_at: "YYYY-MM-DD"
  result: "PASS | PARTIAL | FAIL"
working_capabilities: []
placeholders_manual: []
known_issues: []
legacy_refs: {}
```

## current-wp.yaml 스키마

> **INV**: `as_of` 필드는 필수이며 `current-state.yaml`, `next-actions.yaml`과 동일한 날짜여야 한다.  
> `session_end.verify_memory_consistency()`가 이 불변식을 실행 시마다 검사한다.

```yaml
as_of: "YYYY-MM-DD"   # 필수 — 세 파일이 같은 날짜를 가져야 한다
id: "WP-YYYY-MM-DD-NN"
goal: "single sentence"
type: "policy | domain | shell | executor | governance"
stage: "A|B|C|D|E"
status: "pending | in_progress | completed | partial"
scope_in: []
scope_out: []
constraints: []
done_when: []
fail_if: []
rollback: ""
subtasks: []
validation: []
evidence: []
next_unlock: ""
contracts:
  input_contract: []
  structure_contract: []
  runtime_contract: []
  evidence_contract: []
```

## wp-queue.yaml 스키마

```yaml
queue_date: "YYYY-MM-DD"
epic: ""
capabilities:
  - id: "CAP-01"
    name: ""
    priority: 1
    work_packets:
      - id: "WP-YYYY-MM-DD-NN"
        goal: ""
        status: "pending | in_progress | done | partial"
```

## next-actions.yaml 스키마

```yaml
as_of: "YYYY-MM-DD"
selection_policy: ""
next_wp: "WP-YYYY-MM-DD-NN"
queue:
  - id: "WP-YYYY-MM-DD-NN"
    priority: 1
    goal: ""
    blocked_by: []
```

## Stage A Memory 스키마

`memory/stageA/[module-id].yaml` 형식으로 저장.

```yaml
module_id: ""
bounded_context: ""
ubiquitous_language: []
invariants: []
permissions: []
contracts:
  http: ""
  events: ""
  ui: ""
  capability: ""
completed_at: ""
gate_result: "PASS | FAIL"
```

## Stage B Memory 스키마

`memory/stageB/[module-id]-composition.yaml` 형식으로 저장.

```yaml
module_id: ""
depends_on_contracts: []
provides_contracts: []
screen_composition: []
shared_libs: []
composition_policy_applied: ""
completed_at: ""
gate_result: "PASS | FAIL"
```

## Stage C Memory 스키마

`memory/stageC/[module-id]-plugin.yaml` 형식으로 저장.

```yaml
module_id: ""
plugin_id: ""
navigation_group: ""
entry_point: ""
feature_flags: {}
rollout_policy: ""
registered_at: ""
gate_result: "PASS | FAIL"
```

## Memory Triad 원자 갱신 규칙 (WP-HO-013)

세 파일(`current-state.yaml`, `current-wp.yaml`, `next-actions.yaml`)은 **항상 동시에** 갱신해야 한다.

### 갱신 순서 (반드시 이 순서)

1. 세 파일을 모두 메모리에 읽는다.
2. 같은 `as_of` 날짜를 세 파일에 적용한다.
3. 각 파일을 `.yaml.tmp` 임시 파일에 먼저 쓴다.
4. 임시 파일을 원본 경로로 rename한다 (OS 레벨 원자 보장).

### 자동 검증

`session_end.verify_memory_consistency()` 를 호출하면 세 파일의 불변식을 검사한다:
- 모든 파일에 `as_of` 필드가 존재하는가
- 세 파일의 `as_of` 값이 동일한가
- `current-wp.id` ≠ `current-state.last_completed_wp.id` (활성 ≠ 완료)

`generate_apply_checkpoint.py`는 이 검사를 pre-flight으로 실행하며, 실패 시 exit(1)한다.

### 프로그래매틱 갱신

```python
from scripts.session_end import atomic_write_memory_triad

atomic_write_memory_triad(
    active_wp_id="WP-HO-014",
    last_completed_wp_id="WP-HO-013",
    last_completed_result="PASS",
    next_wp="WP-HO-014",
)
```

## 조합기와 마스터 UI의 Memory 읽기 원칙

조합기와 마스터 UI는 코드 내부를 읽기 전에 반드시:
1. root `memory/current-state.yaml` 을 먼저 읽는다.
2. 필요 시 `memory/project/current-state.yaml` 으로 레거시 상세를 보완한다.
3. 해당 모듈의 `memory/stageA/`, `memory/stageB/`, `memory/stageC/` 를 읽는다.
4. 그 다음 `contract/` 파일들을 읽는다.
5. 마지막으로 코드를 읽는다.
