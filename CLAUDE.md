# CLAUDE.md — Workflow OS 에이전트 프로토콜 v3.0

## 역할
Workflow OS 설계자 + 실행 오케스트레이터 + 자기개선 학습 에이전트.

---

## 핵심 원칙 (10가지 — 변경 금지)
1. 계약 전용 연결: 도메인 간 직접 src/ import 금지. contracts/만 참조하라.
2. Clean Architecture: 의존성은 바깥→안쪽만. 도메인 코어에서 외부 프레임워크 import 금지.
3. 품질 게이트 절대주의: FAIL이면 완료 선언하지 마라.
4. 메모리 우선: 코드보다 memory/L0-hot/를 먼저 읽어라.
5. ADR 필수: 구조적 판단 변경 시 반드시 ADR을 생성하라.
6. 불확실성 명시: 확신이 없으면 [확인 필요] 태그를 붙이고 검증 절차를 명시하라.
7. 리스크 비례 방어: risk_level에 비례해 보안·감사를 자동 강화하라.
8. 불변 패턴: 엔티티 상태를 직접 수정하지 마라. 새 인스턴스를 반환하라.
9. 증거 기반 리뷰: 재현 절차 없는 지적을 "추정"으로 분류하라.
10. 모놀리스 우선: 계약 안정 후에만 도메인을 분리하라.

---

## 파일 읽기 순서 (매 세션 시작 시 필수, 이 순서를 지켜라)
1. `memory/L0-hot/current-state.yaml`
2. `memory/L0-hot/next-actions.yaml`
3. `memory/L0-hot/reflection-log.yaml` — 이전 실패 교훈
4. `memory/L0-hot/failure-patterns.yaml` — 반복 실패 패턴
5. `memory/project/lessons-learned.yaml` — 교훈 축적소
6. `memory/reflections/[도메인]-*.yaml` — 해당 도메인 리플렉션 (있으면)
7. `memory/L1-warm/stageA/[도메인].yaml` — 해당 도메인 Stage A 스냅샷
8. `requirements/[도메인].yaml`
9. `requirements/constraints.yaml`

---

## 단일 키워드 실행표
| 키워드 | 행동 | Thinking | 자동 |
|--------|------|----------|------|
| `계속` | next-actions priority 1 실행 | normal | YES |
| `A [도메인]` | Stage A~E 전체 실행 | ultrathink(A,B,E) / normal(C,D) | YES |
| `D [도메인]` | Stage D만 실행 | normal | YES |
| `E [도메인]` | Stage E + B_review | ultrathink | YES |
| `검토` | 현재 상태 보고 | normal | NO |
| `게이트` | 전 도메인 품질 게이트 | normal | YES |
| `B_review [도메인]` | 적대적 리뷰만 | ultrathink | YES |
| `보고서 [도메인]` | 학습보고서 생성 | normal | YES |
| `A *` | 전 도메인 병렬 실행 (orchestrate.js 계획) | ultrathink | YES |
| `D *` | 전 도메인 Stage D 병렬 | normal | YES |
| `게이트 *` | 전 도메인 품질 게이트 | normal | YES |
| `건강` | 건강도 대시보드 (health-dashboard.js) | normal | NO |
| `그래프` | 의존성 다이어그램 생성 | normal | NO |
| `카탈로그` | 도메인 카탈로그 사이트 생성 | normal | YES |
| `마이그레이션 export [도메인]` | 도메인 추출 | normal | NO (확인) |
| `마이그레이션 import [경로]` | 도메인 흡수 | normal | NO (확인) |
| `마이그레이션 detach [도메인]` | 도메인 분리 | normal | NO (확인) |

---

## 서브에이전트 위임 규칙
- Stage A, B → `architect` 에이전트
- Stage D → `implementer` 에이전트
- Stage E → `adversary` 에이전트
- B_review → `reviewer` 에이전트 (Cross-Model: opus)
- 보고서 → `reporter` 에이전트
- 모든 Stage 완료 보고 → `observer` 에이전트 독립 검증

---

## 자율 실행 vs 멈춤

**자동 진행**:
- 품질 게이트 PASS → 다음 Stage
- 테스트 실패 → 수정 후 재실행 (최대 3회)
- ESLint → 즉시 수정
- P0/P1 갭 발견 → 즉시 수정
- 피트니스 검사, 메트릭 기록, 보고서 생성 → 자동 수행
- Feature Flag: Stage D PASS → internal(5%), Stage E PASS → beta(20%), B_review PASS → full(100%)

**멈추고 보고**:
- requirements/ 구조 변경
- 기존 코드 삭제
- 보안 정책 변경
- 3회 연속 동일 실패 미해결
- 외부 연동 설정
- INV 충돌 → ADR 필요

---

## Reflexion Loop (자기반성)
1. 테스트 실패 / 게이트 FAIL 즉시 발동
2. `memory/reflections/[domain]-[stage]-[attempt].yaml` 생성:
   - what_failed, what_went_wrong, root_cause_category, next_strategy
3. 재시도 전 해당 도메인의 모든 리플렉션 읽기
4. 성공 시 `memory/project/lessons-learned.yaml`에 교훈 추가
5. 동일 category 3회 반복 → ADR 필요 경고
6. `memory/L0-hot/failure-patterns.yaml`에 패턴 등록

---

## Chain-of-Verification (CoVe)
Stage D 게이트 PASS 후:
1. "이 테스트가 정말 INV를 검증하는가?" 자문
2. "PASS해도 위반 가능한 입력이 존재하는가?" 탐색
3. 불일치 → 테스트 보완 → 재검증
4. 결과 기록: `memory/stageD/[domain]-cove.yaml`

---

## Dual-Observer 검증
모든 Stage 완료 보고 후 observer 에이전트가 독립 검증:
- 파일 실제 존재 확인
- 테스트 수 일치 확인
- ESLint 직접 재실행
- MISMATCH 0건이어야 최종 PASS
- 불일치 시 `memory/project/observer-alert.yaml` 생성

---

## 아키타입 감지 (Stage A 진입 시)
requirements.yaml에서 자동 감지:
- `financial_risk` 또는 `double_entry` → `financial-ledger` 아키타입 로드
- `state_machines.requires_approval` → `approval-workflow` 아키타입 로드
- 그 외 → `crud-entity` 아키타입 로드
- 아키타입의 preset_invariants를 requirements.yaml invariants에 병합 (충돌 시 사용자 INV 우선)

---

## 병렬 실행 규칙
복수 도메인 실행(`A *`, `D *`, `게이트 *`) 시:
1. `node scripts/orchestrate.js`로 실행 계획 수립
2. Stage A/C/D/E: 독립 도메인 병렬 가능
3. Stage B: 반드시 순차 (전체 도메인 충돌 검사)
4. 의존 도메인은 선행 도메인 해당 Stage PASS 후 실행

---

## 커밋 규칙 (Conventional Commits)
매 Stage 완료 시 반드시:

| Stage | 타입 | scope | 예시 |
|-------|------|-------|------|
| A | feat | {domain}-spec | `feat(order-spec): 4종 계약 + INV 7개 생성` |
| B | chore | {domain}-composition | `chore(order-composition): 도메인 조합 완료` |
| C | chore | master-shell | `chore(master-shell): order 플러그인 등록` |
| D | test | {domain} | `test(order): Stage D PASS — 23/23 테스트` |
| E | test | {domain}-adversarial | `test(order-adversarial): 7벡터 적대적 테스트` |
| 게이트 수정 | fix | {domain} | `fix(order): INV-003 경계값 테스트 수정` |
| 보고서 | report | {domain} | `report(order): 학습보고서 Stage D` |
| ADR | docs | adr-{N} | `docs(adr-001): 마이그레이션 전략` |

커밋 body:
```
Gate: PASS
Tests: 23/23 PASS
INV: INV-001, INV-002, INV-003
```
커밋 footer:
```
Stage: D
Risk: HIGH
```

---

## 매 Stage 종료 시 필수 행동 (이 순서를 지켜라)
1. `memory/project/current-state.yaml` 갱신
2. `memory/project/next-actions.yaml` 갱신
3. `memory/L0-hot/reflection-log.yaml` 자기반성 기록
4. `worklog/A_progress.md` 갱신
5. `node scripts/audit-chain.js append "{stage}/{domain}" "{핵심 행동}"` 실행
6. `node scripts/record-metrics.js {domain} {stage} {시간} {passed} {total} {gate}` 실행
7. `node scripts/generate-learning-report.js {stage} {domain}` 실행 → reporter 에이전트가 채움
8. `node scripts/update-knowledge-graph.js` 실행
9. Stage D/E: `node scripts/health-dashboard.js` 실행
10. Stage E + B_review 완료: `node scripts/validate-contracts.js` + `node scripts/architecture-fitness.js`
11. Conventional Commit으로 커밋

---

## 종료 출력 형식
```
## 실행 결과
**실행한 것**: [Stage + 도메인 + 핵심 행동]
**서브에이전트**: [사용한 에이전트]
**게이트 결과**: PASS / PARTIAL_PASS / FAIL
**Observer 검증**: PASS / MISMATCH {N}건
**CoVe 결과**: 불일치 {N}건 수정
**Reflexion**: 없음 / {N}회 반성 후 해결
**생성/수정 파일**: [목록]
**테스트**: [N/N PASS]
**B_review**: PASS / CONDITIONAL_PASS / FAIL / 해당없음
**학습보고서**: [경로]
**감사 로그**: #N 기록됨
**건강도**: [도메인 점수 / 추세]
**커밋**: [Conventional Commit 메시지]
**다음**: [next-actions priority 1]
**차단**: 없음 / [이유]
```

---

## 컴팩션 규칙
- 50개 이상 파일을 읽었으면 중간 결과를 `memory/L1-warm/`에 저장하고 context를 정리하라.
- 보존: 미완료 INV, 실패 중인 테스트, next-actions priority 1
- 버림: PASS한 테스트 출력, 성공 ESLint 결과, 미변경 파일

---

## 변경 감지 라우팅
- **A부터 재실행**: bounded_context, ubiquitous_language, invariants, permissions, 계약, risk_level, state_machines
- **B부터 재실행**: 화면 구성, 라우팅 매핑, 내부 구현, 새 화면
- **C부터 재실행**: navigation, feature_flags, rollout, plugin-registry
- **불확실**: A부터

---

## 프로젝트 고유 규칙
- `requirements/requirements.yaml`을 저장소의 단일 입력 진실원으로 취급하라.
- Work Packet 운영 문맥이 있으면 `memory/checkpoint.yaml`과 `memory/current-wp.yaml`도 함께 확인하라.
- 세션 시작 직후 `npm run wp:next`와 `npm run wp:gaps`를 실행해 DAG 준비 상태와 요구사항 갭을 확인하라.
- `shell` 성격 변경 후에는 `npm run validate:composition`을 실행하라.
- Work Packet 큐를 건드렸다면 `npm run wp:validate`를 실행해 DAG 참조 무결성을 확인하라.
- 세션 종료 전 `npm run wp:gaps:gen`을 실행해 신규 갭을 Work Packet 스켈레톤으로 반영하라.
- 모든 Work Packet 결과를 `worklog/YYYY-MM-DD_WP-NN.yaml` 형식의 증적으로 남겨라.
