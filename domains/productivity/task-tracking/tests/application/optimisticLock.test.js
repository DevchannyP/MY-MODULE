'use strict';

/**
 * optimisticLock.test.js
 *
 * WP-S11-001: InMemoryTaskRepository 낙관적 잠금 검증
 *
 * NFR: nfr_extended.concurrency.thread_safety
 *   "Repository 구현체는 동시 읽기 안전, 쓰기는 낙관적 잠금 또는 직렬화."
 *
 * 검증:
 *   1. Task 생성 시 version=1
 *   2. 전이 후 version이 증가한다
 *   3. 동일 version으로 두 번 저장하면 OPTIMISTIC_LOCK_CONFLICT
 *   4. TransitionTaskStatusUseCase 동시 전이 시뮬레이션 → 선행 저장 성공, 후행 저장 충돌
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Task } = require('../../src/domain/entities/Task');
const { InMemoryTaskRepository } = require('../../src/infrastructure/InMemoryTaskRepository');
const { CreateTaskUseCase } = require('../../src/application/CreateTaskUseCase');

const CALLER = { userId: 'u-1', permissions: ['task:write', 'task:read'] };

describe('Task 낙관적 잠금 — 엔티티 version 계약', () => {
  it('새로 생성된 Task의 version은 1이다', () => {
    const task = Task.create({ title: '버전 시작', assignee_id: 'u-1' });
    assert.equal(task.version, 1);
    assert.equal(task.toSnapshot().version, 1);
  });

  it('transitionTo()는 version을 1 증가시킨다', () => {
    const task = Task.create({ title: '전이', assignee_id: 'u-1' });
    const updated = task.transitionTo('IN_PROGRESS');
    assert.equal(task.version, 1, '원본은 그대로');
    assert.equal(updated.version, 2, '전이 후 version 2');
  });

  it('reassign()은 version을 1 증가시킨다', () => {
    const task = Task.create({ title: '재배정', assignee_id: 'u-1' });
    const updated = task.reassign('u-2');
    assert.equal(updated.version, 2);
  });

  it('reconstitute()는 snapshot의 version을 그대로 복원한다', () => {
    const snap = Task.create({ title: '복원', assignee_id: 'u-1' }).transitionTo('IN_PROGRESS').toSnapshot();
    const restored = Task.reconstitute(snap);
    assert.equal(restored.version, 2);
  });
});

describe('InMemoryTaskRepository 낙관적 잠금 — 충돌 감지', () => {
  it('정상 read-modify-write 흐름은 충돌 없이 성공한다', async () => {
    const repo = new InMemoryTaskRepository();
    const task = Task.create({ title: '정상 흐름', assignee_id: 'u-1' });
    await repo.save(task);

    const read = await repo.findById(task.id);
    const updated = read.transitionTo('IN_PROGRESS');
    await repo.save(updated); // version 1→2: 충돌 없음
    assert.equal((await repo.findById(task.id)).version, 2);
  });

  it('동일 version으로 두 번 저장하면 OPTIMISTIC_LOCK_CONFLICT를 던진다', async () => {
    const repo = new InMemoryTaskRepository();
    const task = Task.create({ title: '충돌', assignee_id: 'u-1' });
    await repo.save(task);

    // A와 B 모두 version=1 읽음
    const readA = await repo.findById(task.id);
    const readB = await repo.findById(task.id);

    const updatedA = readA.transitionTo('IN_PROGRESS'); // version 2
    const updatedB = readB.transitionTo('IN_PROGRESS'); // version 2

    await repo.save(updatedA); // 성공: 1 → 2 저장

    await assert.rejects(
      () => repo.save(updatedB), // 실패: 저장된 version=2, 기대 version=2, 실제 task.version=2 → 2+1≠2
      (err) => {
        assert.equal(err.code, 'OPTIMISTIC_LOCK_CONFLICT');
        return true;
      },
    );
  });

  it('신규 엔티티 저장 시 충돌 체크를 생략한다', async () => {
    const repo = new InMemoryTaskRepository();
    const task = Task.create({ title: '신규', assignee_id: 'u-1' });
    await assert.doesNotReject(() => repo.save(task));
  });
});

describe('TransitionTaskStatusUseCase 동시 전이 시뮬레이션', () => {
  it('두 동시 전이 중 첫 번째만 성공하고 두 번째는 충돌한다', async () => {
    const repo = new InMemoryTaskRepository();
    const createUC = new CreateTaskUseCase(repo);
    const { task_id } = await createUC.execute(
      { title: '동시 전이', assignee_id: 'u-1' },
      CALLER,
    );

    // 두 요청이 동시에 task를 읽은 후 각자 전이 시도
    const taskForA = await repo.findById(task_id);
    const taskForB = await repo.findById(task_id);

    const updatedA = taskForA.transitionTo('IN_PROGRESS');
    const updatedB = taskForB.transitionTo('IN_PROGRESS');

    // A 저장 성공
    await repo.save(updatedA);

    // B 저장 → 충돌
    await assert.rejects(
      () => repo.save(updatedB),
      { code: 'OPTIMISTIC_LOCK_CONFLICT' },
    );
  });
});
