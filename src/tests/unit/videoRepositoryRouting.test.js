'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveVideoRepositories,
} = require('../../server/createServer');
const { InMemoryVideoRepository } = require('../../../domains/video/src/infrastructure/InMemoryVideoRepository');
const { PostgresVideoRepository } = require('../../../domains/video/src/infrastructure/PostgresVideoRepository');

let SQLiteVideoRepository;
try {
  ({ SQLiteVideoRepository } = require('../../../domains/video/src/infrastructure/SQLiteVideoRepository'));
} catch {
  SQLiteVideoRepository = null;
}

test('[video repository routing] sqlite 선택 시 SQLiteVideoRepository를 반환한다', () => {
  if (!SQLiteVideoRepository) {
    return;
  }

  const { videoRepository } = resolveVideoRepositories({
    dbType: 'sqlite',
    sqliteDbPath: ':memory:',
  });

  assert.ok(videoRepository instanceof SQLiteVideoRepository);
});

test('[video repository routing] postgres 선택 시 PostgresVideoRepository를 반환한다', () => {
  const fakeClient = { query: async () => ({ rows: [], rowCount: 0 }) };
  const { videoRepository } = resolveVideoRepositories({
    dbType: 'postgres',
    postgresClient: fakeClient,
  });

  assert.ok(videoRepository instanceof PostgresVideoRepository);
});

test('[video repository routing] postgres 미구성 client는 명시적 오류를 던진다', async () => {
  const { videoRepository } = resolveVideoRepositories({
    dbType: 'postgres',
  });

  await assert.rejects(
    () => videoRepository.findById('video-missing'),
    (error) => {
      assert.equal(error.code, 'POSTGRES_CLIENT_NOT_CONFIGURED');
      return true;
    },
  );
});

test('[video repository routing] inmemory 선택 시 InMemoryVideoRepository를 반환한다', () => {
  const { videoRepository } = resolveVideoRepositories({
    dbType: 'inmemory',
  });

  assert.ok(videoRepository instanceof InMemoryVideoRepository);
});

test('[video repository routing] 지원하지 않는 DB_TYPE은 InMemory로 폴백한다', () => {
  const { videoRepository } = resolveVideoRepositories({ dbType: 'mongo' });
  assert.ok(videoRepository instanceof InMemoryVideoRepository);
});
