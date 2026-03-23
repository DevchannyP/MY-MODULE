'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { TransitionTaskStatusUseCase } = require('../../src/application/TransitionTaskStatusUseCase');
const { CreateTaskUseCase }           = require('../../src/application/CreateTaskUseCase');
const { InMemoryTaskRepository }      = require('../../src/infrastructure/InMemoryTaskRepository');

const WRITE_CALLER = { userId: 'test-user', permissions: ['task:read', 'task:write'] };

function makeSetup() {
  const repo         = new InMemoryTaskRepository();
  const transitionUC = new TransitionTaskStatusUseCase(repo);
  const createUC     = new CreateTaskUseCase(repo);
  return { repo, transitionUC, createUC };
}

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe('TransitionTaskStatusUseCase', () => {
  test('PENDING → IN_PROGRESS 전이 성공', async () => {
    const { transitionUC, createUC } = makeSetup();
    const created = await createUC.execute({ title: '작업', assignee_id: 'user-1', due_date: tomorrow }, WRITE_CALLER);
    const result = await transitionUC.execute({ task_id: created.task_id, new_status: 'IN_PROGRESS' }, WRITE_CALLER);
    assert.equal(result.new_status, 'IN_PROGRESS');
    assert.equal(result.old_status, 'PENDING');
  });

  test('IN_PROGRESS → DONE 전이 성공', async () => {
    const { transitionUC, createUC } = makeSetup();
    const created = await createUC.execute({ title: '작업', assignee_id: 'user-1', due_date: tomorrow }, WRITE_CALLER);
    await transitionUC.execute({ task_id: created.task_id, new_status: 'IN_PROGRESS' }, WRITE_CALLER);
    const result = await transitionUC.execute({ task_id: created.task_id, new_status: 'DONE' }, WRITE_CALLER);
    assert.equal(result.new_status, 'DONE');
  });

  test('PENDING → DONE 직접 전이 불가 (INV002)', async () => {
    const { transitionUC, createUC } = makeSetup();
    const created = await createUC.execute({ title: '작업', assignee_id: 'user-1', due_date: tomorrow }, WRITE_CALLER);
    await assert.rejects(
      () => transitionUC.execute({ task_id: created.task_id, new_status: 'DONE' }, WRITE_CALLER),
      /INV002|전이|불가/i,
    );
  });

  test('DONE → 다시 IN_PROGRESS 불가 (terminal 상태)', async () => {
    const { transitionUC, createUC } = makeSetup();
    const created = await createUC.execute({ title: '작업', assignee_id: 'user-1', due_date: tomorrow }, WRITE_CALLER);
    await transitionUC.execute({ task_id: created.task_id, new_status: 'IN_PROGRESS' }, WRITE_CALLER);
    await transitionUC.execute({ task_id: created.task_id, new_status: 'DONE' }, WRITE_CALLER);
    await assert.rejects(
      () => transitionUC.execute({ task_id: created.task_id, new_status: 'IN_PROGRESS' }, WRITE_CALLER),
      /INV002|전이|불가/i,
    );
  });

  test('존재하지 않는 task_id → Error', async () => {
    const { transitionUC } = makeSetup();
    await assert.rejects(
      () => transitionUC.execute({ task_id: 'nonexistent', new_status: 'IN_PROGRESS' }, WRITE_CALLER),
      /찾을 수 없습니다/,
    );
  });

  // ── 에러 코드 회귀 테스트 ────────────────────────────────────────────────────
  test('[회귀] INV002 상태 전이 불가 → code=CONFLICT (HTTP 409 보장)', async () => {
    const { transitionUC, createUC } = makeSetup();
    const created = await createUC.execute({ title: '작업', assignee_id: 'user-1', due_date: tomorrow }, WRITE_CALLER);
    await assert.rejects(
      () => transitionUC.execute({ task_id: created.task_id, new_status: 'DONE' }, WRITE_CALLER),
      err => { assert.equal(err.code, 'CONFLICT'); return true; },
    );
  });

  test('[회귀] 존재하지 않는 task_id → code=NOT_FOUND (HTTP 404 보장)', async () => {
    const { transitionUC } = makeSetup();
    await assert.rejects(
      () => transitionUC.execute({ task_id: 'ghost', new_status: 'IN_PROGRESS' }, WRITE_CALLER),
      err => { assert.equal(err.code, 'NOT_FOUND'); return true; },
    );
  });

  test('result에 task_id/old_status/new_status 포함', async () => {
    const { transitionUC, createUC } = makeSetup();
    const created = await createUC.execute({ title: '작업', assignee_id: 'user-1', due_date: tomorrow }, WRITE_CALLER);
    const result = await transitionUC.execute({ task_id: created.task_id, new_status: 'IN_PROGRESS' }, WRITE_CALLER);
    assert.ok('task_id' in result);
    assert.ok('old_status' in result);
    assert.ok('new_status' in result);
  });
});
