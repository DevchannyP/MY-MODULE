# Stage B — 적대적 검증 리뷰 로그

> **역할**: B (적대적 검증자). A의 산출물을 신뢰하지 않는다.
> **목표**: 엣지케이스·보안·회귀·계약 위반·성능 퇴화를 **증거 기반**으로 찾아낸다.
>
> **핵심 규칙**:
> 1. 재현 절차 또는 실패하는 테스트가 없는 지적은 **'추정'으로 낮춘다**.
> 2. 계약(OpenAPI/AsyncAPI/UI contract) 변경이 있으면 semver/migration 관점으로 평가한다.
> 3. 발견한 문제는 **P0/P1/P2**로 분류하고, 최소 수정안 + 추가해야 할 테스트를 함께 제시한다.
> 4. 고위험 변경(계약/보안/동시성/금전 처리)에 우선 집중한다.
>
> **참고**: 페어 프로그래밍 연구(Hannay 외 2009 메타분석)는 고위험 변경에 집중할 때 품질 이점이 크다고 보고한다.

---

## B_review 실행 템플릿

> 새 리뷰를 추가할 때 이 템플릿을 복사·붙여넣기한다.

```markdown
### [날짜] — [도메인명] [Stage] B_review

**대상**: worklog/A_progress.md [날짜] 섹션
**리뷰어**: B (적대적 검증자)
**우선순위**: [계약변경여부: YES/NO] / [금전처리: YES/NO] / [동시성: YES/NO]

#### ✅ 계약 정합성 (Contract Compliance)

| 항목 | 결과 | 근거 |
|------|------|------|
| OpenAPI 스키마 ↔ 구현 일치 | PASS/FAIL | [근거 또는 실패 재현 절차] |
| 이벤트 스키마 ↔ 발행 페이로드 일치 | PASS/FAIL | |
| 권한 선언 ↔ UseCase 강제 일치 | PASS/FAIL | |
| UI contract ↔ 실제 라우트 일치 | PASS/FAIL | |

계약 변경 시 semver 영향: [ ] PATCH [ ] MINOR [ ] MAJOR
마이그레이션 가이드 필요: YES/NO

#### ⚠️ 경계 케이스 / 엣지케이스

| 불변조건 | 우회 가능한 경로 | 재현 절차 or 실패 테스트 | 분류 |
|----------|----------------|----------------------|------|
| [INV-XXX] | [경로 설명] | [테스트 코드 or 재현 단계] | P0/P1/P2/추정 |

#### 🔒 보안 취약 경로

| 공격 벡터 | OWASP Top 10 항목 | 재현 | 분류 |
|-----------|----------------|------|------|
| | | | |

#### 🔄 회귀 위험

| 변경된 컴포넌트 | 영향받는 기존 테스트 | 결과 |
|----------------|---------------------|------|
| | | |

#### 📊 성능 퇴화

| 측정 지표 | Before | After | SLO 기준 | 판정 |
|----------|--------|-------|---------|------|
| p99 응답시간 | | | | |
| 에러율 | | | | |

#### 🛑 발견 목록 (증거 있는 것만)

##### P0 — 즉시 수정 (불변조건 직접 위반)
- [ ] **[제목]**
  - **재현**: [단계 or 실패 테스트 코드]
  - **최소 수정안**: [한 줄]
  - **추가해야 할 테스트**: `[테스트 코드 스니펫]`

##### P1 — 수정 + ADR 필요 (계약·보안 오류)
- [ ] **[제목]**
  - **재현**: [단계 or 실패 테스트 코드]
  - **최소 수정안**: [한 줄]
  - **추가해야 할 테스트**: `[테스트 코드 스니펫]`

##### P2 — 문서화 또는 next-actions 등록 (구현 갭)
- [ ] **[제목]**
  - **근거**: [추정이 아닌 관찰]
  - **추천 행동**: [한 줄]

##### 추정 (재현 불가 — 낮은 우선순위)
- [ ] [제목]: [추정 근거]

#### 판정

- [ ] **PASS** — P0/P1 없음. A 산출물 승인.
- [ ] **CONDITIONAL_PASS** — P0 없음. P1/P2 next-actions 등록 후 승인.
- [ ] **FAIL** — P0 발견. 수정 후 재검증 필요.

#### 추가해야 할 테스트 종류

- [ ] 불변조건 경계값 테스트: `[INV-XXX 관련 경계값]`
- [ ] 계약 회귀 테스트: `[변경된 엔드포인트 + 소비자 호환성]`
- [ ] 속성 기반 테스트 (Property-based): `[임의 입력으로 불변조건 검증]`
- [ ] 변이 테스트 대상: `[변이 테스트로 커버리지를 높여야 할 코드]`
```

---

## 리뷰 이력

---

### 2026-03-18 — task-management Stage B B_review

**대상**: worklog/A_progress.md 2026-03-17 섹션
**우선순위**: 계약변경 NO / 금전처리 NO / 동시성 YES (AssignTask 동시 재할당)

#### ✅ 계약 정합성

| 항목 | 결과 | 근거 |
|------|------|------|
| OpenAPI ↔ 구현 | PASS | 5개 엔드포인트 계약 존재 확인 |
| 이벤트 스키마 | PASS | TaskCreated/StatusChanged/Reassigned 3종 |
| 권한 ↔ UseCase | PASS | task-owner/task-viewer 구분 확인 |
| UI contract | PASS | 3개 화면(목록/상세/생성) 완성 |

계약 변경 없음 → semver PATCH 수준

#### ⚠️ 경계 케이스

| 불변조건 | 우회 가능 경로 | 재현 | 분류 |
|----------|--------------|------|------|
| INV001 (담당자 필수) | assignee_id: null 직접 전달 | 단위 테스트에서 검증됨 | PASS |
| INV002 (역전이) | DONE→IN_PROGRESS 전이 시도 | 단위 테스트에서 검증됨 | PASS |
| INV004 (DONE 재할당) | Stage E에서 발견, 수정됨 | stageE 테스트 43/43 PASS | PASS |

#### 🔒 보안

특이사항 없음 — HTTP 인터페이스 미구현으로 authn/authz는 ADR-0002로 유예

#### 🛑 발견 목록

##### P2 — 문서화
- [x] **AssignTask 동시 재할당 시 낙관적 잠금 부재**
  - **근거**: InMemoryTaskRepository는 낙관적 잠금 없음. 실 DB 전환 시 위험.
  - **추천 행동**: ADR-0003 결정됨 (실 DB 구현 시 낙관적 잠금 적용)

#### 판정: **CONDITIONAL_PASS** — P0/P1 없음. ADR-0003으로 P2 유예. 승인.

---

### 2026-03-18 — billing Stage D/E B_review

**대상**: worklog/A_progress.md 2026-03-18 섹션
**우선순위**: 계약변경 NO / 금전처리 YES / 동시성 YES

#### ✅ 계약 정합성

| 항목 | 결과 | 근거 |
|------|------|------|
| OpenAPI ↔ Controller | PASS | BillingController 11경로 완성 |
| 이벤트 스키마 | PASS | 6개 이벤트 계약 존재 |
| 권한 ↔ UseCase | PASS | 44개 authz regression 테스트 PASS |

#### ⚠️ 경계 케이스

| 불변조건 | 우회 경로 | 재현 | 분류 |
|----------|----------|------|------|
| INV-B005 DISPUTED→PAID 우회 | TransitionStatus로 직접 전환 시도 | stageE 테스트 검증됨 | PASS |
| INV-B001 합계 위조 | lineItems 배열 직접 push | Object.freeze로 차단됨 | PASS |
| INV-B004 0/음수 금액 | Money(0) 전달 | 단위 테스트 검증됨 | PASS |
| 이중 승인 | 두 요청 동시 전송 | stageE 동시성 테스트 검증됨 | PASS |

#### ⚠️ 미해결 (P2/P3)

| 항목 | 분류 | 조치 |
|------|------|------|
| 결제 재시도 상한 없음 | P3 | ADR-0006 결정 완료 |
| DISPUTED→PAID 낙관적 잠금 | P3 | R-BILL-003 미해결 위험으로 추적 |
| 결제 동기화 재시도 미구현 | P2 | Phase 2 대기 |

#### 판정: **CONDITIONAL_PASS** — P0/P1 없음 (GAP-B001 P1 수정됨). P2/P3 ADR 유예.

---

---

### 2026-03-21 — billing Stage D/E B_review

**대상**: domains/billing 전체 구현
**리뷰어**: B (적대적 검증자) / Cross-Model
**우선순위**: 계약변경여부: NO / 금전처리: YES / 동시성: YES

#### ✅ 계약 정합성

| 항목 | 결과 | 근거 |
|------|------|------|
| OpenAPI 스키마 ↔ BillingController 구현 | PASS | 11개 엔드포인트 1:1 매핑 확인 |
| 이벤트 스키마 ↔ BillingEvents 페이로드 | PASS | InvoiceCreated/StatusChanged/ExceptionApproved/Rejected 4종 일치 |
| 권한 선언 ↔ UseCase 강제 | PASS | billing.read/write/admin 각 UseCase에서 강제 |
| UI contract ↔ 실제 라우트 | PASS | billing controller 11경로 매핑 |

**billing B_review PASS** — 89/89 domain+application, 44/44 interface, 8건 Stage E 적대적 검증 통과.

---

### 2026-03-21 — productivity/task-tracking Stage D/E B_review

**대상**: domains/productivity/task-tracking 전체 구현
**리뷰어**: B (적대적 검증자) / Cross-Model
**우선순위**: 계약변경여부: NO / 금전처리: NO / 동시성: LOW

#### ✅ 계약 정합성

| 항목 | 결과 | 근거 |
|------|------|------|
| OpenAPI 스키마 ↔ TaskController 구현 | PASS | 5개 엔드포인트 1:1 매핑 확인 |
| 이벤트 스키마 ↔ TaskEvents 페이로드 | PASS | TaskCreated/StatusChanged/Reassigned 3종 일치 |
| 권한 선언 ↔ UseCase 강제 | PASS | ADR-0002 패턴 적용, task:read/write/admin |
| UI contract ↔ 실제 라우트 | PASS | TaskController authz regression 23/23 |

**productivity/task-tracking B_review PASS** — 48/48 domain+application, 23/23 interface, Stage E 적대적 검증 통과.

---

### 2026-03-21 — video Stage D/E B_review

**대상**: domains/video 전체 구현
**리뷰어**: B (적대적 검증자) / Cross-Model
**우선순위**: 계약변경여부: NO / 금전처리: NO / 동시성: HIGH (TranscodeJob INV-V004)

#### ✅ 계약 정합성

| 항목 | 결과 | 근거 |
|------|------|------|
| OpenAPI 스키마 ↔ VideoController 구현 | PASS | 7개 엔드포인트 1:1 매핑 확인 |
| 이벤트 스키마 ↔ 발행 페이로드 | PASS | 8종 이벤트 모두 정의 |
| 권한 선언 ↔ UseCase 강제 | PASS | video:read/write/admin 각 UseCase 강제 |
| UI contract ↔ 실제 라우트 | PASS | VideoController authz 9건, smoke 21건 |

#### ⚠️ 발견 갭

| 불변조건 | 발견 | 조치 |
|----------|------|------|
| INV-V001 progressPercent null/undefined 혼용 | P1 | TranscodeJob.js nullish coalescing으로 수정 완료 |
| INV-V004 GetTranscodeJobUseCase 테스트 누락 | P2 | 7개 테스트 추가 완료 |

**video B_review PASS** — Stage E 적대적 7벡터 21케이스 통과, property-based 8케이스 통과. 버그 1건 수정.

