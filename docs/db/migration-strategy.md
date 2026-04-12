# 데이터베이스 마이그레이션 전략

> FR-041 이행 문서. 현재 SQLite 기반 단일 인스턴스에서 미래 수평 확장 구조로 전환할 때
> 도메인 코드 변경 없이 어댑터만 교체할 수 있도록 경로와 규칙을 고정한다.

---

## 현재 상태

| 항목 | 값 |
|------|----|
| 현재 DB | SQLite (단일 파일, 로컬 개발/단일 인스턴스) |
| 스키마 위치 | `domains/{domain}/src/infrastructure/schema.sql` |
| 마이그레이션 방식 | `CREATE TABLE IF NOT EXISTS` — 멱등성 DDL |
| 연결 | better-sqlite3 (동기, process-bound) |
| 도메인 | productivity/task-tracking (SQLite 구현체 존재), billing/video (InMemory) |

---

## 아키텍처 원칙

```
┌─────────────────────────────────────────────────────┐
│  Domain Core (불변)                                  │
│  ├─ Entity / Value Object                           │
│  ├─ Use Case                                        │
│  └─ Port (Repository Interface)  ◀── 공개 경계      │
└──────────────┬──────────────────────────────────────┘
               │ Port만 참조
┌──────────────▼──────────────────────────────────────┐
│  Infrastructure (교체 가능)                          │
│  ├─ SQLiteXxxRepository  ← 현재                     │
│  └─ PostgresXxxRepository ← 수평확장 시 교체        │
└─────────────────────────────────────────────────────┘
```

**Repository Port를 유지하면 인프라 어댑터만 교체된다. 도메인 코어는 변경 없음.**

---

## 스키마 명명 규칙

### 테이블 접두어 (도메인별 분리)

| 도메인 | 접두어 | 예시 |
|--------|--------|------|
| productivity/task-tracking | `task_` | `tasks`, `task_outbox` |
| billing | `billing_` | `billing_invoices`, `billing_payments` |
| video | `video_` | `video_contents`, `video_transcode_jobs` |

접두어 규칙 덕분에 PostgreSQL 전환 시 스키마를 유지한 채 별도 DB로 분리할 수 있다.

### 컬럼 규칙

```sql
-- PK: TEXT (UUID 또는 도메인 ID 형식)
id          TEXT NOT NULL PRIMARY KEY

-- 타임스탬프: ISO 8601 문자열 (SQLite 호환, PG에서도 동작)
created_at  TEXT NOT NULL
updated_at  TEXT NOT NULL

-- 상태: TEXT (Enum 역할, 도메인 상수와 1:1 매핑)
status      TEXT NOT NULL DEFAULT 'PENDING'
```

---

## 마이그레이션 파일 구조

```
domains/{domain}/src/infrastructure/
  schema.sql          ← 현재 스키마 (멱등성 DDL, 버전 태그 포함)
  migrations/
    001_initial.sql   ← 초기 스키마 (Flyway 명명 규칙)
    002_add_index.sql
    ...
```

### 버전 태그 형식 (SQL 주석)

```sql
-- {domain} Domain — SQLite Schema
-- Version: NNN — {설명}
-- Migration: 이전 버전에서 변경된 사항
```

---

## SQLite → PostgreSQL 전환 경로

### Phase 1: 포트 고정 (완료)

- [x] Repository Port (인터페이스) 정의
- [x] InMemory 구현체 (테스트용)
- [x] SQLite 구현체 (개발/단일 인스턴스)

### Phase 2: PostgreSQL 어댑터 (전환 시)

트리거 조건: 단일 프로세스 write 처리량 > 1,000 TPS 또는 다중 인스턴스 배포 필요 시

```
domains/{domain}/src/infrastructure/
  PostgresXxxRepository.js   ← Port를 그대로 구현
  migrations/                ← psql 호환 DDL
```

변경 범위:
- `PostgresXxxRepository.js` 작성
- DI 설정(master-shell plugin-registry)에서 어댑터 교체
- **도메인 코어/유스케이스 변경 없음**

### Phase 3: 연결 풀 (수평 확장 시)

```
현재:  better-sqlite3 (single-process, synchronous)
전환:  pg pool (async, max 10 per process)
확장:  PgBouncer (transaction pooling, multi-instance)
```

---

## 인덱스 정책

> 쿼리 패턴을 먼저 확정한 후 인덱스를 추가한다. 선제적 인덱스 금지.

현재 확정된 인덱스 (task-tracking):

```sql
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);     -- list by assignee
CREATE INDEX idx_tasks_status   ON tasks(status);          -- filter by status
CREATE INDEX idx_tasks_due_date ON tasks(due_date)         -- date range filter
  WHERE due_date IS NOT NULL;
CREATE INDEX idx_outbox_pending ON task_outbox(delivered, created_at)
  WHERE delivered = 0;                                     -- Outbox polling
```

---

## 낙관적 잠금 정책

**현재**: InMemory 구현체는 낙관적 잠금 없음 (ADR-0003 결정, 단일 프로세스 허용)

**PostgreSQL 전환 시**:
```sql
-- version 컬럼 추가
ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- 업데이트 시 version 검사
UPDATE tasks SET ..., version = version + 1
WHERE id = $1 AND version = $2;
-- affected rows = 0 → OptimisticLockConflict 예외
```

ADR 참조: `docs/adr/0003-optimistic-locking-policy.md`

---

## 자료사전 동기화 의무

계약(`contracts/*.yaml`) 또는 스키마(`schema.sql`) 변경 시:

1. `docs/reference/ai-harness-data-dictionary.md` 업데이트 (NFR FR-042 location)
2. 변경된 도메인의 `capability.yaml`에 schema_version 증가
3. `npm run test:contract` 재실행으로 드리프트 확인

FR-042 참조: `requirements/harness-engineering.yaml#FR-042`

---

## 검증 명령

```bash
# 현재 SQLite 스키마 유효성
npm run db:migrate:test

# 전체 Repository 테스트 (포트 계약 포함)
npm test

# 계약 드리프트 확인
npm run test:contract
```

---

*이 문서는 `docs/db/migration-strategy.md`에 위치합니다.*  
*스키마 변경 시 이 문서와 `ai-harness-data-dictionary.md`를 동시에 갱신하세요.*
