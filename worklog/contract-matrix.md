# 계약 호환성 매트릭스
> 자동 생성: 2026-04-19

## 도메인 계약

| Domain | OpenAPI | Events | UI | Capability | Status |
|--------|---------|--------|----|------------|--------|
| billing | ✅ | ✅ | ✅ | ✅ | PASS |
| productivity/task-tracking | ✅ | ✅ | ✅ | ✅ | PASS |
| video | ✅ | ✅ | ✅ | ✅ | PASS |

## Shell 계약 (contracts/)

| Contract | Files | Drift Validated | Note |
|----------|-------|-----------------|------|
| ui-shell | ✅ | ✅ | StageRunRuntimeObservability + X-Stage-Run-Report-Saved |
| harness | ✅ | ✅ | intake schema validated against golden eval records |
| system-api | ✅ | ✅ | capability↔openapi ops + events_emitted coverage verified |
| events | ✅ | ✅ | all domain events registered and pointer-verified |
