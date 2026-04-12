'use strict';

/**
 * SQLiteTaskRepository.optimisticLock.test.js
 *
 * WP-S17-001: SQLiteTaskRepository 낙관적 잠금 회귀 방지
 *
 * InMemoryTaskRepository 낙관적 잠금 테스트와 동일한 계약을
 * 실제 SQLite(:memory:) DB에서도 검증한다.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let SQLiteTaskRepository;
try {
  ({ SQLiteTaskRepository } = require('../../src/infrastructure/SQLiteTaskRepository'));
} catch {
  // node:sqlite 미사용 환경 — 전체 스킵
  SQLiteTaskRepository = null;
}

const { CreateTaskUseCase }          = require('../../src/application/CreateTaskUseCase');
const { TransitionTaskStatusUseCase } = require('../../src/application/TransitionTaskStatusUseCase');
const { ReassignTaskUseCase }         = require('../../src/application/ReassignTaskUseCase');

const CALLER = { userId: 'u-1', permissions: ['task:write', 'task:read'] };

const skipIfNoSqlite = (name, fn) => {
  if (!SQLiteTaskRepository) {
    it(`SKIP — node:sqlite 미사용: ${name}`, () => {});
    return;
  }
  it(name, fn);
};

describe('SQLiteTaskRepository — 낙관적 잠금', () => {
  let repo;

  beforeEach(() => {
    if (!SQLiteTaskRepository) return;
    repo = SQLiteTaskRepository.create(':memory:');
  });

  afterEach(() => {
    if (repo) { repo.close(); repo = null; }
  });

  skipIfNoSqlite('태스크 생성 후 version이 1이다', async () => {
    const uc = new CreateTaskUseCase(repo);
    const { task_id } = await uc.execute({ title: 'v1 task', assignee_id: 'u-1' }, CALLER);
    const task = await repo.findById(task_id);
    assert.equal(task.version, 1, 'version should be 1 after creation');
  });

  skipIfNoSqlite('전이 후 version이 2로 증가한다', async () => {
    const createUC = new CreateTaskUseCase(repo);
    const transUC  = new TransitionTaskStatusUseCase(repo);
    const { task_id } = await createUC.execute({ title: '전이 v', assignee_id: 'u-1' }, CALLER);

    await transUC.execute({ task_id, new_status: 'IN_PROGRESS' }, CALLER);

    const task = await repo.findById(task_id);
    assert.equal(task.version, 2, 'version should be 2 after transition');
  });

  skipIfNoSqlite('재배정 후 version이 2로 증가한다', async () => {
    const createUC   = new CreateTaskUseCase(repo);
    const reassignUC = new ReassignTaskUseCase(repo);
    const { task_id } = await createUC.execute({ title: '재배정 v', assignee_id: 'u-1' }, CALLER);

    await reassignUC.execute({ task_id, new_assignee_id: 'u-2' }, CALLER);

    const task = await repo.findById(task_id);
    assert.equal(task.version, 2, 'version should be 2 after reassign');
  });

  skipIfNoSqlite('stale version으로 save하면 OPTIMISTIC_LOCK_CONFLICT를 던진다', async () => {
    const createUC = new CreateTaskUseCase(repo);
    const transUC  = new TransitionTaskStatusUseCase(repo);
    const { task_id } = await createUC.execute({ title: 'stale v', assignee_id: 'u-1' }, CALLER);

    // 첫 전이로 DB version=2
    await transUC.execute({ task_id, new_status: 'IN_PROGRESS' }, CALLER);

    // version=1인 stale 태스크로 전이 시도 (DB에는 version=2 존재)
    const staleTask = await repo.findById(task_id);
    // staleTask.version = 2, 여기서 직접 stale save를 시뮬레이션하려면
    // version=1인 task를 직접 구성해야 한다
    const { Task } = require('../../src/domain/entities/Task');
    const staleSnap = { ...staleTask.toSnapshot(), version: 1 };
    const staleEntity = Task.reconstitute(staleSnap);

    await assert.rejects(
      () => repo.save(staleEntity),
      (err) => {
        assert.equal(err.code, 'OPTIMISTIC_LOCK_CONFLICT');
        return true;
      },
      'stale version should throw OPTIMISTIC_LOCK_CONFLICT',
    );
  });

  skipIfNoSqlite('동시 전이 시뮬레이션 — 두 번째 save는 OPTIMISTIC_LOCK_CONFLICT', async () => {
    const createUC = new CreateTaskUseCase(repo);
    const { task_id } = await createUC.execute({ title: '동시 v', assignee_id: 'u-1' }, CALLER);

    // 두 개의 동시 읽기 (같은 version=1)
    const taskA = await repo.findById(task_id);
    const taskB = await repo.findById(task_id);

    assert.equal(taskA.version, 1);
    assert.equal(taskB.version, 1);

    // A가 먼저 전이 — DB version=2
    const updatedA = taskA.transitionTo('IN_PROGRESS');
    await repo.save(updatedA); // version 1→2: PASS

    // B도 같은 version=1에서 전이 시도 — DB version=2, expected=2, got=2 → PASS?
    // 아니다: taskB는 version=1이고 transitionTo 후 version=2가 되지만 DB에 이미 version=2 존재
    // DB 기대값: 현재 DB version + 1 = 3, 들어오는 version = 2 → CONFLICT
    const updatedB = taskB.transitionTo('IN_PROGRESS');
    await assert.rejects(
      () => repo.save(updatedB),
      (err) => {
        assert.equal(err.code, 'OPTIMISTIC_LOCK_CONFLICT');
        assert.equal(err.expected, 3); // DB version(2) + 1
        assert.equal(err.actual, 2);   // taskB의 version
        return true;
      },
    );
  });

  skipIfNoSqlite('전체 생명주기(생성→전이→재배정)에서 version이 1→2→3으로 증가한다', async () => {
    const createUC   = new CreateTaskUseCase(repo);
    const transUC    = new TransitionTaskStatusUseCase(repo);
    const reassignUC = new ReassignTaskUseCase(repo);

    const { task_id } = await createUC.execute({ title: '생명주기 v', assignee_id: 'u-1' }, CALLER);
    const v1 = (await repo.findById(task_id)).version;

    await transUC.execute({ task_id, new_status: 'IN_PROGRESS' }, CALLER);
    const v2 = (await repo.findById(task_id)).version;

    await reassignUC.execute({ task_id, new_assignee_id: 'u-2' }, CALLER);
    const v3 = (await repo.findById(task_id)).version;

    assert.equal(v1, 1, 'version after create = 1');
    assert.equal(v2, 2, 'version after transition = 2');
    assert.equal(v3, 3, 'version after reassign = 3');
  });
});
