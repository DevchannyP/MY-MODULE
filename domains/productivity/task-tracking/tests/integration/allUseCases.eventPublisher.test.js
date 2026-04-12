'use strict';

/**
 * allUseCases.eventPublisher.test.js
 *
 * WP-S15-001: 모든 Task use case가 EventBus에 도메인 이벤트를 발행함을 검증
 *
 * 누락된 배선(서버에서 TransitionTask/Reassign에 publisher 미주입) 회귀 방지
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventBus } = require('../../../../../src/shared/EventBus');
const { EventBusPublisher } = require('../../../../../src/shared/EventBusPublisher');
const { InMemoryOutboxRepository } = require('../../src/infrastructure/OutboxRepository');
const { InMemoryTaskRepository } = require('../../src/infrastructure/InMemoryTaskRepository');
const { CreateTaskUseCase } = require('../../src/application/CreateTaskUseCase');
const { TransitionTaskStatusUseCase } = require('../../src/application/TransitionTaskStatusUseCase');
const { ReassignTaskUseCase } = require('../../src/application/ReassignTaskUseCase');

const CALLER = { userId: 'u-1', permissions: ['task:write', 'task:read'] };

describe('모든 Task Use Case — EventBus 발행 + Outbox dual-write', () => {
  let bus, repo, publisher, outboxRepo;

  beforeEach(() => {
    EventBus._resetForTest();
    bus        = EventBus.getInstance();
    bus.enableHistory();
    repo       = new InMemoryTaskRepository();
    publisher  = new EventBusPublisher(bus);
    outboxRepo = new InMemoryOutboxRepository();
  });

  afterEach(() => { EventBus._resetForTest(); });

  it('CreateTaskUseCase: TaskCreated 이벤트가 EventBus와 Outbox 양쪽에 기록된다', async () => {
    const uc = new CreateTaskUseCase(repo, publisher, outboxRepo);
    await uc.execute({ title: '생성', assignee_id: 'u-1' }, CALLER);

    assert.ok(bus.getHistory().some((e) => e.type === 'TaskCreated'), 'EventBus에 TaskCreated');
    const pending = await outboxRepo.fetchPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].event_type, 'TaskCreated');
  });

  it('TransitionTaskStatusUseCase: TaskStatusChanged 이벤트가 EventBus와 Outbox에 기록된다', async () => {
    const createUC = new CreateTaskUseCase(repo, publisher, outboxRepo);
    const { task_id } = await createUC.execute({ title: '전이', assignee_id: 'u-1' }, CALLER);
    await outboxRepo.markDelivered((await outboxRepo.fetchPending()).map((e) => e.id));

    const transUC = new TransitionTaskStatusUseCase(repo, publisher, outboxRepo);
    await transUC.execute({ task_id, new_status: 'IN_PROGRESS' }, CALLER);

    assert.ok(bus.getHistory().some((e) => e.type === 'TaskStatusChanged'), 'EventBus에 TaskStatusChanged');
    const pending = await outboxRepo.fetchPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].event_type, 'TaskStatusChanged');
  });

  it('ReassignTaskUseCase: TaskReassigned 이벤트가 EventBus와 Outbox에 기록된다', async () => {
    const createUC = new CreateTaskUseCase(repo, publisher, outboxRepo);
    const { task_id } = await createUC.execute({ title: '재배정', assignee_id: 'u-1' }, CALLER);
    await outboxRepo.markDelivered((await outboxRepo.fetchPending()).map((e) => e.id));

    const reassignUC = new ReassignTaskUseCase(repo, publisher, outboxRepo);
    await reassignUC.execute({ task_id, new_assignee_id: 'u-2' }, CALLER);

    assert.ok(bus.getHistory().some((e) => e.type === 'TaskReassigned'), 'EventBus에 TaskReassigned');
    const pending = await outboxRepo.fetchPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].event_type, 'TaskReassigned');
  });

  it('전체 태스크 생명주기(생성→전이→재배정)에서 Outbox에 3건이 기록된다', async () => {
    const createUC   = new CreateTaskUseCase(repo, publisher, outboxRepo);
    const transUC    = new TransitionTaskStatusUseCase(repo, publisher, outboxRepo);
    const reassignUC = new ReassignTaskUseCase(repo, publisher, outboxRepo);

    const { task_id } = await createUC.execute({ title: '생명주기', assignee_id: 'u-1' }, CALLER);
    await transUC.execute({ task_id, new_status: 'IN_PROGRESS' }, CALLER);
    await reassignUC.execute({ task_id, new_assignee_id: 'u-2' }, CALLER);

    const all = outboxRepo.all();
    assert.equal(all.length, 3, '생성+전이+재배정 = 3 outbox 항목');
    const types = all.map((e) => e.event_type);
    assert.ok(types.includes('TaskCreated'));
    assert.ok(types.includes('TaskStatusChanged'));
    assert.ok(types.includes('TaskReassigned'));
  });
});
