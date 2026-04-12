'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryOutboxRepository } = require('../../src/infrastructure/OutboxRepository');
const { OutboxPoller } = require('../../src/infrastructure/OutboxPoller');

// 간단한 EventBus stub
function makeEventBusSpy() {
  const events = [];
  return {
    publish: (evt) => events.push(evt),
    events,
  };
}

describe('OutboxPoller', () => {
  /** @type {InMemoryOutboxRepository} */
  let repo;
  /** @type {ReturnType<typeof makeEventBusSpy>} */
  let busSpy;
  /** @type {OutboxPoller} */
  let poller;

  beforeEach(() => {
    repo    = new InMemoryOutboxRepository();
    busSpy  = makeEventBusSpy();
    poller  = new OutboxPoller({ outboxRepo: repo, eventBus: busSpy, intervalMs: 20, batchSize: 10 });
  });

  afterEach(async () => {
    await poller.stop();
  });

  // ── 생성자 ─────────────────────────────────────────────────────────────────

  it('outboxRepo가 Port 계약을 구현하지 않으면 TypeError', () => {
    assert.throws(
      () => new OutboxPoller({ outboxRepo: {}, eventBus: busSpy }),
      /OutboxPoller/,
    );
  });

  it('eventBus에 publish가 없으면 TypeError', () => {
    assert.throws(
      () => new OutboxPoller({ outboxRepo: repo, eventBus: {} }),
      /OutboxPoller/,
    );
  });

  // ── start / stop ───────────────────────────────────────────────────────────

  it('start 후 isRunning이 true', () => {
    poller.start();
    assert.equal(poller.isRunning, true);
  });

  it('stop 후 isRunning이 false', async () => {
    poller.start();
    await poller.stop();
    assert.equal(poller.isRunning, false);
  });

  it('이미 실행 중일 때 start 재호출 — no-op (타이머 하나만 유지)', () => {
    poller.start();
    const first = poller._timer;
    poller.start();
    assert.strictEqual(poller._timer, first);
  });

  // ── polling 동작 ───────────────────────────────────────────────────────────

  it('pending 이벤트가 EventBus로 전달되고 delivered 처리된다', async () => {
    await repo.append([
      { event_type: 'task.created', aggregate_id: 'T-001', payload: { title: '할일' } },
    ]);
    poller.start();
    // intervalMs=20 이므로 60ms 대기
    await new Promise((r) => setTimeout(r, 60));
    await poller.stop();

    assert.equal(busSpy.events.length, 1);
    assert.equal(busSpy.events[0].type, 'task.created');
    assert.equal(busSpy.events[0].aggregateId, 'T-001');
    // markDelivered 확인
    assert.equal((await repo.fetchPending()).length, 0);
  });

  it('복수 이벤트 배치 전달', async () => {
    await repo.append([
      { event_type: 'a', aggregate_id: 'T-1', payload: {} },
      { event_type: 'b', aggregate_id: 'T-2', payload: {} },
      { event_type: 'c', aggregate_id: 'T-3', payload: {} },
    ]);
    poller.start();
    await new Promise((r) => setTimeout(r, 60));
    await poller.stop();

    assert.equal(busSpy.events.length, 3);
    assert.equal((await repo.fetchPending()).length, 0);
  });

  it('pending이 없으면 EventBus 호출 없음', async () => {
    poller.start();
    await new Promise((r) => setTimeout(r, 60));
    await poller.stop();
    assert.equal(busSpy.events.length, 0);
  });

  it('EventBus publish 에러는 격리되어 다른 이벤트 전달 계속된다', async () => {
    // 특정 aggregate_id 이벤트에서만 throw
    const failId = 'T-FAIL';
    const faultBus = {
      events: [],
      publish(evt) {
        if (evt.aggregateId === failId) throw new Error('bus error');
        this.events.push(evt);
      },
    };
    const faultPoller = new OutboxPoller({ outboxRepo: repo, eventBus: faultBus, intervalMs: 20 });
    await repo.append([
      { event_type: 'x', aggregate_id: failId, payload: {} },
      { event_type: 'y', aggregate_id: 'T-OK', payload: {} },
    ]);
    faultPoller.start();
    // 첫 번째 poll 완료를 기다린다 (intervalMs=20 → 30ms 대기)
    await new Promise((r) => setTimeout(r, 30));
    await faultPoller.stop();

    // 'T-OK' 이벤트는 성공 전달됨
    assert.ok(faultBus.events.some((e) => e.aggregateId === 'T-OK'), 'T-OK should be delivered');
    // 실패한 이벤트는 errorCount에 기록됨
    assert.ok(faultPoller.stats.errorCount >= 1, 'errorCount should be ≥1');
  });

  // ── stats ──────────────────────────────────────────────────────────────────

  it('stats.pollCount는 poll 실행 횟수를 추적한다', async () => {
    poller.start();
    await new Promise((r) => setTimeout(r, 70));
    await poller.stop();
    assert.ok(poller.stats.pollCount >= 2, `pollCount should be ≥2, got ${poller.stats.pollCount}`);
  });

  it('stats.deliveredCount는 전달 이벤트 수를 추적한다', async () => {
    await repo.append([
      { event_type: 'p', aggregate_id: 'T-1', payload: {} },
      { event_type: 'q', aggregate_id: 'T-2', payload: {} },
    ]);
    poller.start();
    await new Promise((r) => setTimeout(r, 60));
    await poller.stop();
    assert.equal(poller.stats.deliveredCount, 2);
  });
});
