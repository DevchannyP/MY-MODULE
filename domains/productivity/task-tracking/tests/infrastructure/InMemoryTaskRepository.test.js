'use strict';

/**
 * InMemoryTaskRepository 계약 테스트
 *
 * 벤치마킹: Hexagonal Architecture (Cockburn) + Clean Architecture (Martin) —
 *   인메모리 어댑터는 SQLite/RDB 어댑터와 동일한 포트 계약을 충족해야 한다.
 *   이 테스트가 SQLiteTaskRepository.test.js와 동일한 핵심 케이스를 커버함으로써
 *   어댑터 교체 시 계약 동등성을 보장한다 (Liskov Substitution).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryTaskRepository } = require('../../src/infrastructure/InMemoryTaskRepository');
const { CreateTaskUseCase }       = require('../../src/application/CreateTaskUseCase');

function makeRepo() { return new InMemoryTaskRepository(); }

async function seedTask(repo, overrides = {}) {
  const uc = new CreateTaskUseCase(repo);
  return uc.execute({
    title:       overrides.title       || '기본 작업',
    assignee_id: overrides.assignee_id || 'user-1',
    due_date:    overrides.due_date    || null,
  }, { userId: 'seed', permissions: ['task:read', 'task:write'] });
}

describe('InMemoryTaskRepository — 계약 테스트', () => {
  // ── 기본 CRUD ──────────────────────────────────────────────────────────────
  test('save → findById 반환', async () => {
    const repo = makeRepo();
    const created = await seedTask(repo);
    const found = await repo.findById(created.task_id);
    assert.ok(found, 'findById가 null 반환');
    assert.equal(found.id, created.task_id);
    assert.equal(found.title, '기본 작업');
  });

  test('없는 ID → findById null 반환', async () => {
    const repo = makeRepo();
    const found = await repo.findById('no-such-id');
    assert.equal(found, null);
  });

  test('findAll 빈 저장소 → total=0, items=[]', async () => {
    const repo = makeRepo();
    const result = await repo.findAll();
    assert.equal(result.total, 0);
    assert.equal(result.items.length, 0);
  });

  // ── 필터링 ────────────────────────────────────────────────────────────────
  test('assignee_id 필터 — 해당 담당자의 작업만 반환', async () => {
    const repo = makeRepo();
    await seedTask(repo, { assignee_id: 'user-A' });
    await seedTask(repo, { assignee_id: 'user-B', title: '다른 작업' });
    const result = await repo.findAll({ assignee_id: 'user-A' });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].assignee_id, 'user-A');
  });

  test('status 필터 — PENDING 작업만 반환', async () => {
    const repo = makeRepo();
    await seedTask(repo);
    const result = await repo.findAll({ status: 'PENDING' });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].status, 'PENDING');
  });

  test('status 필터 — 존재하지 않는 상태 → 빈 결과', async () => {
    const repo = makeRepo();
    await seedTask(repo);
    const result = await repo.findAll({ status: 'IN_PROGRESS' });
    assert.equal(result.total, 0);
  });

  test('due_before 필터 — 마감일이 지정일 이전인 작업만 반환', async () => {
    const repo = makeRepo();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const nextWeek  = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await seedTask(repo, { due_date: tomorrow, title: '내일 마감' });
    await seedTask(repo, { due_date: nextWeek,  title: '다음주 마감' });
    const cutoff = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const result = await repo.findAll({ due_before: cutoff });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].title, '내일 마감');
  });

  // ── 페이지네이션 ───────────────────────────────────────────────────────────
  test('페이지네이션 — page=1, page_size=1 → 첫 번째 항목만', async () => {
    const repo = makeRepo();
    await seedTask(repo, { title: 'A' });
    await seedTask(repo, { title: 'B' });
    const result = await repo.findAll({ page: 1, page_size: 1 });
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 2);
  });

  test('페이지네이션 — page=2, page_size=1 → 두 번째 항목', async () => {
    const repo = makeRepo();
    await seedTask(repo, { title: 'A' });
    await seedTask(repo, { title: 'B' });
    const result = await repo.findAll({ page: 2, page_size: 1 });
    assert.equal(result.items.length, 1);
  });

  // ── 불변성 검증 ───────────────────────────────────────────────────────────
  test('저장된 task는 재구성 시 원본 값을 유지 (snapshot round-trip)', async () => {
    const repo = makeRepo();
    const created = await seedTask(repo, { title: '스냅샷 테스트' });
    const found = await repo.findById(created.task_id);
    assert.equal(found.title, '스냅샷 테스트');
    assert.equal(found.assignee_id, 'user-1');
    assert.equal(found.status, 'PENDING');
  });
});
