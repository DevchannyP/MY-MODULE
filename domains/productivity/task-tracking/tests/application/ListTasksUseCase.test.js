'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ListTasksUseCase }            = require('../../src/application/ListTasksUseCase');
const { CreateTaskUseCase }           = require('../../src/application/CreateTaskUseCase');
const { InMemoryTaskRepository }      = require('../../src/infrastructure/InMemoryTaskRepository');

function makeSetup() {
  const repo     = new InMemoryTaskRepository();
  const listUC   = new ListTasksUseCase(repo);
  const createUC = new CreateTaskUseCase(repo);
  return { repo, listUC, createUC };
}

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe('ListTasksUseCase', () => {
  test('빈 저장소 → items=[], total=0', async () => {
    const { listUC } = makeSetup();
    const result = await listUC.execute({});
    assert.equal(result.total, 0);
    assert.deepEqual(result.items, []);
  });

  test('작업 3개 → total=3, items 반환', async () => {
    const { listUC, createUC } = makeSetup();
    for (let i = 1; i <= 3; i++) {
      await createUC.execute({ title: `작업${i}`, assignee_id: `user-${i}`, due_date: tomorrow });
    }
    const result = await listUC.execute({});
    assert.equal(result.total, 3);
    assert.equal(result.items.length, 3);
  });

  test('assignee_id 필터 동작', async () => {
    const { listUC, createUC } = makeSetup();
    await createUC.execute({ title: '작업A', assignee_id: 'user-A', due_date: tomorrow });
    await createUC.execute({ title: '작업B', assignee_id: 'user-B', due_date: tomorrow });
    const result = await listUC.execute({ assignee_id: 'user-A' });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].assignee_id, 'user-A');
  });

  test('페이지네이션: page_size=1', async () => {
    const { listUC, createUC } = makeSetup();
    for (let i = 1; i <= 3; i++) {
      await createUC.execute({ title: `작업${i}`, assignee_id: 'user-1', due_date: tomorrow });
    }
    const result = await listUC.execute({ page: 1, page_size: 1 });
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 3);
    assert.equal(result.page, 1);
  });

  test('items의 각 snapshot에 id/title/status 포함', async () => {
    const { listUC, createUC } = makeSetup();
    await createUC.execute({ title: '작업', assignee_id: 'user-1', due_date: tomorrow });
    const result = await listUC.execute({});
    const item = result.items[0];
    assert.ok('id' in item);
    assert.ok('title' in item);
    assert.ok('status' in item);
  });
});
