'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const { TaskController }              = require('../../src/interface/TaskController');
const { CreateTaskUseCase }           = require('../../src/application/CreateTaskUseCase');
const { GetTaskUseCase }              = require('../../src/application/GetTaskUseCase');
const { ListTasksUseCase }            = require('../../src/application/ListTasksUseCase');
const { TransitionTaskStatusUseCase } = require('../../src/application/TransitionTaskStatusUseCase');
const { ReassignTaskUseCase }         = require('../../src/application/ReassignTaskUseCase');
const { InMemoryTaskRepository }      = require('../../src/infrastructure/InMemoryTaskRepository');

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function makeCtrl() {
  const repo = new InMemoryTaskRepository();
  return {
    ctrl: new TaskController({
      createTask:           new CreateTaskUseCase(repo),
      getTask:              new GetTaskUseCase(repo),
      listTasks:            new ListTasksUseCase(repo),
      transitionTaskStatus: new TransitionTaskStatusUseCase(repo),
      reassignTask:         new ReassignTaskUseCase(repo),
    }),
    repo,
  };
}

const READER  = { userId: 'u1', permissions: ['task:read'] };
const WRITER  = { userId: 'u2', permissions: ['task:read', 'task:write'] };
const NOBODY  = { userId: 'u3', permissions: [] };

function futureDate(days = 30) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── 1. POST /tasks — 권한 ────────────────────────────────────────────────────

describe('POST /tasks — 권한', () => {
  it('task:write 없으면 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/tasks',
      body: { title: '테스트', assignee_id: 'u1', due_date: futureDate() },
      caller: READER,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
  });

  it('task:write 있으면 201', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/tasks',
      body: { title: '테스트 작업', assignee_id: 'u1', due_date: futureDate() },
      caller: WRITER,
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.task_id);
    assert.equal(res.body.status, 'PENDING');
  });

  it('권한 없음(빈 배열) → 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/tasks',
      body: { title: '테스트', assignee_id: 'u1' },
      caller: NOBODY,
    });
    assert.equal(res.status, 403);
  });
});

// ── 2. POST /tasks — 입력 검증 ───────────────────────────────────────────────

describe('POST /tasks — 입력 검증', () => {
  it('assignee_id 없으면 400 (INV001)', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/tasks',
      body: { title: '제목만', due_date: futureDate() },
      caller: WRITER,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  it('title 없으면 400', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/tasks',
      body: { assignee_id: 'u1', due_date: futureDate() },
      caller: WRITER,
    });
    assert.equal(res.status, 400);
  });

  it('과거 due_date → 400 (INV003)', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'POST', path: '/tasks',
      body: { title: '제목', assignee_id: 'u1', due_date: '2020-01-01' },
      caller: WRITER,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });
});

// ── 3. GET /tasks — 권한 ─────────────────────────────────────────────────────

describe('GET /tasks — 권한', () => {
  it('task:read 없으면 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/tasks',
      query: {},
      caller: NOBODY,
    });
    assert.equal(res.status, 403);
  });

  it('task:read 있으면 200', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/tasks',
      query: {},
      caller: READER,
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
  });

  it('task:write만 있어도 read 가능', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/tasks',
      query: {},
      caller: WRITER,
    });
    assert.equal(res.status, 200);
  });

  it('[회귀] invalid page_size → 400', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/tasks',
      query: { page_size: '0' },
      caller: READER,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });
});

// ── 4. GET /tasks/{task_id} — 권한·조회 ──────────────────────────────────────

describe('GET /tasks/{task_id}', () => {
  let taskId;
  let ctrl;

  before(async () => {
    const setup = makeCtrl();
    ctrl = setup.ctrl;
    const res = await ctrl.handle({
      method: 'POST', path: '/tasks',
      body: { title: '조회 테스트', assignee_id: 'u1', due_date: futureDate() },
      caller: WRITER,
    });
    taskId = res.body.task_id;
  });

  it('task:read 없으면 403', async () => {
    const res = await ctrl.handle({
      method: 'GET', path: `/tasks/${taskId}`,
      params: { task_id: taskId },
      caller: NOBODY,
    });
    assert.equal(res.status, 403);
  });

  it('존재하는 작업 조회 → 200', async () => {
    const res = await ctrl.handle({
      method: 'GET', path: `/tasks/${taskId}`,
      params: { task_id: taskId },
      caller: READER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.task_id, taskId);
    assert.equal(res.body.title, '조회 테스트');
  });

  it('존재하지 않는 task_id → 404', async () => {
    const res = await ctrl.handle({
      method: 'GET', path: '/tasks/nonexistent-id',
      params: { task_id: 'nonexistent-id' },
      caller: READER,
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'NOT_FOUND');
  });
});

// ── 5. PATCH /tasks/{task_id}/status — 권한 ──────────────────────────────────

describe('PATCH /tasks/{task_id}/status — 권한', () => {
  it('task:write 없으면 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'PATCH', path: '/tasks/some-id/status',
      body: { new_status: 'IN_PROGRESS' },
      caller: READER,
    });
    assert.equal(res.status, 403);
  });
});

// ── 6. PATCH /tasks/{task_id}/status — 상태 전이 ─────────────────────────────

describe('PATCH /tasks/{task_id}/status — 상태 전이', () => {
  let taskId;
  let ctrl;

  before(async () => {
    const setup = makeCtrl();
    ctrl = setup.ctrl;
    const res = await ctrl.handle({
      method: 'POST', path: '/tasks',
      body: { title: '상태전이 테스트', assignee_id: 'u1', due_date: futureDate() },
      caller: WRITER,
    });
    taskId = res.body.task_id;
  });

  it('PENDING → IN_PROGRESS → 200', async () => {
    const res = await ctrl.handle({
      method: 'PATCH', path: `/tasks/${taskId}/status`,
      body: { new_status: 'IN_PROGRESS' },
      caller: WRITER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.new_status, 'IN_PROGRESS');
  });

  it('IN_PROGRESS → DONE → 200', async () => {
    const res = await ctrl.handle({
      method: 'PATCH', path: `/tasks/${taskId}/status`,
      body: { new_status: 'DONE' },
      caller: WRITER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.new_status, 'DONE');
  });

  it('DONE → IN_PROGRESS 역전이 → 409 (INV002)', async () => {
    const res = await ctrl.handle({
      method: 'PATCH', path: `/tasks/${taskId}/status`,
      body: { new_status: 'IN_PROGRESS' },
      caller: WRITER,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'CONFLICT');
  });

  it('존재하지 않는 taskId → 404', async () => {
    const res = await ctrl.handle({
      method: 'PATCH', path: '/tasks/bad-id/status',
      body: { new_status: 'IN_PROGRESS' },
      caller: WRITER,
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'NOT_FOUND');
  });
});

// ── 7. PATCH /tasks/{task_id}/assignee — 권한 ────────────────────────────────

describe('PATCH /tasks/{task_id}/assignee — 권한', () => {
  it('task:write 없으면 403', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'PATCH', path: '/tasks/some-id/assignee',
      body: { new_assignee_id: 'u2' },
      caller: READER,
    });
    assert.equal(res.status, 403);
  });
});

// ── 8. PATCH /tasks/{task_id}/assignee — 담당자 변경 ─────────────────────────

describe('PATCH /tasks/{task_id}/assignee — 담당자 변경', () => {
  let taskId;
  let ctrl;

  before(async () => {
    const setup = makeCtrl();
    ctrl = setup.ctrl;
    const res = await ctrl.handle({
      method: 'POST', path: '/tasks',
      body: { title: '담당자 변경 테스트', assignee_id: 'u1', due_date: futureDate() },
      caller: WRITER,
    });
    taskId = res.body.task_id;
  });

  it('PENDING 작업 담당자 변경 → 200', async () => {
    const res = await ctrl.handle({
      method: 'PATCH', path: `/tasks/${taskId}/assignee`,
      body: { new_assignee_id: 'u2' },
      caller: WRITER,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.assignee_id, 'u2');
  });

  it('DONE 작업 담당자 변경 → 409 (INV004)', async () => {
    // 먼저 DONE으로 전이
    await ctrl.handle({
      method: 'PATCH', path: `/tasks/${taskId}/status`,
      body: { new_status: 'IN_PROGRESS' },
      caller: WRITER,
    });
    await ctrl.handle({
      method: 'PATCH', path: `/tasks/${taskId}/status`,
      body: { new_status: 'DONE' },
      caller: WRITER,
    });
    const res = await ctrl.handle({
      method: 'PATCH', path: `/tasks/${taskId}/assignee`,
      body: { new_assignee_id: 'u3' },
      caller: WRITER,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'CONFLICT');
  });

  it('new_assignee_id 없으면 400 (INV001)', async () => {
    const setup2 = makeCtrl();
    const res1 = await setup2.ctrl.handle({
      method: 'POST', path: '/tasks',
      body: { title: '빈 담당자 테스트', assignee_id: 'u1', due_date: futureDate() },
      caller: WRITER,
    });
    const res = await setup2.ctrl.handle({
      method: 'PATCH', path: `/tasks/${res1.body.task_id}/assignee`,
      body: { new_assignee_id: '' },
      caller: WRITER,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  it('존재하지 않는 task_id → 404', async () => {
    const res = await ctrl.handle({
      method: 'PATCH', path: '/tasks/nonexistent/assignee',
      body: { new_assignee_id: 'u2' },
      caller: WRITER,
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'NOT_FOUND');
  });
});

// ── 9. correlationId 전파 ────────────────────────────────────────────────────

describe('correlationId 전파', () => {
  it('오류 응답에 correlationId 포함', async () => {
    const { ctrl } = makeCtrl();
    const res = await ctrl.handle({
      method: 'GET', path: '/tasks/no-such-task',
      caller: READER,
      correlationId: 'test-corr-123',
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.correlationId, 'test-corr-123');
  });
});
