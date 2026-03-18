'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { TaskController }              = require('../../src/interface/TaskController');
const { CreateTaskUseCase }           = require('../../src/application/CreateTaskUseCase');
const { GetTaskUseCase }              = require('../../src/application/GetTaskUseCase');
const { ListTasksUseCase }            = require('../../src/application/ListTasksUseCase');
const { TransitionTaskStatusUseCase } = require('../../src/application/TransitionTaskStatusUseCase');
const { ReassignTaskUseCase }         = require('../../src/application/ReassignTaskUseCase');
const { InMemoryTaskRepository }      = require('../../src/infrastructure/InMemoryTaskRepository');

function makeCtrl() {
  const repo = new InMemoryTaskRepository();
  return new TaskController({
    createTask: new CreateTaskUseCase(repo),
    getTask: new GetTaskUseCase(repo),
    listTasks: new ListTasksUseCase(repo),
    transitionTaskStatus: new TransitionTaskStatusUseCase(repo),
    reassignTask: new ReassignTaskUseCase(repo),
  });
}

const READER = { userId: 'reader-1', permissions: ['task:read'] };
const WRITER = { userId: 'writer-1', permissions: ['task:read', 'task:write'] };
const NOBODY = { userId: 'nobody-1', permissions: [] };

function futureDate(days = 30) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

test('[task-management smoke] 생성 후 상세 조회 성공', async () => {
  const ctrl = makeCtrl();
  const created = await ctrl.handle({
    method: 'POST',
    path: '/tasks',
    body: { title: 'smoke-task', assignee_id: 'user-1', due_date: futureDate() },
    caller: WRITER,
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.task_id);

  const fetched = await ctrl.handle({
    method: 'GET',
    path: `/tasks/${created.body.task_id}`,
    caller: READER,
  });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.task_id, created.body.task_id);
});

test('[task-management smoke] 권한 없는 목록 조회 거부', async () => {
  const ctrl = makeCtrl();
  const res = await ctrl.handle({
    method: 'GET',
    path: '/tasks',
    query: {},
    caller: NOBODY,
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
});

test('[task-management smoke] 존재하지 않는 작업 조회는 404', async () => {
  const ctrl = makeCtrl();
  const res = await ctrl.handle({
    method: 'GET',
    path: '/tasks/missing-task',
    caller: READER,
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
});
