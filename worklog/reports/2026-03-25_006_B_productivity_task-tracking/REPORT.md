# 학습 보고서: Stage B — productivity/task-tracking

> 일자: 2026-03-25 | 순번: #006 | 작성: AI Agent (reporter)
> Stage: B | 도메인: productivity/task-tracking
> 게이트 결과: PASS | 조합 충돌: 0건

---

## 기(起) — 배경과 문제 정의

task-tracking은 **3개 이벤트를 발행하는 upstream(상류) 도메인**이다. 이벤트를 소비할 downstream 도메인(notification, analytics, reporting)이 아직 없지만, Stage B는 미래 소비자가 생겼을 때 이벤트 네임스페이스가 충돌하지 않도록 선제 검증한다.

이것이 Stage B의 핵심 원칙: **"아직 없는 도메인과의 미래 충돌"도 지금 검증한다.**

### 핵심 용어
| 용어 | 한글 | 의미 |
|------|------|------|
| upstream | 상류 도메인 | 이벤트를 발행하여 다른 도메인이 소비하는 원점 도메인 |
| downstream | 하류 도메인 | upstream 이벤트를 구독하여 반응하는 도메인 |
| 느슨한 결합 | loose coupling | 이벤트를 통한 간접 연결. 직접 함수 호출 금지 |

---

## 승(承) — 설계 결정

### task-tracking의 dependency 구조

```
(upstream 방향 없음)
    ↓ 이벤트 발행
task-tracking ──→ TaskCreated
              ──→ TaskStatusChanged
              ──→ TaskReassigned
    ↓ 소비자 (현재 없음, 미래)
notification ← TaskStatusChanged 구독 (미래)
analytics    ← TaskCreated 구독 (미래)
```

`depends_on_contracts: []` — task-tracking은 다른 도메인의 계약에 의존하지 않는다. 완전한 leaf 노드.

### 이벤트 네임스페이스 확인 및 충돌 없음

```json
// domains/productivity/task-tracking/contract/events.schema.json
// 3개 이벤트:
"TaskCreated":        { "description": "작업이 생성됨" }
"TaskStatusChanged":  { "description": "작업 상태가 변경됨" }
"TaskReassigned":     { "description": "작업 담당자가 변경됨" }
```

`Task*` 접두사: billing의 `Invoice*`, `Payment*`, video의 `Video*`, `TranscodeJob*`과 전혀 겹치지 않음. 충돌 0건.

---

## 전(轉) — 계약 스니펫 (기초 → 심화)

### Level 1: 기초 — 3개 이벤트의 의미론적 분리

```json
// "TaskStatusChanged"와 "TaskReassigned"를 분리한 이유
// 통합 이벤트로 만들 수도 있었다:
// TaskUpdated { field: "status" | "assignee", ... }  ← 잘못된 설계

// 분리한 이유:
// 1. 소비자가 "상태 변경만" 또는 "담당자 변경만" 구독할 수 있다
// 2. payload 구조가 달라서 통합하면 optional 필드가 늘어난다
// 3. 이벤트 소싱 시 명확한 원인(cause) 추적이 가능하다
```

"이벤트를 목적별로 분리"하는 이 패턴이 stage-tracking 도메인이 기준 사례가 된 이유 중 하나다.

### Level 2: 중급 — 향후 notification 연동 설계

```yaml
# 미래에 notification 도메인이 추가될 때의 Stage B memory 항목:
# notification:
#   depends_on_contracts:
#     - path: "domains/productivity/task-tracking/contract/events.schema.json"
#       consumed_events: ["TaskStatusChanged"]  # "PENDING→IN_PROGRESS만 알림 발송"
#       type: "event"
#
# task-tracking의 계약은 변경 없음 — notification이 단방향 의존을 선언
```

task-tracking이 notification을 모른 채, notification이 task-tracking 이벤트를 구독한다. 이것이 "격리된 도메인 모듈"의 의미: 기존 도메인을 수정하지 않고 새 도메인을 추가할 수 있다.

### Level 3: 심화 — old_status 포함의 Stage B 의미

```json
// TaskStatusChanged 이벤트에 old_status가 포함된 이유
// (Stage B 관점: 소비자 도메인이 이 필드로 무엇을 할 수 있는가?)
{
  "TaskStatusChanged": {
    "payload": {
      "old_status": { "enum": ["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"] },
      "new_status": { "enum": ["IN_PROGRESS", "DONE", "CANCELLED"] }
    }
  }
}
// notification 도메인: "PENDING→IN_PROGRESS" 전이 시에만 알림 발송
// analytics 도메인: "IN_PROGRESS→DONE" 시 처리 시간 계산
// 두 소비자가 old_status 없이는 이 차등 처리를 할 수 없다
```

Stage B에서 "이벤트에 어떤 컨텍스트를 포함할 것인가"를 결정하는 것이 downstream 도메인의 구현 가능성을 결정한다.

---

## 결(結) — 결과와 교훈

### 게이트 결과
| 항목 | 결과 | 비고 |
|------|------|------|
| 경로 충돌 | PASS | `/tasks/*` 고유 |
| 이벤트 충돌 | PASS | Task* 3개 이벤트 고유 |
| 권한 충돌 | PASS | `task:*` 네임스페이스 고유 |
| 외부 의존성 | PASS | depends_on: [] 확인 |

### 이번 Stage에서 배운 것

1. **upstream 도메인의 Stage B는 "미래 소비자를 위한 설계"다**: 현재 소비자가 없어도 이벤트 구조가 충분히 풍부한지 Stage B에서 검토한다. `old_status` 포함은 이 검토의 결과물.

2. **"아무 문제 없음"도 증거다**: task-tracking Stage B 결과는 충돌 0건. 이것을 문서화하는 것이 "증거 기반 리뷰"의 일부.

3. **기준 사례(reference implementation)가 되려면 Stage B부터 명확해야 한다**: billing, video가 이 패턴을 참조했기 때문에 세 도메인이 일관된 네임스페이스 전략을 갖게 됐다.

### 다음 액션
Stage C: master-shell에 task-management-plugin 등록 + navigation 설정.
