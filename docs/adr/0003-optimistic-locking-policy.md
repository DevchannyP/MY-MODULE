# ADR 0003: 낙관적 잠금(Optimistic Locking) 정책

**날짜**: 2026-03-17
**상태**: 수락됨 (Accepted)
**결정자**: productivity-team
**발견 경위**: Stage E 적대적 검증 갭-3(동시성) — InMemoryTaskRepository에 낙관적 잠금 없음

## 맥락

Stage E 동시성 테스트(E-5)에서 확인한 사항:
- 순차 실행에서는 INV002가 올바르게 동작한다.
- 그러나 실제 분산 환경에서 두 클라이언트가 동일한 task를 동시에 읽고 각각 상태 전이를 시도하면 **lost update** 문제가 발생할 수 있다.
  - Client A: 읽기 (IN_PROGRESS) → DONE으로 전이 시도
  - Client B: 읽기 (IN_PROGRESS, stale) → CANCELLED로 전이 시도
  - 두 번째 저장이 첫 번째를 덮어쓰면 의도하지 않은 최종 상태가 된다.
- 현재 `InMemoryTaskRepository`는 version 필드가 없어 낙관적 잠금이 불가능하다.

## 결정

프로덕션 저장소(DB 어댑터) 구현 시 **낙관적 잠금(version 필드)** 을 적용한다.

```
Task snapshot에 version: number 필드 추가
저장 시: WHERE id = ? AND version = ? 조건으로 UPDATE
충돌 시: 409 Conflict 응답 → 클라이언트 재시도
```

`InMemoryTaskRepository`는 개발/테스트 전용이므로 현재 잠금 미적용을 허용한다.
단, 프로덕션 DB 어댑터 구현 시 반드시 낙관적 잠금을 포함해야 한다.

## 결과

1. 현재 `InMemoryTaskRepository` 변경 없음 (개발/테스트 전용).
2. 향후 `src/infrastructure/DbTaskRepository.js` 구현 시 version 필드 필수.
3. `Task.toSnapshot()`에 `version` 필드 추가 필요 (프로덕션 전환 시).
4. 이 결정은 Stage D `integration-tests` 게이트에 낙관적 잠금 테스트를 포함시키는 것으로 이어진다.

## 대안

- **비관적 잠금(Pessimistic Locking)**: `SELECT FOR UPDATE`. 처리량 감소, 데드락 위험.
  → 거부: task-tracking 도메인은 충돌이 드물어 낙관적 잠금이 적합.
- **이벤트 소싱 + CQRS**: 충돌 자체를 이벤트로 처리.
  → 유보: 현재 복잡도 수준에서 과잉 설계. 향후 필요 시 ADR로 재검토.
