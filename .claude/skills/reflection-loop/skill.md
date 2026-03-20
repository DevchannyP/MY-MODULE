---
name: reflection-loop
description: Reflexion 패턴 기반 자기반성 루프. Stage 실패 시 자동 호출. 실패 원인 분석 → 교훈 기록 → 다음 시도에 컨텍스트 주입.
---

## 트리거 조건
- Stage D 테스트 실패
- Stage E에서 P0/P1 갭 발견
- ESLint 수정 2회 이상 반복
- 동일 오류 패턴 재발

## 실패 즉시 수행

### memory/reflections/[domain]-[stage]-[attempt].yaml 생성:
```yaml
reflection:
  domain: "{domain_id}"
  stage: "{stage}"
  attempt: {n}
  timestamp: "{ISO-8601}"
  what_failed: "{실패한 검증/테스트}"
  error_message: "{에러 메시지 요약}"
  what_went_wrong: "{근본 원인 분석}"
  root_cause_category: "logic_error|missing_invariant|wrong_pattern|test_gap|contract_mismatch"
  next_strategy: "{다음 시도에서 구체적으로 다르게 할 점}"
  similar_past_failures: []
  confidence: 0.0
```

## 재시도 전 필수 읽기
1. memory/reflections/[domain]-[stage]-*.yaml (전부)
2. 최신 리플렉션의 next_strategy → 이번 시도의 시작점
3. memory/L0-hot/failure-patterns.yaml (반복 패턴 확인)

## 성공 시 추가
```yaml
resolution:
  resolved_at: "{ISO-8601}"
  what_worked: "{성공한 접근법}"
  lesson_learned: "{교훈 한 줄 요약}"
  reusable: true
```

## 교훈 축적
memory/project/lessons-learned.yaml의 lessons에 append:
```yaml
- id: "LESSON-{순번}"
  domain: "{domain}"
  stage: "{stage}"
  category: "{root_cause_category}"
  lesson: "{한 줄 요약}"
  applicable_to: ["{유사 도메인/패턴 키워드}"]
```

## 제한
- 최대 재시도 3회. 3회 실패 시 멈추고 사용자에게 보고.
- 동일 root_cause_category 3회 반복 → ADR 필요 경고.
- memory/L0-hot/failure-patterns.yaml에 패턴 등록.
