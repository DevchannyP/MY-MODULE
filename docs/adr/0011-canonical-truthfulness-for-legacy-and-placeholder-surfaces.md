---
adr_id: 0011
title: "Canonical truthfulness for legacy and placeholder surfaces"
status: accepted
date: 2026-03-20
domain: core-platform
stage: E
superseded_by: null
related_adrs: [0001]
related_invariants: []
---

# 0011. Canonical truthfulness for legacy and placeholder surfaces

## 상태
Accepted — 2026-03-20

## 컨텍스트
root `memory/` 는 현재 실행 기준인데, legacy `memory/project/` 에 남아 있는 `done: false` 같은 표기가 실제 queue 상태와 다르면 사람과 자동화 모두 잘못된 미완료 신호를 받을 수 있다.

또한 placeholder 성격의 ADR 초안이 실제 ADR index 에 섞이면 운영 결정 기록과 테스트 산출물이 구분되지 않는다.

삭제 금지 원칙 때문에 기존 산출물을 제거할 수는 없으므로, truthfulness 를 유지하는 보존 방식이 필요하다.

## 고려한 대안
### 대안 1: legacy/placeholder 파일을 그대로 둔다
- 장점: 수정이 가장 적다.
- 단점: 현재 상태를 오도하고, 실제 운영 표면과 시험 산출물이 섞인다.

### 대안 2: 문제 파일을 삭제한다
- 장점: 표면이 가장 깔끔하다.
- 단점: 저장소 규칙상 기존 파일 삭제가 금지되어 있고, 감사 추적도 약해진다.

### 대안 3: 파일은 유지하되 canonical truthfulness 규칙으로 비운영 상태를 명시한다
- 장점: 삭제 없이 감사 추적을 유지하면서도 현재 실행 상태를 오도하지 않는다.
- 단점: legacy/artifact 파일 자체는 계속 남는다.

## 결정
대안 3을 채택한다.

구체 규칙은 다음과 같다.

1. 현재 실행 상태는 root `memory/` 가 단일 canonical surface 로 유지한다.
2. legacy planning surface 는 현재 queue 와 충돌하는 미완료 신호를 남기지 않는다.
3. placeholder 또는 test artifact ADR 은 삭제하지 않되 `archived` 또는 동등한 비운영 상태로 명시한다.
4. ADR 생성기는 reserved placeholder 입력을 거부해 같은 오염을 재발시키지 않는다.

## 근거
저장소의 핵심 가치가 "truthful automation" 이라면, 남겨진 파일이 있더라도 현재 상태를 거짓으로 암시해서는 안 된다.

운영 기록과 시험 산출물을 구분하면 ADR index 를 읽는 사람과 스크립트가 더 적은 가정으로 정확한 판단을 할 수 있다.

## 결과
- 긍정적:
  - root queue 가 비어 있을 때 legacy queue 도 같은 사실을 오도 없이 전달한다.
  - placeholder ADR 이 실제 운영 ADR 집합과 구분된다.
  - ADR 생성기가 reserved 입력을 차단해 재발 가능성이 줄어든다.
- 부정적 (trade-off):
  - archived artifact 파일은 저장소에 계속 남는다.
- 후속 작업:
  - legacy/detail surface 를 추가할 때도 canonical truthfulness 규칙을 같은 방식으로 적용한다.
