'use strict';

/**
 * CreateTaskUseCase + EventBus 통합 테스트
 *
 * WP-S8-002: Use case → EventPublisher(port) → EventBusPublisher(adapter) → EventBus 체인 검증
 *
 * 목적:
 *   - EventBusPublisher를 CreateTaskUseCase에 주입하면
 *     작업 생성 후 TaskCreated 이벤트가 EventBus 구독자에게 도달하는지 검증
 *   - 도메인 코어(Task, CreateTaskUseCase)는 수정 없이 어댑터만 교체
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventBus } = require('../../../../../src/shared/EventBus');
const { EventBusPublisher } = require('../../../../../src/shared/EventBusPublisher');
const { InMemoryTaskRepository } = require('../../src/infrastructure/InMemoryTaskRepository');
const { CreateTaskUseCase } = require('../../src/application/CreateTaskUseCase');
const { InMemoryOutboxRepository } = require('../../src/infrastructure/OutboxRepository');
const { OutboxPoller } = require('../../src/infrastructure/OutboxPoller');

const CALLER = { userId: 'user-1', permissions: ['task:write', 'task:read'] };

describe('CreateTaskUseCase + EventBusPublisher 통합', () => {
  let bus, repo, publisher, useCase;

  beforeEach(() => {
    EventBus._resetForTest();
    bus       = EventBus.getInstance();
    bus.enableHistory();
    repo      = new InMemoryTaskRepository();
    publisher = new EventBusPublisher(bus);
    useCase   = new CreateTaskUseCase(repo, publisher);
  });

  afterEach(() => {
    EventBus._resetForTest();
  });

  it('task 생성 후 TaskCreated 이벤트가 EventBus에 발행된다', async () => {
    const received = [];
    bus.subscribe('TaskCreated', (e) => received.push(e));

    await useCase.execute(
      { title: '기능 구현', assignee_id: 'user-1' },
      CALLER,
    );

    assert.equal(received.length, 1, 'TaskCreated 이벤트가 1개 발행되어야 한다');
    assert.equal(received[0].type, 'TaskCreated');
    assert.ok(received[0].payload?.task_id, 'payload에 task_id가 있어야 한다');
  });

  it('EventPublisher 없이 실행해도 정상 동작 (publisher=null)', async () => {
    const noPublisherUseCase = new CreateTaskUseCase(repo, null);
    const result = await noPublisherUseCase.execute(
      { title: '퍼블리셔 없는 작업', assignee_id: 'user-2' },
      CALLER,
    );
    assert.ok(result.task_id);
    assert.equal(bus.getHistory().length, 0);
  });

  it('와일드카드 구독자는 모든 task 이벤트를 수신한다', async () => {
    const all = [];
    bus.subscribe('*', (e) => all.push(e.type));

    await useCase.execute({ title: '태스크 A', assignee_id: 'u-1' }, CALLER);
    await useCase.execute({ title: '태스크 B', assignee_id: 'u-2' }, CALLER);

    assert.ok(all.filter((t) => t === 'TaskCreated').length >= 2,
      '두 번 생성하면 TaskCreated 2회 이상');
  });
});

describe('OutboxPoller + EventBus 연결 통합', () => {
  let bus, outboxRepo, poller;

  beforeEach(() => {
    EventBus._resetForTest();
    bus       = EventBus.getInstance();
    outboxRepo = new InMemoryOutboxRepository();
    poller    = new OutboxPoller({ outboxRepo, eventBus: bus, intervalMs: 20 });
  });

  afterEach(async () => {
    await poller.stop();
    EventBus._resetForTest();
  });

  it('OutboxRepository에 추가된 이벤트가 Poller를 통해 EventBus에 도달한다', async () => {
    const received = [];
    bus.subscribe('task.status.changed', (e) => received.push(e));

    await outboxRepo.append([{
      event_type:   'task.status.changed',
      aggregate_id: 'T-100',
      payload:      { old_status: 'TODO', new_status: 'IN_PROGRESS' },
    }]);

    poller.start();
    await new Promise((r) => setTimeout(r, 60));
    await poller.stop();

    assert.equal(received.length, 1);
    assert.equal(received[0].aggregateId, 'T-100');
    assert.equal((await outboxRepo.fetchPending()).length, 0);
  });

  it('Poller delivered 후 EventBus history에 기록된다', async () => {
    bus.enableHistory();
    await outboxRepo.append([
      { event_type: 'task.deleted', aggregate_id: 'T-200', payload: {} },
    ]);

    poller.start();
    await new Promise((r) => setTimeout(r, 60));
    await poller.stop();

    const history = bus.getHistory();
    assert.ok(history.some((e) => e.type === 'task.deleted'), 'history should contain task.deleted');
  });
});
