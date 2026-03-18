# 인시던트 로그

## 이 파일의 용도

Stage D FAIL 3회 이상 반복, 롤백 실행, 심각한 품질 게이트 실패를 기록한다.
이 파일에 기록이 3건 이상 쌓이면 Stage E 진입을 검토한다.

## 기록 형식

```markdown
### [날짜] - [INC-NNNN] - [제목]

**날짜**: YYYY-MM-DD HH:MM
**심각도**: P1 | P2 | P3
**영향 범위**: [어떤 모듈/도메인에 영향]
**증상**: [무슨 일이 일어났는가]
**원인**: [왜 발생했는가]
**타임라인**:
- HH:MM - 감지
- HH:MM - 조치
- HH:MM - 해결

**수정 내용**: [무엇을 수정했는가]
**재발 방지**: [다음에 같은 일이 없도록]
**Stage E 진입 여부**: 예 | 아니오
```

## 인시던트 기록

### 2026-03-18 - GAP-001 - capability.yaml INV004 누락

**날짜**: 2026-03-18
**심각도**: P2
**영향 범위**: task-management 모듈 reassign-task capability
**증상**: CANCELLED 상태 작업 담당자 변경이 코드에서 허용되나 계약서(capability.yaml)에 명시되지 않음. 계약 기반 클라이언트가 동작을 예측할 수 없는 계약 불일치.
**원인**: Stage A 설계 시 INV004("DONE 상태 작업 담당자 변경 불가, CANCELLED는 허용") 누락. reassign-task precondition에 CANCELLED 예외 케이스가 반영되지 않음.
**타임라인**:
- Stage E 적대적 검증(E-4 스위트)에서 감지
- capability.yaml 및 stageA memory 즉시 갱신
- 코드 변경 없음 (구현은 이미 올바름)

**수정 내용**: capability.yaml reassign-task precondition/invariant에 INV004 명시. memory/stageA/task-management.yaml에 INV004 추가.
**재발 방지**: Stage A 계약 작성 시 모든 허용 예외 케이스를 precondition에 명시. reassign 계열 capability는 각 status별 허용 여부를 명시적으로 기술.
**Stage E 진입 여부**: 예 (Stage E에서 발견됨)

---

### 2026-03-18 - GAP-002 - permissions_required UseCase 미강제 (구조 갭)

**날짜**: 2026-03-18
**심각도**: P3
**영향 범위**: 전체 UseCase 레이어
**증상**: capability.yaml의 permissions_required 필드가 UseCase에서 검사되지 않음. 직접 UseCase 호출 시 권한 우회 가능.
**원인**: interface 레이어 미구현. 권한 강제 책임 레이어가 결정되지 않은 상태에서 UseCase 구현이 선행됨.
**타임라인**:
- Stage E 적대적 검증(E-4 스위트)에서 감지
- ADR 0002 작성으로 설계 결정 확정 (interface 레이어 강제)
- UseCase 코드 변경 없음 (C002 준수)

**수정 내용**: ADR 0002 — 권한 강제는 interface 레이어(HTTP 미들웨어) 책임으로 확정.
**재발 방지**: 향후 UseCase 구현 시 대응하는 interface 레이어(Controller + 미들웨어)를 동시에 작성. authn-authz 게이트를 Stage D에 포함하여 검증.
**Stage E 진입 여부**: 예 (Stage E에서 발견됨)

---

### 2026-03-18 - GAP-003 - InMemoryTaskRepository 낙관적 잠금 부재 (구조 갭)

**날짜**: 2026-03-18
**심각도**: P3 (개발/테스트 환경 한정)
**영향 범위**: 프로덕션 DB 어댑터 (미구현)
**증상**: InMemoryTaskRepository에 version 필드 없음. 동시 요청 시 lost update 발생 가능.
**원인**: InMemoryRepository는 개발/테스트 전용으로 설계되었으나, 프로덕션 DB 어댑터에 낙관적 잠금 정책이 명시되지 않음.
**타임라인**:
- Stage E 적대적 검증(E-5 스위트)에서 감지
- ADR 0003 작성으로 프로덕션 DB 어댑터 정책 확정

**수정 내용**: ADR 0003 — DbTaskRepository.js 구현 시 version 필드 + WHERE id=? AND version=? UPDATE 조건 필수.
**재발 방지**: 저장소 인터페이스(Port) 정의 시 version 필드를 포함한 snapshot 스펙 명시. DB 어댑터 구현 시 낙관적 잠금 integration test 포함.
**Stage E 진입 여부**: 예 (Stage E에서 발견됨)
