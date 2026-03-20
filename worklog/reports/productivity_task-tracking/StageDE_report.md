# 학습보고서 — productivity/task-tracking Stage D/E
날짜: 2026-03-21

## 기승 (What happened)
task-tracking 도메인 testScore 62% → 92%로 향상. GetTask, ListTasks, ReassignTask, TransitionTaskStatus 테스트 추가.

## 전 (What went wrong / Challenges)
- Task 초기 상태가 PENDING임을 테스트에서 가정 수정 필요
- CreateTaskUseCase.execute가 Task 엔티티가 아닌 snapshot 반환

## 결 (What was learned)
- 도메인 초기 상태는 스냅샷 반환값으로 확인해야 함 (엔티티 내부에서 직접 추론 금지)
- canReassign은 DONE만 거부하고 CANCELLED는 허용하는 미묘한 정책

## 행동 (Next actions)
- SQLiteTaskRepository property test 추가 고려
- TaskEvents 발행 경로 통합 검증
