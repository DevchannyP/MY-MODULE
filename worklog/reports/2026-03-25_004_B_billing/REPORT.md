# 학습 보고서: Stage B — billing

> 일자: 2026-03-25 | 순번: #004 | 작성: AI Agent (reporter)
> Stage: B | 도메인: billing
> 게이트 결과: PASS | 조합 충돌: 0건

---

## 기(起) — 배경과 문제 정의

billing은 3개 Bounded Context(invoice·payment·exception)를 하나의 도메인 플러그인으로 조합해야 하는 복잡한 케이스다. 각 컨텍스트가 독립 UseCase를 가지면서도 단일 `/billing` 진입점을 공유한다.

Stage B의 핵심 목표는 두 가지였다:
1. **내부 조합 충돌 없음**: 3개 컨텍스트의 라우팅·이벤트·권한이 서로 충돌하지 않는다.
2. **외부 조합 충돌 없음**: billing의 라우팅(`/billing/*`), 이벤트(`Invoice*`, `Payment*`), 권한(`billing.*`)이 task-management, video와 충돌하지 않는다.

### 핵심 용어
| 용어 | 한글 | 의미 |
|------|------|------|
| Stage B | 조합 단계 | 계약 설계(A) 이후, 도메인 간 충돌을 선제 감지하는 단계 |
| 경로 충돌 | route conflict | 두 플러그인이 동일한 URL 접두사를 요청하는 상황 |
| 이벤트 충돌 | event conflict | 동일한 이벤트 타입명을 두 도메인이 발행하는 상황 |
| 조합 게이트 | composition gate | Stage B PASS 조건: 충돌 0건 + 계약 파일 존재 확인 |

---

## 승(承) — 설계 결정

### 3개 Bounded Context의 계약 조합 결과

```
billing.invoice  ─┐
billing.payment  ─┤──→ billing-plugin (단일 플러그인)
billing.exception─┘

공통 entry_point: /billing
공통 feature_flag: billing.enabled
```

invoice·payment·exception이 별도 capability.yaml을 가지지 않고 **단일 `domains/billing/contracts/capability.yaml`**에 통합된 것이 Stage B의 핵심 결정이다. 이유: 3개 컨텍스트가 항상 함께 배포되고, 독립 롤아웃이 불필요하다.

### 충돌 검사 결과 (0건)

| 검사 항목 | 결과 | 비고 |
|---------|------|------|
| 경로 충돌 | PASS | `/billing/*`은 기존 `/tasks/*`, `/videos/*`와 겹치지 않음 |
| 이벤트 충돌 | PASS | `Invoice*`, `Payment*` 접두사가 task-management·video와 중복 없음 |
| 권한 충돌 | PASS | `billing.*` 네임스페이스가 `task:*`, `video:*`와 분리됨 |
| 스키마 충돌 | PASS | `Invoice`, `Money`, `LineItem`이 기존 도메인 스키마와 겹치지 않음 |

---

## 전(轉) — 계약 스니펫 (기초 → 심화)

### Level 1: 기초 — 3개 컨텍스트의 라우팅 분리

```yaml
# master-shell/navigation/nav.yaml — billing 항목
- id: "billing"
  items:
    - plugin_id: "billing-plugin"
      route: "/billing"           # 진입점: invoice 목록
      feature_flag: "billing.enabled"
    - plugin_id: "billing-plugin"
      route: "/billing/invoices"  # 서브 라우트들
      feature_flag: "billing.invoice.enabled"
    - plugin_id: "billing-plugin"
      route: "/billing/payments"
      feature_flag: "billing.payment.enabled"
```

모든 라우트가 `/billing` 아래에 계층화됨 → 경로 충돌 원천 차단.

### Level 2: 중급 — 이벤트 네임스페이스 격리

```json
// domains/billing/contracts/events.schema.json
// 모든 이벤트 타입에 "billing" 도메인 접두사가 붙어 있음
"InvoiceCreated":   { "type": "object", "properties": { "domain": { "const": "billing" } } },
"InvoiceStatusChanged": { ... },
"PaymentTracked":   { ... },
"PaymentMismatchDetected": { ... },
"BillingExceptionRaised": { ... },
"BillingExceptionResolved": { ... }
```

이벤트 타입명이 `{도메인}+{행동}` 패턴으로 네임스페이스화되어 있어, 다른 도메인이 동일한 이름을 사용하는 충돌이 불가능하다.

### Level 3: 심화 — 권한 네임스페이스와 조합 불변

```yaml
# 권한 격리 패턴 (3개 도메인 모두 동일하게 적용)
# task-management: task:read, task:write
# billing:         billing.read, billing.write, billing.admin
# video:           video:read, video:write, video:admin

# "billing.admin"과 "video:admin"이 ':' vs '.' 구분자로 다름 — 의도적 차이
# billing은 역할 계층(billing.admin > billing.write > billing.read)을 점(.)으로 표현
# video는 독립 권한(video:admin ≠ video:write의 상위)을 콜론(:)으로 표현
```

이 비대칭은 Stage B 조합 충돌에 해당하지 않는다 — 두 네임스페이스가 완전히 분리되어 있으므로. 하지만 향후 RBAC 통합 시 정규화가 필요하다는 기술 부채로 기록됨.

---

## 결(結) — 결과와 교훈

### 게이트 결과
| 항목 | 결과 | 비고 |
|------|------|------|
| 경로 충돌 | PASS | 0건 |
| 이벤트 충돌 | PASS | 0건 |
| 권한 충돌 | PASS | 0건 |
| 계약 파일 존재 | PASS | 4종 파일 확인 |
| validate:composition | PASS | master-shell 교차 검증 PASS |

### 이번 Stage에서 배운 것

1. **3개 Bounded Context → 단일 플러그인 조합은 "같은 릴리즈 단위"의 증거**: 독립 롤아웃이 필요 없으면 단일 플러그인이 더 간결하다. 충돌 검사도 단순해진다.

2. **이벤트 네임스페이스 패턴이 Stage B 검사를 O(1)으로 단축**: `Invoice*` 접두사를 보는 것만으로 billing 도메인 이벤트임을 알 수 있다. 이 패턴이 없으면 모든 이벤트를 전수 비교해야 한다.

3. **권한 구분자 비일관성(`.` vs `:`)은 조합 충돌은 아니지만 기술 부채**: 현재 단계에서는 허용하되, RBAC 통합 시 ADR로 정규화 결정 필요.

### 다음 액션
Stage C: master-shell에 billing-plugin 등록 + feature-flags 활성화.
