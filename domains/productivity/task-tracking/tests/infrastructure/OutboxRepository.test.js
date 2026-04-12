'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryOutboxRepository } = require('../../src/infrastructure/OutboxRepository');

describe('InMemoryOutboxRepository', () => {
  /** @type {InMemoryOutboxRepository} */
  let repo;

  beforeEach(() => {
    repo = new InMemoryOutboxRepository();
  });

  // ── append ──────────────────────────────────────────────────────────────────

  it('append: 단일 이벤트를 저장하고 fetchPending에서 조회된다', async () => {
    await repo.append([{
      event_type:   'task.created',
      aggregate_id: 'T-001',
      payload:      { task_id: 'T-001', title: '할일' },
    }]);
    const pending = await repo.fetchPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].event_type, 'task.created');
    assert.equal(pending[0].aggregate_id, 'T-001');
    assert.deepEqual(pending[0].payload, { task_id: 'T-001', title: '할일' });
  });

  it('append: 복수 이벤트를 한 번에 저장한다', async () => {
    await repo.append([
      { event_type: 'task.created', aggregate_id: 'T-001', payload: {} },
      { event_type: 'task.updated', aggregate_id: 'T-002', payload: {} },
    ]);
    const pending = await repo.fetchPending();
    assert.equal(pending.length, 2);
  });

  it('append: 빈 배열은 no-op', async () => {
    await repo.append([]);
    const pending = await repo.fetchPending();
    assert.equal(pending.length, 0);
  });

  // ── fetchPending ────────────────────────────────────────────────────────────

  it('fetchPending: limit 옵션으로 결과를 자른다', async () => {
    await repo.append([
      { event_type: 'a', aggregate_id: 'T-1', payload: {} },
      { event_type: 'b', aggregate_id: 'T-2', payload: {} },
      { event_type: 'c', aggregate_id: 'T-3', payload: {} },
    ]);
    const pending = await repo.fetchPending({ limit: 2 });
    assert.equal(pending.length, 2);
  });

  it('fetchPending: delivered=true 항목은 반환하지 않는다', async () => {
    await repo.append([
      { event_type: 'x', aggregate_id: 'T-1', payload: {} },
      { event_type: 'y', aggregate_id: 'T-2', payload: {} },
    ]);
    const all = await repo.fetchPending();
    await repo.markDelivered([all[0].id]);
    const pending = await repo.fetchPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].event_type, 'y');
  });

  it('fetchPending: id, event_type, aggregate_id, payload, created_at 필드를 반환한다', async () => {
    await repo.append([{ event_type: 'z', aggregate_id: 'T-9', payload: { x: 1 } }]);
    const [row] = await repo.fetchPending();
    assert.equal(typeof row.id, 'string');
    assert.equal(row.event_type, 'z');
    assert.equal(row.aggregate_id, 'T-9');
    assert.deepEqual(row.payload, { x: 1 });
    assert.equal(typeof row.created_at, 'string');
  });

  // ── markDelivered ───────────────────────────────────────────────────────────

  it('markDelivered: 지정한 id를 delivered 처리한다', async () => {
    await repo.append([{ event_type: 'e', aggregate_id: 'T-5', payload: {} }]);
    const [row] = await repo.fetchPending();
    await repo.markDelivered([row.id]);
    const pending = await repo.fetchPending();
    assert.equal(pending.length, 0);
    // all() 에서는 여전히 보임
    assert.equal(repo.all().find((r) => r.id === row.id).delivered, true);
  });

  it('markDelivered: 빈 배열은 no-op', async () => {
    await repo.append([{ event_type: 'f', aggregate_id: 'T-6', payload: {} }]);
    await repo.markDelivered([]);
    assert.equal((await repo.fetchPending()).length, 1);
  });

  it('markDelivered: 존재하지 않는 id는 무시된다', async () => {
    await repo.markDelivered(['non-existent-id']);
    assert.equal((await repo.fetchPending()).length, 0);
  });
});
