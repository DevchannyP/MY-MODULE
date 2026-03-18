# 조합과 마스터 쉘 — 설계 원칙·근거·트레이드오프

> **Diátaxis 분류**: Explanation (WHY)
> **대상 독자**: 모듈을 마스터 쉘에 편입하거나 플러그인 구조를 이해하려는 개발자

---

## 1. 왜 모놀리스 우선(Monolith First)인가?

### 1.1 마이크로서비스의 숨겨진 비용

마이크로서비스는 독립 배포·확장이라는 이점을 주지만, 이 비용이 먼저 따른다.

| 비용 항목 | 설명 |
|----------|------|
| 네트워크 레이턴시 | 함수 호출 → HTTP/gRPC 왕복 (수십~수백 ms) |
| 분산 트랜잭션 | Saga / 2PC 없이는 일관성 보장 불가 |
| 운영 복잡성 | 서비스 디스커버리, 로드 밸런서, 헬스체크 배증 |
| 관찰 가능성 | 분산 트레이싱(Jaeger/Zipkin) 없이 디버그 불가 |
| 테스트 환경 | 전체 서비스를 Docker Compose로 띄워야 통합 테스트 |

Fowler (2015) "MonolithFirst" 패턴: *"경계를 찾기 전에 분리하면 잘못된 경계로 분리된다."* 모놀리스에서 시작해 경계가 안정되면 분리한다.

### 1.2 이 저장소의 3단계 진화

```
Phase 1 (현재): 모듈형 모놀리스
─────────────────────────────────
master-shell/
  plugin-registry.js   ← 모든 플러그인 등록
  index.js             ← 단일 프로세스 기동

domains/billing/       ← 도메인 코드 (격리됨)
domains/task-management/ ← 도메인 코드 (격리됨)

이점: 함수 호출, 단일 DB, 단순 운영
비용: 단일 배포 단위

───────────────────────────────────
Phase 2: 선택적 프로세스 분리
(경계가 안정된 도메인 1~2개 먼저)
───────────────────────────────────
billing ────HTTP/gRPC───▶ billing-service
task-management ────────▶ (여전히 모놀리스 내)

───────────────────────────────────
Phase 3: 완전 분산 (필요 시)
(팀 독립성·확장성 필요가 증명된 시점)
```

**핵심 판단 기준**: Phase 전환은 "기술적 선호"가 아니라 "검증된 필요"에 의해서만 한다.

---

## 2. 플러그인 아키텍처의 근거

### 2.1 플러그인이란 무엇인가

이 저장소에서 "플러그인"은 다음 계약을 이행하는 모듈이다.

```javascript
// capability.yaml에서 선언한 것을 코드로 구현
module.exports = {
  pluginId: 'billing-plugin',          // 고유 식별자
  featureFlag: 'billing.enabled',      // 기능 플래그
  useCases: { ... },                   // 노출할 유스케이스
  routes: [ ... ],                     // HTTP 경로 (있을 경우)
  events: { publish: [], subscribe: [] } // 이벤트 계약
};
```

### 2.2 플러그인 레지스트리의 역할

```
master-shell/plugin-registry.js
  ↓ 등록
  billing-plugin (feature_flag=false → inactive)
  task-management-plugin (feature_flag=false → inactive)

  feature_flag=true 활성화 → 해당 플러그인의 라우트/이벤트 핸들러 등록
```

마스터 쉘은 플러그인의 내부를 모른다. 오직 `capability.yaml`에 선언된 계약만 본다.

### 2.3 벤치마크: Backstage Plugin Architecture

Spotify의 Backstage(2020)는 플러그인 레지스트리 패턴을 대규모로 적용한 사례다.

| Backstage 개념 | 이 저장소 대응 |
|---------------|--------------|
| `createPlugin()` | `plugin-registry.js` 등록 |
| Plugin Feature Flags | `feature_flag` 필드 |
| Plugin Catalog | `capability.yaml` |
| Extension Points | UseCase 포트 |

차이점: Backstage는 React 기반 UI 중심이고 이 저장소는 도메인 로직 중심이다.

---

## 3. 왜 단일 requirements.yaml이 SSoT인가?

### 3.1 분산된 문서의 문제

전통적인 프로젝트에서 같은 비즈니스 규칙이 여러 곳에 있다.

```
기획서.docx          → "인보이스 금액은 양수여야 한다"
API_spec.xlsx        → "amount > 0 (필수)"
Invoice.java         → if (amount <= 0) throw new ...
InvoiceTest.java     → assertThrows(... new Invoice(-1) ...)
README.md            → "금액은 0보다 커야 합니다"
```

하나가 바뀌면 나머지가 어긋난다. 이것이 "문서 부채"의 실체다.

### 3.2 SSoT 전략

```
requirements.yaml (한 곳에만 작성)
          ↓ Stage A가 읽고 생성
contract/openapi.yaml      ← 계약
contract/events.schema.json ← 계약
domains/.../src/           ← 구현
domains/.../tests/         ← 테스트
docs/                      ← 문서
memory/stageA/*.yaml       ← 메모리
```

변경은 `requirements.yaml`에만 한다. Stage A를 재실행하면 모든 산출물이 재생성된다.

### 3.3 JSON Schema 2020-12 검증

`requirements.schema.json`이 `requirements.yaml`을 기계 검증한다.

```bash
# Stage A 시작 시 자동 실행
npx ajv validate -s requirements/requirements.schema.json \
                 -d requirements/requirements.yaml

# 실패 예시
Error: /invariants/0/enforcement_layer must be equal to one of the allowed values
Allowed: ["domain", "usecase", "interface", "all"]
```

잘못된 요구사항이 코드 생성 전에 걸러진다.

---

## 4. Stage 체이닝의 근거

### 4.1 각 Stage가 하는 일

```
Stage A — 계약·설계 (WHAT)
  입력: requirements.yaml
  출력: contract/ 4종, domain-spec.md, memory/stageA/*.yaml
  검증: JSON Schema, 불변조건 목록 완결성

Stage B — 모듈 조합 (HOW)
  입력: memory/stageA/*.yaml, contract/
  출력: src/ 전체 (domain / application / infrastructure)
  검증: 의존성 방향 (domain → 바깥 import 없음)

Stage C — 마스터 쉘 편입 (WHO CONNECTS)
  입력: memory/stageB/*.yaml, capability.yaml
  출력: plugin-registry.js 갱신, feature_flag 등록
  검증: capability.yaml ↔ 실제 UseCase 매핑

Stage D — 품질 게이트 (DOES IT WORK)
  입력: Stage C 산출물 전체
  출력: 테스트 결과, 린트 결과, 보안 스캔 결과
  검증: 단위 PASS, lint PASS, secret_scan PASS

Stage E — 적대적 검증 (IS IT SAFE)
  입력: Stage D PASS 산출물
  출력: 갭 목록, 즉시 수정, ADR
  검증: 불변조건 경계값, 동시성, 권한 우회 없음
```

### 4.2 왜 단계가 분리되어 있는가

각 Stage는 독립적인 실패 지점을 가진다.

```
Stage A FAIL → 계약이 잘못됨. 요구사항 재검토.
Stage B FAIL → 구현이 계약을 이행 못 함.
Stage C FAIL → 마스터 쉘 편입 로직 오류.
Stage D FAIL → 코드 품질 기준 미달.
Stage E FAIL → 비즈니스 안전성 기준 미달.
```

단계가 합쳐지면 실패 원인이 모호해진다. "테스트 실패"인지 "계약 오류"인지 "보안 취약"인지 구분할 수 없다.

### 4.3 PARTIAL_PASS와 NOT_CONFIGURED

Stage D는 두 가지 종류의 미완성을 구분한다.

| 상태 | 의미 | 처리 |
|------|------|------|
| `FAIL` | 해야 하는데 실패함 | 즉시 수정 |
| `NOT_CONFIGURED` | 아직 인프라가 없음 (예: CI/CD) | ADR로 유예 |

`NOT_CONFIGURED`는 의도적 유예이며, 해소 조건을 ADR에 명시한다. 이것이 `PARTIAL_PASS`를 "완료"로 인정하는 근거다.

---

## 5. 기능 플래그(Feature Flag)의 역할

### 5.1 기본값 false의 이유

```yaml
feature_flags:
  - name: billing.enabled
    default: false      # Stage D PASS 전까지는 절대 활성화 안 됨
```

새 모듈은 항상 비활성 상태로 마스터 쉘에 편입된다. Stage D 전체 PASS 이후에야 `true`로 바꾼다. 이렇게 하면:

- 개발 중인 코드가 프로덕션 트래픽을 받지 않는다
- 여러 모듈을 동시에 개발하면서 서로 간섭하지 않는다
- 기능 롤백이 코드 배포 없이 플래그 변경만으로 가능하다

### 5.2 Canary 롤아웃

```yaml
rollout:
  strategy: canary
  stages:
    - target: internal   # 내부 직원 5%
      weight: 5
    - target: beta       # 베타 사용자 20%
      weight: 20
    - target: full       # 전체
      weight: 100
```

각 단계에서 SLO(에러율, p99 레이턴시)를 측정하고 기준 초과 시 자동 롤백한다. Google SRE Error Budget 개념(Beyer 외 2016)에서 차용했다.

---

## 6. 마스터 쉘의 구조

### 6.1 마스터 쉘이 아는 것 / 모르는 것

```javascript
// master-shell/index.js
// 아는 것: 어떤 플러그인이 있고, 어떤 경로를 제공하는가
// 모르는 것: 플러그인 내부 도메인 로직

const registry = require('./plugin-registry');

for (const plugin of registry.activePlugins()) {
  for (const route of plugin.routes) {
    router.register(route.method, route.path, route.handler);
  }
}
```

마스터 쉘은 플러그인의 `Invoice`, `Payment`, `Task` 같은 도메인 객체를 직접 임포트하지 않는다.

### 6.2 벤치마크: Module Federation (Webpack 5)

| Module Federation 개념 | 이 저장소 대응 |
|-----------------------|--------------|
| Remote container | 각 domain plugin |
| Shared module | plugin-registry 계약 |
| Expose/consume | capability.yaml ↔ 마스터 쉘 |
| Dynamic import | feature_flag 기반 동적 로드 |

차이점: Module Federation은 UI 번들 분리 중심이고, 이 저장소는 서버사이드 도메인 로직 격리 중심이다. UI 쪽에서 Module Federation을 쓰는 것은 Phase 3 이후의 선택지다.

---

## 7. 메모리 파일이 코드보다 먼저인 이유

### 7.1 맥락 손실 문제

AI 에이전트(Claude)가 Stage를 실행할 때, 코드만 읽으면 "왜 이렇게 설계했는가"를 모른다.

```
코드를 읽으면 알 수 있는 것:
  - Invoice는 Object.freeze()로 불변
  - lineItems는 배열

코드만으로 알 수 없는 것:
  - 왜 Object.freeze()를 썼는가 (INV-B001 강제)
  - 왜 낙관적 잠금이 없는가 (ADR-0003: Phase 2로 유예)
  - 왜 currency가 'KRW' 하드코딩인가 (GAP-B002: 단일통화 제약)
```

### 7.2 메모리 파일 계층

```
memory/
  project/
    current-state.yaml   ← 전체 프로젝트 상태 (Stage 결과, 테스트 수)
    next-actions.yaml    ← 우선순위 행동 큐 (priority 1부터 실행)
    unresolved-risks.yaml ← 미해결 위험 목록 (R-BILL-003 등)

  stageA/
    billing.yaml         ← billing Stage A 결정사항 (경계, 불변조건, 언어)
    task-management.yaml ← task-management Stage A 결정사항

  stageB/
    billing.yaml         ← 모듈 조합 결정사항
    task-management-composition.yaml
```

이 파일들은 Stage 간 "기억"이다. `current-state.yaml`을 먼저 읽지 않으면 이미 완료된 Stage를 다시 실행하거나 잘못된 우선순위로 작업한다.

---

## 8. B_review 적대적 검증이 필요한 이유

### 8.1 A의 맹점

Stage A~E를 실행하는 에이전트(A)는 낙관적 편향을 갖는다.

- "이 테스트가 PASS이면 충분하다"
- "계약이 있으니 구현이 맞을 것이다"
- "불변조건이 선언됐으니 강제될 것이다"

실제로 Stage E 이전에 발견되지 않은 갭들:
- INV004(DONE 재할당 금지)가 capability.yaml에 누락 (GAP-001)
- `ApproveBillingExceptionUseCase`에 CONFLICT 사전 검사 없음 (GAP-B001 → P1)

### 8.2 B_review의 원칙

```
1. 재현 절차 없는 지적 → 추정 (낮은 우선순위)
2. 계약 변경 → semver/마이그레이션 평가 필수
3. P0/P1/P2 분류 + 최소 수정안 + 추가 테스트
4. 고위험 변경(계약/보안/동시성/금전) 우선
```

Hannay 외 2009 메타분석: 페어 프로그래밍은 특히 고위험 변경에서 품질 이점이 크다. B_review는 이를 구조화한 것이다.

---

## 9. 참고 문헌 및 벤치마크

| 출처 | 적용된 개념 |
|------|------------|
| Fowler (2015) "MonolithFirst" | 모놀리스 우선 전략 |
| Beyer 외 (2016) *Site Reliability Engineering* | Error Budget, SLO/SLA, Canary Rollout |
| Sporny 외 (2023) Backstage Docs | 플러그인 아키텍처 |
| Webpack Module Federation (2020) | 동적 모듈 로딩 패턴 |
| Richardson (2018) *Microservices Patterns* | Saga, 2PC, 서비스 메시 |
| Fowler (2004) *Patterns of Enterprise Application Architecture* | Feature Flag, Registry |
| Hannay 외 (2009) "Making software" Meta-analysis | 페어 리뷰 효과 |
| LaunchDarkly Feature Flag Best Practices (2022) | Feature flag 생명주기 |

---

*이 문서는 Diátaxis Explanation 유형이다. "어떻게"가 아니라 "왜"를 설명한다. 구체적인 사용 절차는 `HOW_TO_USE.md`를 참고하라.*
