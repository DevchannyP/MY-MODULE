# MPO v1.0 릴리즈 노트

**릴리즈 날짜**: 2026-04-21  
**브랜치**: `chore/core-git-governance-activation`  
**커밋 범위**: `6994204` → `5787ea7`  
**기반 문서**: `docs/harness/MPO-master-plan-v1.0.md`

---

## 요약

MPO v1.0은 Workflow OS 프롬프트 하네스를 **닫힌 12모듈 파이프라인**으로 재구성한다.
사용자는 목표 한 줄을 입력하고, 시스템은 계획 생성 → 승인 → 실행 → 검증 → 메모리 동기화를 자동 수행한다.

---

## 변경 요약

### 신규 파일 (Phase 0~5)

| 파일 | 모듈 | 역할 |
|------|------|------|
| `contracts/harness/raw-intent.schema.json` | M01→M02 | 원시 의도 계약 |
| `contracts/harness/intake.schema.json` | M02 | 11-field Intake Packet 스키마 |
| `contracts/harness/wp-dag.schema.json` | M03-M08 | WP-DAG 점진 강화 계약 |
| `contracts/harness/output.schema.json` | M09-M10 | 실행 결과 계약 |
| `contracts/harness/completion-report.schema.json` | M10 | Truthfulness gate 의미 검증 |
| `contracts/harness/context-sources.yaml` | M05 | 4계층 소스 분류 매니페스트 |
| `contracts/harness/isolation-rules.yaml` | M04 | 도메인별 경계 규칙 |
| `contracts/harness/decomposer-prompt.yaml` | M03 | 분해 프롬프트 템플릿 (few-shot 포함) |
| `scripts/intake-normalizer.js` | M02 | 규칙 기반 11-field 분류 |
| `scripts/goal-decomposer.js` | M03 | 키워드 기반 WP-DAG 생성 |
| `scripts/isolation-boundary.js` | M04 | isolation-rules 기반 경계 할당 |
| `scripts/build-context-envelope.js` | M05 | 최소 컨텍스트 봉투 계산 |
| `scripts/allocate-token-budget.js` | M06 | `min(ctx×1.5+reserve, cap)` |
| `scripts/validate-completion-report.js` | M10 | Truthfulness gate 7종 검증 |
| `scripts/wp-complete.js` | M11 | 6-step 원자적 메모리 트랜잭션 + git commit |
| `scripts/check-failure-patterns.js` | Loop 3 | 3회 실패 → ADR 초안 + remediation WP |
| `scripts/mpo-pipeline.js` | M09 | 전체 파이프라인 오케스트레이터 |
| `scripts/harness-perf-metrics.js` | WP-MPO-029 | Tier별 성능 메트릭 집계 |
| `scripts/harness-dashboard.js` | WP-MPO-030 | 6 KPI 대시보드 |
| `src/infrastructure/mpo/ContractValidator.js` | — | CONTRACT-INV-01/02 런타임 강제 |
| `src/infrastructure/mpo/ModuleRegistry.js` | — | CONTRACT-INV-03 파이프라인 연결 |
| `src/server/routes/mpo.js` | M01 | `/api/v1/mpo/plan` + approve + session GET |
| `src/server/routes/events.js` | M12 | SSE EventBus 브로드캐스트 |
| `src/server/routes/harness.js` | — | harness surface 분리 (WP-MPO-032) |

### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/server/createServer.js` | harness 인라인 핸들러 → `routes/harness.js`로 분리 |
| `src/infrastructure/HarnessRuntimeRouter.js` | M07 확장: risk/trust/evidence/interactive 2D 매트릭스 |
| `src/infrastructure/ai/HarnessProviderAdapter.js` | output schema 런타임 강제 + NullProvider fallback |
| `artifacts/index.html` | MPO 패널 + SSE EventSource 클라이언트 |

---

## 5대 자동화 루프 상태

| 루프 | 구현 파일 | 상태 |
|------|-----------|------|
| Loop 1: 저위험 자동 승인 | `mpo-pipeline.js` (approvalState) | ✅ |
| Loop 2: 자동 재계획 | `mpo-pipeline.js` (createAutoReplannedPacket) | ✅ |
| Loop 3: 실패 에스컬레이션 | `check-failure-patterns.js` | ✅ |
| Loop 4: Mode Router 학습 | `updateRoutingLearningSnapshot()` + `mpo-routing-learning.json` | ✅ 데이터 수집 |
| Loop 5: 메모리 동기화 | `wp-complete.js` (writeAtomic 6-step) | ✅ |

---

## 검증 결과 (릴리즈 기준)

| 항목 | 결과 |
|------|------|
| 전체 테스트 | **791/791 PASS** |
| ESLint | **0 errors** |
| CONTRACT-INV-01/02 | 런타임 강제 확인 |
| Boundary enforcement | M09 즉시 거부 + M10 재검증 |
| Truthfulness gate | evidence 파일 존재 + PASS 주장 검증 |
| E2E (대표 시나리오) | 4 WP auto-approved, 4/4 PASS, 재계획 없음 |
| 보안 eval | V1~V5 5종 PASS |
| 성능 대시보드 | 6/6 KPI PASS (avg token 2k, gate 100%, violation 0%) |

---

## 알려진 제약

| 항목 | 상태 | 해결 경로 |
|------|------|-----------|
| LLM provider 미연결 | `[확인 필요]` | `HarnessProviderAdapter`에 OpenAI tier 설정 후 활성화 |
| M03 LLM tier | 현재 keyword-based | 실 API 연결 후 standard tier로 전환 |
| Loop 4 weight 반영 | 데이터 수집 단계 | WP-MPO-026 (향후) |

---

## 다음 단계

1. `gh auth login` 후 PR#1 CI 확인 → 머지
2. Spiral 18 설계 (PostgreSQL Phase 2)
3. Loop 4 실제 tier weighting 반영 (WP-MPO-026)
4. 실 LLM provider 연결 (KI-HARNESS-001 해소)
