'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SCHEMA_PATH = path.join(
  REPO_ROOT,
  'domains/productivity/task-tracking/src/infrastructure/migrations/001_initial_pg.sql',
);

function readSchema(schemaPath = DEFAULT_SCHEMA_PATH) {
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`schema file not found: ${schemaPath}`);
  }
  return fs.readFileSync(schemaPath, 'utf8');
}

function assertMatch(text, pattern, message) {
  if (!pattern.test(text)) {
    throw new Error(message);
  }
}

function assertNoMatch(text, pattern, message) {
  if (pattern.test(text)) {
    throw new Error(message);
  }
}

function validatePostgresSchema(schemaText) {
  assertMatch(schemaText, /CREATE TABLE IF NOT EXISTS tasks\s*\(/i, 'tasks table definition missing');
  assertMatch(schemaText, /id\s+TEXT\s+NOT NULL\s+PRIMARY KEY/i, 'tasks.id TEXT PK missing');
  assertMatch(schemaText, /version\s+INTEGER\s+NOT NULL\s+DEFAULT\s+1/i, 'tasks.version optimistic lock column missing');

  assertMatch(schemaText, /CREATE TABLE IF NOT EXISTS task_outbox\s*\(/i, 'task_outbox table definition missing');
  assertMatch(schemaText, /payload\s+JSONB\s+NOT NULL/i, 'task_outbox.payload JSONB missing');
  assertMatch(schemaText, /delivered\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i, 'task_outbox.delivered BOOLEAN default missing');

  assertMatch(schemaText, /CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks\(assignee_id\)/i, 'tasks assignee index missing');
  assertMatch(schemaText, /CREATE INDEX IF NOT EXISTS idx_tasks_status\s+ON tasks\(status\)/i, 'tasks status index missing');
  assertMatch(schemaText, /CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks\(due_date\)\s+WHERE due_date IS NOT NULL/i, 'tasks due_date partial index missing');
  assertMatch(schemaText, /CREATE INDEX IF NOT EXISTS idx_outbox_pending ON task_outbox\(delivered, created_at\)\s+WHERE delivered = FALSE/i, 'task_outbox pending index missing');

  assertNoMatch(schemaText, /\bAUTOINCREMENT\b/i, 'SQLite AUTOINCREMENT token is not PostgreSQL-compatible');
  assertNoMatch(schemaText, /\bPRAGMA\b/i, 'SQLite PRAGMA token is not PostgreSQL-compatible');
  assertNoMatch(schemaText, /\bWITHOUT ROWID\b/i, 'SQLite WITHOUT ROWID token is not PostgreSQL-compatible');
}

function main() {
  const schemaPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : DEFAULT_SCHEMA_PATH;
  const schemaText = readSchema(schemaPath);
  validatePostgresSchema(schemaText);
  process.stdout.write(`schema validation PASS: ${path.relative(REPO_ROOT, schemaPath)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`schema validation FAIL: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  validatePostgresSchema,
  readSchema,
};
