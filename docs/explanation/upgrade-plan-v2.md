# Workflow OS — 개선 계획 v2
# 세계 최고 수준 아키텍처 벤치마크 적용

> 작성일: 2026-03-19
> 근거: 전체 코드베이스 심층 분석 결과
> 기준: 아래 각 결함에 국내외 최고 솔루션을 매핑

---

## 1. 결함-1 → Transactional Outbox Pattern

**문제**
`CreateTaskUseCase`·`CreateInvoiceUseCase`가 도메인 이벤트를 `_events` 배열에 적재만 하고
실제 전달 메커니즘이 없다. 이벤트 버스·브로커 없음.

**세계 최고 솔루션**
- **Transactional Outbox Pattern** (Chris Richardson, microservices.io)
  - 도메인 이벤트를 DB 트랜잭션 안에서 `outbox` 테이블에 함께 저장
  - 별도 relay process가 outbox → broker로 전달 (CDC or polling)
  - 결과: at-least-once delivery, 원자성 보장
- **CloudEvents v1.0 spec** (CNCF)
  - 이벤트 봉투 표준화 (`specversion`, `id`, `source`, `type`, `datacontenttype`)
  - 브로커 독립적 → Kafka, RabbitMQ, HTTP webhook 모두 동일 스키마
- **AsyncAPI 3.0** (CNCF)
  - 이벤트 채널·메시지 스키마를 OpenAPI처럼 기계-가독 명세로 작성
  - 현재 `events.schema.json` 을 AsyncAPI 형식으로 업그레이드 가능

**적용 계획 (WP-EVT-001)**
```
1. events.schema.json → CloudEvents 봉투 스키마로 확장
2. UseCase에 EventPublisher 인터페이스 주입 (포트)
3. InMemoryEventPublisher (테스트용) + OutboxEventPublisher (프로덕션용) 구현
4. 이벤트 발행 테스트 추가 (이벤트가 실제로 발행됐는지 assert)
```

---

## 2. 결함-2 → Repository Pattern + Hexagonal Ports

**문제**
전체 도메인이 `InMemoryRepository`에 묶여 있음. 재시작 시 데이터 소멸.
DB 스키마·트랜잭션·마이그레이션 전혀 없음.

**세계 최고 솔루션**
- **Hexagonal Architecture** (Alistair Cockburn, Port & Adapter)
  - Repository는 도메인이 정의한 포트(인터페이스)
  - InMemory·SQLite·PostgreSQL 모두 동일 포트를 구현
  - 현재 구조가 이미 준비돼 있음 — 실제 어댑터만 부재
- **Test Containers** 패턴 (Testcontainers 프로젝트)
  - CI에서 실제 DB 컨테이너를 spin-up해 통합 테스트
  - Docker-in-Docker 없이 sqlite 기반으로 동일 효과 가능
- **Schema Migration** — Flyway/Liquibase 원칙
  - migration 파일을 버전관리하고 CI에서 자동 적용

**적용 계획 (WP-PERSIST-001)**
```
1. ITaskRepository 포트 인터페이스를 도메인 레이어에 명시
2. SQLiteTaskRepository 어댑터 구현 (단순, 외부 의존 없음)
3. schema.sql 작성 + migrate.js 스크립트
4. 통합 테스트를 실제 SQLite 파일 대상으로 실행
5. InMemory는 단위 테스트 전용으로 유지
```

---

## 3. 결함-3 → OpenFeature SDK + Runtime Evaluation

**문제**
`flags.yaml`에 6개 플래그가 정의됐지만 서버 wiring 코드와 컨트롤러 어디에도
`if (featureFlag.isEnabled('enable_task_management'))` 평가가 없음.

**세계 최고 솔루션**
- **OpenFeature SDK** (CNCF 표준, 2023 Sandbox 졸업)
  - 벤더 독립 Feature Flag 평가 표준 인터페이스
  - 로컬 JSON provider → LaunchDarkly/Flipt 등으로 투명 교체
  - 컨텍스트 기반 평가 (userId, environment, region)
- **Trunk-Based Development** (DORA 연구 권장)
  - Feature flag = 코드 브랜치 없이 기능 토글
  - 모든 코드는 main에, flag으로 활성화 시점 제어

**적용 계획 (WP-FLAG-001)**
```
1. src/infrastructure/FeatureFlagProvider.js — flags.yaml 읽는 로컬 provider
2. src/server/index.js — 서버 wiring 시 flag 평가 후 라우트 등록
3. TaskController.js — 미들웨어로 flag 체크 (enable_task_management)
4. 통합 테스트: flag=false일 때 404 반환 확인
```

---

## 4. 결함-4 → OpenTelemetry SDK 계측

**문제**
관측가능성 YAML 설정 완비. 그러나 실제 메트릭 수집·트레이스 계측 코드 없음.
`dashboard://` URL은 가짜 scheme.

**세계 최고 솔루션**
- **OpenTelemetry** (CNCF 최우선 관측가능성 표준)
  - Traces: `@opentelemetry/sdk-node` — 자동 HTTP 계측
  - Metrics: `@opentelemetry/sdk-metrics` — 커스텀 메트릭 recorder
  - Logs: structured JSON → stdout (12-factor app 원칙)
  - Collector-agnostic: OTLP → Jaeger / Prometheus / DataDog 어디든
- **SRE Error Budget** (Google SRE Book)
  - SLO (99.9% availability) → Error budget (43.2분/월)
  - 알림은 error budget burn rate 기반으로 설정
- **RED Method** (Tom Wilkie)
  - Rate, Errors, Duration 3개 메트릭으로 서비스 건강 측정

**적용 계획 (WP-OBS-001)**
```
1. @opentelemetry/sdk-node 최소 계측 설치 (devDependency 아님!)
2. src/server/telemetry.js — tracer/meter 초기화, OTLP exporter
3. TaskController에 span 추가: createSpan('task.create')
4. 메트릭 recorder: task_created_total, task_status_transition_total
5. 구조화 로깅: JSON(timestamp, level, trace_id, span_id, message)
6. check:observability 스크립트를 실제 계측 코드 존재 확인으로 업그레이드
```

---

## 5. 결함-5 → SLSA Level 2 + GitHub Actions Release Automation

**문제**
`generate:release-evidence`가 수동 실행. CI에 없음. KI-EVIDENCE-001 미해소.

**세계 최고 솔루션**
- **SLSA (Supply-chain Levels for Software Artifacts)** — Google/OpenSSF
  - Level 1: 출처 메타데이터 생성 (현재)
  - Level 2: 서명된 출처 + 빌드 서비스(GitHub Actions)에서만 생성
  - Level 3: 격리된 빌드 환경
- **sigstore cosign** — 아티팩트 서명 오픈소스 표준
  - GitHub Actions OIDC → keyless signing
- **GitHub Actions Environments + Protection Rules**
  - release environment는 main 브랜치 + 리뷰어 승인 필수

**적용 계획 (WP-GOV-001 — 기존 WP 이미 정의됨)**
```
1. .github/workflows/release.yml 추가
2. quality-gates.yml 통과 후 → generate:release-evidence 자동 실행
3. artifacts/ 를 GitHub Actions artifact로 upload
4. SLSA 출처 메타데이터에 workflow_run_id, sha, ref 포함
```

---

## 6. 결함-6 → CloudEvents + AsyncAPI Event Schema Registry

**문제**
billing ↔ task-tracking 간 공유 이벤트 봉투 스키마 없음.
도메인 간 이벤트 계약이 각자 `events.schema.json`에 고립.

**세계 최고 솔루션**
- **CloudEvents v1.0** (CNCF, AWS/Microsoft/Google 채택)
  - 공통 이벤트 봉투: `{ specversion, id, source, type, time, data }`
  - `source`: 도메인 URI (`//workflow-os/productivity/task-tracking`)
  - `type`: 역도메인 네이밍 (`com.workflow-os.task.created.v1`)
- **AsyncAPI Event Catalog** (Domain-Driven Event Design)
  - 중앙 `contracts/events/` 레지스트리
  - 각 도메인의 `events.schema.json`이 공통 봉투를 extend
- **Schema Registry 개념** (Confluent, AWS Glue 패턴)
  - 이벤트 스키마 버전 관리: `v1`, `v2`, backward-compatible 진화

**적용 계획 (WP-DOM-002 — 기존 WP)**
```
1. contracts/events/envelope.schema.json — CloudEvents 봉투 스키마
2. contracts/events/registry.yaml — 전체 이벤트 목록 + 버전
3. 각 도메인 events.schema.json이 봉투를 $ref로 참조
4. validate_contract_drift.py에 봉투 일치 검사 추가
```

---

## 7. 결함-7 → RFC 7807 Problem Details

**문제**
컨트롤러마다 에러 응답 형식 다름. 표준 없음.

**세계 최고 솔루션**
- **RFC 7807 Problem Details** (IETF 표준)
  ```json
  {
    "type": "https://workflow-os/errors/task-not-found",
    "title": "Task Not Found",
    "status": 404,
    "detail": "Task with ID 'abc' does not exist.",
    "instance": "/tasks/abc",
    "traceId": "4bf92f3577b34da6"
  }
  ```
  - Azure, GitHub API, Stripe API 모두 채택
  - OpenAPI 스펙의 `#/components/schemas/Problem` 으로 등록

**적용 계획 (WP-ERR-001)**
```
1. src/shared/ProblemDetails.js — RFC 7807 응답 생성 유틸
2. 모든 컨트롤러의 catch block을 ProblemDetails로 통일
3. openapi.yaml의 에러 응답 스키마를 Problem으로 업데이트
4. 에러 응답 일관성 테스트 추가
```

---

## 우선순위 실행 계획 (다음 WP 시퀀스)

```
Tier 1 — 기반 (병렬 가능)
  WP-ARCH-002  DAG CI 게이트 통합        ~2턴   [governance]
  WP-GOV-001   Release Evidence CI       ~3턴   [governance]
  WP-ERR-001   RFC 7807 에러 표준화      ~3턴   [domain]

Tier 2 — 핵심 구현 (순차)
  WP-EVT-001   Transactional Outbox       ~4턴   [domain]  → WP-ERR-001 이후
  WP-FLAG-001  Feature Flag 런타임         ~3턴   [domain]
  WP-OBS-001   OpenTelemetry 최소 계측     ~4턴   [domain]

Tier 3 — 확장 (Tier 2 이후)
  WP-PERSIST-001  SQLite 영속성 레이어     ~5턴   [domain]
  WP-DOM-002      Cross-Domain Event Bus  ~4턴   [domain]
  WP-2026-03-19-10  Video 도메인 Stage A  ~3턴   [domain]

Tier 4 — 자기개선 (상시)
  WP-META-001  Self-Improvement Loop     ~4턴   [meta]
```

---

## 기대 개선 효과

| 개선 항목 | 현재 | 목표 |
|---------|------|------|
| 이벤트 전달 보장 | 0% | 100% (Outbox) |
| 데이터 영속성 | 0% | SQLite 기반 |
| Feature Flag 런타임 | 0% | 100% 평가 |
| 메트릭 수집 | 0% | OpenTelemetry 계측 |
| 에러 응답 일관성 | ~30% | 100% RFC 7807 |
| Release Evidence 자동화 | 0% | CI 완전 자동 |
| 도메인 간 이벤트 계약 | 없음 | CloudEvents 봉투 |
| 운영 준비도 | 5/10 | 8/10 |
