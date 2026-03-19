-- Task-Tracking Domain — SQLite Schema
-- Benchmark: Hexagonal Architecture (Cockburn), Flyway migration conventions
-- Version: 001 — initial

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT    NOT NULL PRIMARY KEY,    -- task-{timestamp}-{counter}
  title       TEXT    NOT NULL,
  assignee_id TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'PENDING',
  due_date    TEXT    NULL,                    -- ISO 8601 date or null
  description TEXT    NULL,
  created_at  TEXT    NOT NULL,               -- ISO 8601 datetime
  updated_at  TEXT    NOT NULL                -- ISO 8601 datetime
);

-- Index for common query patterns (list by assignee, filter by status)
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date) WHERE due_date IS NOT NULL;

-- Domain event outbox table (Transactional Outbox Pattern)
CREATE TABLE IF NOT EXISTS task_outbox (
  id          TEXT    NOT NULL PRIMARY KEY,    -- UUID
  event_type  TEXT    NOT NULL,               -- com.workflow-os.task.created.v1
  aggregate_id TEXT   NOT NULL,               -- task ID
  payload     TEXT    NOT NULL,               -- JSON CloudEvents envelope
  created_at  TEXT    NOT NULL,
  delivered   INTEGER NOT NULL DEFAULT 0      -- 0=pending, 1=delivered
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON task_outbox(delivered, created_at)
  WHERE delivered = 0;
