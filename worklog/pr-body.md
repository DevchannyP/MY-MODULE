# PR: chore/core-git-governance-activation → main

> 생성: 2026-04-18 | 브랜치: `chore/core-git-governance-activation`

## Summary

Workflow OS Spiral 19 완료 + Core Git Governance 활성화 브랜치.
3개 도메인(task-tracking, billing, video) + System OS 운영 포털 + AI Harness vNext의
계약 드리프트 검증 체계를 전면 구축하고, 품질 게이트를 7개 검증기로 확장했다.

주요 변경 축:
- **계약 드리프트 검증 확장**: 3 도메인 → 7 검증기 (ui-shell, harness intake, system-api 추가)
- **Harness Eval Phase 2**: Operate 모드 케이스 + zone_rule enum + packet_type 커버리지 게이트
- **거버넌스 매트릭스**: Shell 계약 4종 가시성 + Drift 검증 커버리지 컬럼
- **Python 단위 테스트**: 드리프트 검증기 7/7 모두 31개 케이스로 보호
- **OpenAPI 계약 선언**: StageRunRuntimeObservability + X-Stage-Run-Report-Saved 헤더
- **운영 문서**: DB 설정 13개 변수 + AI 모델 변수 문서화

## Gate Status

| Gate | Status |
|------|--------|
| JS Tests | ✅ 732/732 PASS |
| Python Unit Tests | ✅ 31/31 PASS |
| ESLint | ✅ 0 errors |
| Contract Drift | ✅ PASS (7 validators) |
| Contract Matrix | ✅ 3 domains + 4 shell contracts all ✅ |
| Harness Evals | ✅ PASS (10 golden, 5 modes, 5 packet types) |

## Key Changes by Zone

### L2 Contract/Generation
- `contracts/ui-shell/openapi.yaml` — `StageRunRuntimeObservability` 스키마 + `X-Stage-Run-Report-Saved` 헤더 선언
- `contracts/harness/intake.schema.json` — golden eval records와의 검증 연결 (Draft 2020-12)
- `evals/cases/operate.jsonl` — Operate 모드 golden case 2개 추가

### L5 Quality Assurance
- `scripts/validate_contract_drift.py` — 4개 새 검증기 추가:
  - `validate_ui_shell_contract()` — StageRunRuntimeObservability 12개 구조 체크
  - `validate_harness_contracts()` — intake schema vs 10개 golden record 실검증
  - `validate_system_api_contract()` — capability↔openapi 양방향 + events coverage
- `scripts/test_validate_contract_drift.py` — 31개 Python unittest (7/7 검증기 커버)
- `scripts/run-harness-evals.js` — zone_rule enum, false_pass_forbidden, packet_type 커버리지 게이트
- `src/tests/smoke/harnessEvals.smoke.test.js` — 5개 assertion 강화

### L6 Operations/Governance
- `scripts/validate-contracts.js` — Shell 계약 섹션 추가 (ui-shell/harness/system-api/events)
- `worklog/contract-matrix.md` — Drift Validated 컬럼 + Shell 계약 테이블
- `.env.example` — DB 설정 + AI 모델 변수 문서화
- `docs/how-to/local-server-startup.md` — DB 어댑터 선택 전체 문서

### Earlier Spiral 19 Work (pre-session)
- AI Harness vNext: live provider chain (OpenAI Responses API), harness:check E2E command
- System OS 운영 포털: `/api/v1/system/*` 9개 엔드포인트
- Stage Run 관측성: save failure tracking, correlation_id, operator guidance
- Mindmap: stage trace actions, control center 브라우저 상호작용
- DB 어댑터: SQLite/PostgreSQL/InMemory 3종 라우팅
- Feature flag metadata: released/internal grouping + env:status JSON mode

## Test Plan

- [x] `npm test` → 732/732 PASS
- [x] `npm run test:contract` → 31 Python unit tests + contract drift PASS
- [x] `npm run lint` → 0 ESLint errors
- [x] `node scripts/validate-contracts.js` → 3 domains + 4 shell contracts all ✅
- [x] `node scripts/run-harness-evals.js` → PASS (10 golden, 5 modes, 5 packet types)
- [x] Negative-path: 31개 unit test가 검증기 silent-failure를 방지함

## Rollback Plan

각 변경은 독립 커밋으로 격리되어 있음:
- 계약 드리프트 검증 제거: `git revert ad39d15 f3c58ff ad70493`
- Harness eval gate 강화 제거: `git revert b9c67ee 1ac7d73`
- 거버넌스 매트릭스 원복: `git revert 03b5107`
- Python 단위 테스트 제거: `git revert f497aae 759e2a1`

모든 변경은 기존 기능을 수정하지 않고 검증/거버넌스 레이어만 추가함 — 런타임 롤백 리스크 낮음.

## Contract Matrix (현재 상태)

| Contract | Files | Drift Validated |
|----------|-------|-----------------|
| ui-shell | ✅ | ✅ |
| harness | ✅ | ✅ |
| system-api | ✅ | ✅ |
| events | ✅ | ✅ |

| Domain | OpenAPI | Events | UI | Capability | Status |
|--------|---------|--------|----|------------|--------|
| billing | ✅ | ✅ | ✅ | ✅ | PASS |
| productivity/task-tracking | ✅ | ✅ | ✅ | ✅ | PASS |
| video | ✅ | ✅ | ✅ | ✅ | PASS |

---
🤖 Generated with [Claude Code](https://claude.ai/claude-code)
