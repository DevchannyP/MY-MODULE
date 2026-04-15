'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveTaskRepository,
} = require('../../server/createServer');
const { InMemoryTaskRepository } = require('../../../domains/productivity/task-tracking/src/infrastructure/InMemoryTaskRepository');
const { PostgresTaskRepository } = require('../../../domains/productivity/task-tracking/src/infrastructure/PostgresTaskRepository');

let SQLiteTaskRepository;
try {
  ({ SQLiteTaskRepository } = require('../../../domains/productivity/task-tracking/src/infrastructure/SQLiteTaskRepository'));
} catch {
  SQLiteTaskRepository = null;
}

test('[task repository routing] sqlite 선택 시 SQLiteTaskRepository를 반환한다', () => {
  if (!SQLiteTaskRepository) {
    return;
  }

  const repo = resolveTaskRepository({
    dbType: 'sqlite',
    sqliteDbPath: ':memory:',
  });

  assert.ok(repo instanceof SQLiteTaskRepository);
  repo.close();
});

test('[task repository routing] postgres 선택 시 PostgresTaskRepository를 반환한다', () => {
  const fakeClient = { query: async () => ({ rows: [], rowCount: 0 }) };
  const repo = resolveTaskRepository({
    dbType: 'postgres',
    postgresClient: fakeClient,
  });

  assert.ok(repo instanceof PostgresTaskRepository);
});

test('[task repository routing] postgres 미구성 client는 명시적 오류를 던진다', async () => {
  const repo = resolveTaskRepository({
    dbType: 'postgres',
  });

  await assert.rejects(
    () => repo.findById('task-missing'),
    (error) => {
      assert.equal(error.code, 'POSTGRES_CLIENT_NOT_CONFIGURED');
      return true;
    },
  );
});

test('[task repository routing] inmemory 선택 시 InMemoryTaskRepository를 반환한다', () => {
  const repo = resolveTaskRepository({
    dbType: 'inmemory',
  });

  assert.ok(repo instanceof InMemoryTaskRepository);
});

test('[task repository routing] 지원하지 않는 DB_TYPE은 즉시 실패한다', () => {
  assert.throws(
    () => resolveTaskRepository({ dbType: 'mongo' }),
    /Unsupported DB_TYPE/,
  );
});
