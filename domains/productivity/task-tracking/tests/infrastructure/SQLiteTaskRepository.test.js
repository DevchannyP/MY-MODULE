'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SQLiteTaskRepository } = require('../../src/infrastructure/SQLiteTaskRepository');
const { CreateTaskUseCase } = require('../../src/application/CreateTaskUseCase');

test('SQLiteTaskRepository는 저장 후 조회와 목록 조회를 지원한다', async () => {
  const repo = SQLiteTaskRepository.create(':memory:');
  const createTask = new CreateTaskUseCase(repo);

  try {
    const created = await createTask.execute({
      title: 'sqlite-task',
      assignee_id: 'user-1',
    }, { userId: 'test', permissions: ['task:read', 'task:write'] });

    const task = await repo.findById(created.task_id);
    assert.ok(task);
    assert.equal(task.id, created.task_id);
    assert.equal(task.title, 'sqlite-task');

    const listed = await repo.findAll({ assignee_id: 'user-1' });
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0].id, created.task_id);
  } finally {
    repo.close();
  }
});
