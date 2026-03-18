# Stage E 적대적 검증 실행 로그

**실행일**: 2026-03-18
**모듈**: task-management (task-tracking bounded context)
**결과**: PASS (43/43 adversarial tests, 3 structural gaps discovered & addressed)

---

## 실행 개요

Stage D PARTIAL_PASS(NOT_CONFIGURED 9건) 이후 Stage E 진입.
목적: 구현 코드에 대한 적대적 검증으로 숨겨진 갭·경계 오류·계약 불일치를 발견하고 자기개선.

---

## 테스트 파일

`domains/productivity/task-tracking/tests/adversarial/stageE_adversarial.test.js`

총 **7개 스위트, 43개 테스트 — 전부 PASS**

| 스위트 | 내용 | 테스트 수 | 결과 |
|--------|------|-----------|------|
| [E-1] 경계값 | title/description 최대값, due_date=오늘 | 5 | PASS |
| [E-2] null/undefined 방어 | 필수 입력 누락 시 오류 발생 여부 | 6 | PASS |
| [E-3] 이벤트 스키마 정합성 | events.schema.json required 필드 준수 | 3 | PASS |
| [E-4] 계약 위반 시뮬레이션 | INV004/Gap-2 구조 문서화 | 6 | PASS |
| [E-5] 동시성 | 낙관적 잠금 부재 시뮬레이션 | 4 | PASS |
| [E-6] 상태 머신 완전 검증 | 4×4=16 전이 조합 | 16 | PASS |
| [E-7] capability ↔ UseCase 1:1 매핑 | 5개 capability 각각 매핑 | 3 | PASS |

---

## 발견된 구조적 갭

### 갭-1: INV004 계약 누락 (P2)

**증상**: CANCELLED 상태 작업 담당자 변경이 코드에서 허용되나 capability.yaml에 명시되지 않음
**영향**: reassign-task capability 호출자가 CANCELLED 상태 처리를 예측할 수 없음
**수정**: capability.yaml에 INV004 추가 + precondition 명시 ("DONE 상태가 아니어야 한다, CANCELLED 포함 변경 가능")
**부수 갱신**: memory/stageA/task-management.yaml에 INV004 추가 (discovered_by 주석 포함)
**ADR**: 없음 (계약 갭 수정, 설계 결정이 아님)

### 갭-2: 권한 강제 레이어 미정 (P3)

**증상**: capability.yaml의 permissions_required가 UseCase에서 강제되지 않음
**영향**: task:read 권한 사용자가 UseCase 직접 호출로 task:write 기능 실행 가능
**수정**: ADR 0002 작성 — interface 레이어(HTTP 미들웨어)에서 강제하기로 결정
**근거**: UseCase에 callerRole 파라미터 추가 시 C002(도메인 코어 순수성) 위반
**상태**: interface 레이어(TaskController.js) 미구현 → authn-authz 게이트 NOT_CONFIGURED 유지

### 갭-3: 낙관적 잠금 부재 (P3)

**증상**: InMemoryTaskRepository에 version 필드 없음 → 동시 업데이트 시 lost update 가능
**영향**: 분산 환경 동일 task 동시 수정 → 두 번째 저장이 첫 번째를 덮어씀
**수정**: ADR 0003 작성 — 프로덕션 DB 어댑터에 낙관적 잠금 필수화
**근거**: InMemoryRepository는 개발/테스트 전용; 허용됨
**상태**: DbTaskRepository.js 미구현 → 낙관적 잠금 PENDING

---

## ADR 생성

| ADR | 제목 | 결정 |
|-----|------|------|
| 0002 | 권한 강제(Permission Enforcement) 레이어 결정 | interface 레이어 (HTTP 미들웨어) |
| 0003 | 낙관적 잠금(Optimistic Locking) 정책 | 프로덕션 DB 어댑터 필수, InMemory 제외 |

---

## Stage E 판정

**결과**: PASS

- 43개 적대적 테스트 전부 통과
- 3개 구조적 갭 발견 및 조치 (갭-1 수정, 갭-2/3 ADR 결정)
- 계약(capability.yaml) 개선 반영
- 메모리(stageA) 갱신 완료

**후속 조치**: next-actions.yaml 참조
