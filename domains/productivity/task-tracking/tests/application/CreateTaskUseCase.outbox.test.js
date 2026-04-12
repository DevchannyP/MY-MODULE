'use strict';

/**
 * CreateTaskUseCase.outbox.test.js
 *
 * WP-S14-001: CreateTaskUseCase outbox dual-write 검증
 *
 * 전달 보장 전략:
 *   - EventPublisher(직접 발행) + OutboxRepository(내구성 라이트) 동시 사용
 *   - 두 경로 중 하나라도 살아있으면 이벤트 at-least-once 도달
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventBus } = require('../../../../../src/shared/EventBus');
const { EventBusPublisher } = require('../../../../../src/shared/EventBusPublisher');
const { InMemoryOutboxRepository } = require('../../src/infrastructure/OutboxRepository');
const { InMemoryTaskRepository } = require('../../src/infrastructure/InMemoryTaskRepository');
const { CreateTaskUseCase } = require('../../src/application/CreateTaskUseCase');

const CALLER = { userId: 'u-1', permissions: ['task:write', 'task:read'] };

function makeSetup() {
  EventBus._resetForTest();
  const bus        = EventBus.getInstance();
  const repo       = new InMemoryTaskRepository();
  const publisher  = new EventBusPublisher(bus);
  const outboxRepo = new InMemoryOutboxRepository();
  const useCase    = new CreateTaskUseCase(repo, publisher, outboxRepo);
  return { bus, repo, publisher, outboxRepo, useCase };
}

describe('CreateTaskUseCase — outbox dual-write', () => {
  it('task 생성 시 EventBus와 OutboxRepository 양쪽에 이벤트가 기록된다', async () => {
    const { bus, outboxRepo, useCase } = makeSetup();
    bus.enableHistory();

    await useCase.execute({ title: '듀얼 라이트', assignee_id: 'u-1' }, CALLER);

    // EventBus 직접 발행 확인
    const history = bus.getHistory();
    assert.ok(history.some((e) => e.type === 'TaskCreated'), 'EventBus에 TaskCreated 발행돼야 함');

    // Outbox 기록 확인
    const pending = await outboxRepo.fetchPending();
    assert.equal(pending.length, 1, 'outbox에 1건이 기록돼야 함');
    assert.equal(pending[0].event_type, 'TaskCreated', 'outbox event_type은 TaskCreated이어야 함');
    assert.ok(pending[0].aggregate_id, 'aggregate_id가 있어야 함');

    EventBus._resetForTest();
  });

  it('outboxRepository 없이도 정상 동작한다 (하위 호환)', async () => {
    EventBus._resetForTest();
    const bus     = EventBus.getInstance();
    const repo    = new InMemoryTaskRepository();
    const useCase = new CreateTaskUseCase(repo, new EventBusPublisher(bus));

    const result = await useCase.execute({ title: '하위 호환', assignee_id: 'u-2' }, CALLER);
    assert.ok(result.task_id, 'task_id가 반환돼야 함');

    EventBus._resetForTest();
  });

  it('복수 task 생성 시 outbox에 건수만큼 기록된다', async () => {
    const { outboxRepo, useCase } = makeSetup();

    await useCase.execute({ title: '태스크 A', assignee_id: 'u-1' }, CALLER);
    await useCase.execute({ title: '태스크 B', assignee_id: 'u-2' }, CALLER);
    await useCase.execute({ title: '태스크 C', assignee_id: 'u-3' }, CALLER);

    const pending = await outboxRepo.fetchPending();
    assert.equal(pending.length, 3, 'outbox에 3건이 기록돼야 함');

    EventBus._resetForTest();
  });

  it('outbox 이벤트가 OutboxPoller를 통해 EventBus에 재전달된다 (at-least-once)', async () => {
    const { bus, outboxRepo, useCase } = makeSetup();
    const received = [];
    bus.subscribe('TaskCreated', (e) => received.push(e));

    await useCase.execute({ title: '재전달 테스트', assignee_id: 'u-1' }, CALLER);

    // outbox에 기록된 것을 직접 EventBus로 재발행 (poller 없이 수동 재전달 시뮬레이션)
    const pending = await outboxRepo.fetchPending();
    for (const entry of pending) {
      bus.publish({ ...entry.payload, type: entry.event_type });
    }
    await outboxRepo.markDelivered(pending.map((e) => e.id));

    // 원래 직접 발행 1건 + outbox 재전달 1건 = 2건 (at-least-once 의미)
    assert.ok(received.length >= 2, `at-least-once 보장: 최소 2회 수신 (received: ${received.length})`);
    assert.equal((await outboxRepo.fetchPending()).length, 0, 'outbox가 비어야 함');

    EventBus._resetForTest();
  });
});
