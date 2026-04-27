-- Task-Tracking Domain — PostgreSQL Schema
-- Version: 001 — initial PostgreSQL adapter baseline
-- WP: WP-S18-003

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT    NOT NULL PRIMARY KEY,
  title       TEXT    NOT NULL,
  assignee_id TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'PENDING',
  due_date    TEXT    NULL,
  description TEXT    NULL,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date)
  WHERE due_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_outbox (
  id           TEXT    NOT NULL PRIMARY KEY,
  event_type   TEXT    NOT NULL,
  aggregate_id TEXT    NOT NULL,
  payload      JSONB   NOT NULL,
  created_at   TEXT    NOT NULL,
  delivered    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON task_outbox(delivered, created_at)
  WHERE delivered = FALSE;
