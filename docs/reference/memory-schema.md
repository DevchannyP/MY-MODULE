# Memory 스키마 참조

> **WHAT** 중심 문서: memory 파일들의 구조와 역할

## Memory 디렉토리 구조

```
memory/
├── stageA/          # Stage A 산출물 (bounded context, contract 스냅샷)
├── stageB/          # Stage B 산출물 (composition, domain-map 스냅샷)
├── stageC/          # Stage C 산출물 (plugin registry, navigation 스냅샷)
└── project/
    ├── current-state.yaml    # 현재 저장소 전체 상태
    ├── unresolved-risks.yaml # 미해결 리스크 목록
    └── next-actions.yaml     # 다음 실행에서 해야 할 일
```

## current-state.yaml 스키마

```yaml
as_of: "YYYY-MM-DD"
stage_states:
  A: "NOT_STARTED | IN_PROGRESS | PASS | FAIL | BLOCKED"
  B: "..."
  C: "..."
  D: "..."
  E: "..."
last_completed_stage: "A"
active_modules: []
quality_gate_last_run: "YYYY-MM-DD"
quality_gate_result: "PASS | FAIL | NOT_RUN"
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

## 조합기와 마스터 UI의 Memory 읽기 원칙

조합기와 마스터 UI는 코드 내부를 읽기 전에 반드시:
1. `memory/project/current-state.yaml` 을 먼저 읽는다.
2. 해당 모듈의 `memory/stageA/`, `memory/stageB/`, `memory/stageC/` 를 읽는다.
3. 그 다음 `contract/` 파일들을 읽는다.
4. 마지막으로 코드를 읽는다.
