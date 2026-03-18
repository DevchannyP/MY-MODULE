'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { CreateTaskUseCase } = require('../../src/application/CreateTaskUseCase');
const { GetTaskUseCase } = require('../../src/application/GetTaskUseCase');
const { ListTasksUseCase } = require('../../src/application/ListTasksUseCase');
const { TransitionTaskStatusUseCase } = require('../../src/application/TransitionTaskStatusUseCase');
const { ReassignTaskUseCase } = require('../../src/application/ReassignTaskUseCase');
const { InMemoryTaskRepository } = require('../../src/infrastructure/InMemoryTaskRepository');

describe('CreateTaskUseCase', () => {
  test('작업 생성 후 조회 가능 (create-task → get-task capability 흐름)', async () => {
    const repo = new InMemoryTaskRepository();
    const createUC = new CreateTaskUseCase(repo);
    const getUC    = new GetTaskUseCase(repo);

    const result = await createUC.execute({ title: '통합 테스트 작업', assignee_id: 'user-1' });
    assert.ok(result.task_id);
    assert.equal(result.status, 'PENDING');

    const task = await getUC.execute({ task_id: result.task_id });
    assert.equal(task.title, '통합 테스트 작업');
    assert.equal(task.assignee_id, 'user-1');
  });

  test('[INV001] 담당자 없으면 에러', async () => {
    const repo = new InMemoryTaskRepository();
    const uc = new CreateTaskUseCase(repo);
    await assert.rejects(() => uc.execute({ title: '제목' }), /\[INV001\]/);
  });
});

describe('ListTasksUseCase', () => {
  test('필터 없이 전체 조회', async () => {
    const repo = new InMemoryTaskRepository();
    const createUC = new CreateTaskUseCase(repo);
    const listUC   = new ListTasksUseCase(repo);

    await createUC.execute({ title: '작업1', assignee_id: 'u1' });
    await createUC.execute({ title: '작업2', assignee_id: 'u2' });

    const result = await listUC.execute();
    assert.equal(result.total, 2);
    assert.equal(result.items.length, 2);
  });

  test('담당자 필터링', async () => {
    const repo = new InMemoryTaskRepository();
    const createUC = new CreateTaskUseCase(repo);
    const listUC   = new ListTasksUseCase(repo);

    await createUC.execute({ title: '작업A', assignee_id: 'alice' });
    await createUC.execute({ title: '작업B', assignee_id: 'bob' });

    const result = await listUC.execute({ assignee_id: 'alice' });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].assignee_id, 'alice');
  });
});

describe('TransitionTaskStatusUseCase', () => {
  test('PENDING → IN_PROGRESS 전이', async () => {
    const repo = new InMemoryTaskRepository();
    const createUC = new CreateTaskUseCase(repo);
    const transUC  = new TransitionTaskStatusUseCase(repo);

    const { task_id } = await createUC.execute({ title: '전이 테스트', assignee_id: 'u1' });
    const result = await transUC.execute({ task_id, new_status: 'IN_PROGRESS' });
    assert.equal(result.old_status, 'PENDING');
    assert.equal(result.new_status, 'IN_PROGRESS');
  });

  test('[INV002] DONE → IN_PROGRESS 불가', async () => {
    const repo = new InMemoryTaskRepository();
    const createUC = new CreateTaskUseCase(repo);
    const transUC  = new TransitionTaskStatusUseCase(repo);

    const { task_id } = await createUC.execute({ title: '불변조건 테스트', assignee_id: 'u1' });
    await transUC.execute({ task_id, new_status: 'IN_PROGRESS' });
    await transUC.execute({ task_id, new_status: 'DONE' });
    await assert.rejects(() => transUC.execute({ task_id, new_status: 'IN_PROGRESS' }), /\[INV002\]/);
  });

  test('존재하지 않는 작업 조회 에러', async () => {
    const repo = new InMemoryTaskRepository();
    const transUC = new TransitionTaskStatusUseCase(repo);
    await assert.rejects(() => transUC.execute({ task_id: 'nonexistent', new_status: 'IN_PROGRESS' }), /찾을 수 없습니다/);
  });
});

describe('ReassignTaskUseCase', () => {
  test('담당자 변경 성공', async () => {
    const repo = new InMemoryTaskRepository();
    const createUC   = new CreateTaskUseCase(repo);
    const reassignUC = new ReassignTaskUseCase(repo);

    const { task_id } = await createUC.execute({ title: '재할당 테스트', assignee_id: 'alice' });
    const result = await reassignUC.execute({ task_id, new_assignee_id: 'bob' });
    assert.equal(result.assignee_id, 'bob');
  });

  test('DONE 상태 작업은 담당자 변경 불가', async () => {
    const repo = new InMemoryTaskRepository();
    const createUC   = new CreateTaskUseCase(repo);
    const transUC    = new TransitionTaskStatusUseCase(repo);
    const reassignUC = new ReassignTaskUseCase(repo);

    const { task_id } = await createUC.execute({ title: '완료 재할당', assignee_id: 'alice' });
    await transUC.execute({ task_id, new_status: 'IN_PROGRESS' });
    await transUC.execute({ task_id, new_status: 'DONE' });
    await assert.rejects(() => reassignUC.execute({ task_id, new_assignee_id: 'bob' }), /DONE/);
  });
});
