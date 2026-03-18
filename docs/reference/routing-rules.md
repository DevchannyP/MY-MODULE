# Stage Router - 라우팅 규칙 참조

> **WHAT** 중심 문서: Stage Router가 무엇을 하는가?

## Stage 진입 조건

| Stage | 진입 트리거 |
|-------|------------|
| **A** | bounded context 변경 / 용어 변경 / 권한 변경 / 불변조건 변경 / public contract 변경 |
| **B** | stageA memory 변경 / domain-map 변경 / 화면 구성 변경 / shared libs 변경 / composition policy 변경 |
| **C** | plugin registry 변경 / navigation 변경 / feature flag 변경 / rollout 정책 변경 |
| **D** | 구현 완료 후 검증 필요 / 수정 후 재검증 필요 |
| **E** | 반복 실패 발생 / 수동 개입 증가 / 구조 단순화 필요 판단 |

## 라우팅 우선순위

```
requirements.yaml의 stage 필드를 우선 읽는다.
→ 변경 감지 결과와 비교한다.
→ 더 이른 Stage 트리거가 감지되면 해당 Stage로 리라우팅한다.
→ 모든 선행 Stage가 PASS 상태여야 다음 Stage로 진행한다.
```

## Stage 상태 값

- `NOT_STARTED`: 아직 실행되지 않음
- `IN_PROGRESS`: 실행 중
- `PASS`: 완료 및 통과
- `FAIL`: 완료했으나 품질 게이트 미통과 (완료 선언 불가)
- `BLOCKED`: 선행 조건 미충족으로 중단

## 재실행 조건

Stage가 이미 PASS 상태여도 다음 경우 재실행한다:
1. 해당 Stage 진입 트리거에 해당하는 변경이 감지된 경우
2. 하위 Stage에서 FAIL이 발생하고 원인이 상위 Stage 산출물에 있는 경우
3. 사용자가 명시적으로 재실행을 요청한 경우

## 라우팅 결정 기록

라우팅 결정은 `memory/project/current-state.yaml`의 `stage_states` 섹션에 기록한다.
