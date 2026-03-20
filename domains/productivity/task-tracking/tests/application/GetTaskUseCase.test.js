'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { GetTaskUseCase }              = require('../../src/application/GetTaskUseCase');
const { CreateTaskUseCase }           = require('../../src/application/CreateTaskUseCase');
const { InMemoryTaskRepository }      = require('../../src/infrastructure/InMemoryTaskRepository');

function makeSetup() {
  const repo     = new InMemoryTaskRepository();
  const getUC    = new GetTaskUseCase(repo);
  const createUC = new CreateTaskUseCase(repo);
  return { repo, getUC, createUC };
}

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe('GetTaskUseCase', () => {
  test('존재하는 task_id → snapshot 반환', async () => {
    const { getUC, createUC } = makeSetup();
    const created = await createUC.execute({ title: '작업1', assignee_id: 'user-1', due_date: tomorrow });
    const result = await getUC.execute({ task_id: created.task_id });
    assert.equal(result.id, created.task_id);
    assert.equal(result.title, '작업1');
    assert.equal(result.assignee_id, 'user-1');
  });

  test('존재하지 않는 task_id → Error throw', async () => {
    const { getUC } = makeSetup();
    await assert.rejects(
      () => getUC.execute({ task_id: 'nonexistent' }),
      /찾을 수 없습니다/,
    );
  });

  test('snapshot에 status 필드 포함됨', async () => {
    const { getUC, createUC } = makeSetup();
    const created = await createUC.execute({ title: '작업2', assignee_id: 'user-2', due_date: tomorrow });
    const result = await getUC.execute({ task_id: created.task_id });
    assert.ok('status' in result);
    assert.equal(result.status, 'PENDING');
  });
});
