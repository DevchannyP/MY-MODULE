'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ReassignTaskUseCase }         = require('../../src/application/ReassignTaskUseCase');
const { CreateTaskUseCase }           = require('../../src/application/CreateTaskUseCase');
const { TransitionTaskStatusUseCase } = require('../../src/application/TransitionTaskStatusUseCase');
const { InMemoryTaskRepository }      = require('../../src/infrastructure/InMemoryTaskRepository');

function makeSetup() {
  const repo         = new InMemoryTaskRepository();
  const reassignUC   = new ReassignTaskUseCase(repo);
  const createUC     = new CreateTaskUseCase(repo);
  const transitionUC = new TransitionTaskStatusUseCase(repo);
  return { repo, reassignUC, createUC, transitionUC };
}

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe('ReassignTaskUseCase', () => {
  test('PENDING 상태 작업 담당자 변경 성공', async () => {
    const { reassignUC, createUC } = makeSetup();
    const created = await createUC.execute({ title: '작업', assignee_id: 'user-1', due_date: tomorrow });
    const result = await reassignUC.execute({ task_id: created.task_id, new_assignee_id: 'user-2' });
    assert.equal(result.assignee_id, 'user-2');
  });

  test('IN_PROGRESS 상태 작업 담당자 변경 성공', async () => {
    const { reassignUC, createUC, transitionUC } = makeSetup();
    const created = await createUC.execute({ title: '작업', assignee_id: 'user-1', due_date: tomorrow });
    await transitionUC.execute({ task_id: created.task_id, new_status: 'IN_PROGRESS' });
    const result = await reassignUC.execute({ task_id: created.task_id, new_assignee_id: 'user-2' });
    assert.equal(result.assignee_id, 'user-2');
  });

  test('DONE 상태 작업 담당자 변경 불가 → Error', async () => {
    const { reassignUC, createUC, transitionUC } = makeSetup();
    const created = await createUC.execute({ title: '작업', assignee_id: 'user-1', due_date: tomorrow });
    await transitionUC.execute({ task_id: created.task_id, new_status: 'IN_PROGRESS' });
    await transitionUC.execute({ task_id: created.task_id, new_status: 'DONE' });
    await assert.rejects(
      () => reassignUC.execute({ task_id: created.task_id, new_assignee_id: 'user-2' }),
      /DONE/,
    );
  });

  test('존재하지 않는 task_id → Error', async () => {
    const { reassignUC } = makeSetup();
    await assert.rejects(
      () => reassignUC.execute({ task_id: 'nonexistent', new_assignee_id: 'user-2' }),
      /찾을 수 없습니다/,
    );
  });

  test('INV001: 빈 new_assignee_id → Error', async () => {
    const { reassignUC, createUC } = makeSetup();
    const created = await createUC.execute({ title: '작업', assignee_id: 'user-1', due_date: tomorrow });
    await assert.rejects(
      () => reassignUC.execute({ task_id: created.task_id, new_assignee_id: '' }),
      /INV001/,
    );
  });
});
