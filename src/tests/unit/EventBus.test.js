'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventBus } = require('../../shared/EventBus');

// 각 테스트 전 Singleton 초기화
beforeEach(() => EventBus._resetForTest());
after(() => EventBus._resetForTest());

// ── Singleton 계약 ──────────────────────────────────────────────────────────

describe('EventBus Singleton', () => {
  it('getInstance()는 동일 인스턴스를 반환한다', () => {
    const a = EventBus.getInstance();
    const b = EventBus.getInstance();
    assert.strictEqual(a, b);
  });

  it('new EventBus()는 두 번째 호출 시 에러를 던진다', () => {
    EventBus.getInstance(); // first instance
    assert.throws(
      () => new EventBus(),
      /Singleton/,
    );
  });

  it('_resetForTest() 후 새 인스턴스를 생성할 수 있다', () => {
    const a = EventBus.getInstance();
    EventBus._resetForTest();
    const b = EventBus.getInstance();
    assert.notStrictEqual(a, b);
  });
});

// ── Subscribe / Unsubscribe ─────────────────────────────────────────────────

describe('EventBus.subscribe', () => {
  it('handler를 등록하고 해당 타입 이벤트 수신', () => {
    const bus = EventBus.getInstance();
    const received = [];
    bus.subscribe('task.created', (e) => received.push(e));
    bus.publish({ type: 'task.created', id: 'T-001' });
    assert.equal(received.length, 1);
    assert.equal(received[0].id, 'T-001');
  });

  it('다른 타입 이벤트는 수신하지 않는다', () => {
    const bus = EventBus.getInstance();
    const received = [];
    bus.subscribe('task.created', (e) => received.push(e));
    bus.publish({ type: 'billing.paid', id: 'B-001' });
    assert.equal(received.length, 0);
  });

  it('와일드카드("*") 구독자는 모든 이벤트를 수신한다', () => {
    const bus = EventBus.getInstance();
    const received = [];
    bus.subscribe('*', (e) => received.push(e.type));
    bus.publish({ type: 'task.created' });
    bus.publish({ type: 'billing.paid' });
    assert.deepEqual(received, ['task.created', 'billing.paid']);
  });

  it('subscribe()는 unsubscribe 함수를 반환한다', () => {
    const bus = EventBus.getInstance();
    const received = [];
    const unsub = bus.subscribe('task.updated', (e) => received.push(e));
    bus.publish({ type: 'task.updated', id: 'T-001' });
    unsub();
    bus.publish({ type: 'task.updated', id: 'T-002' });
    assert.equal(received.length, 1);
    assert.equal(received[0].id, 'T-001');
  });

  it('잘못된 eventType 인수 시 TypeError를 던진다', () => {
    const bus = EventBus.getInstance();
    assert.throws(() => bus.subscribe('', () => {}), /non-empty/);
    assert.throws(() => bus.subscribe(123, () => {}), /string/);
  });

  it('handler가 함수가 아니면 TypeError를 던진다', () => {
    const bus = EventBus.getInstance();
    assert.throws(() => bus.subscribe('task.created', 'not-a-fn'), /function/);
  });
});

// ── Publish ─────────────────────────────────────────────────────────────────

describe('EventBus.publish', () => {
  it('type 필드 없는 이벤트는 TypeError를 던진다', () => {
    const bus = EventBus.getInstance();
    assert.throws(() => bus.publish({ id: 'X' }), /type/);
    assert.throws(() => bus.publish(null), /type/);
  });

  it('한 핸들러 에러가 다른 핸들러 실행을 막지 않는다', () => {
    const bus = EventBus.getInstance();
    const results = [];
    bus.subscribe('evt', () => { throw new Error('boom'); });
    bus.subscribe('evt', () => results.push('ok'));
    assert.doesNotThrow(() => bus.publish({ type: 'evt' }));
    assert.deepEqual(results, ['ok']);
  });

  it('publishAll은 배열 이벤트를 순서대로 발행한다', () => {
    const bus = EventBus.getInstance();
    const order = [];
    bus.subscribe('*', (e) => order.push(e.seq));
    bus.publishAll([
      { type: 'a', seq: 1 },
      { type: 'b', seq: 2 },
      { type: 'c', seq: 3 },
    ]);
    assert.deepEqual(order, [1, 2, 3]);
  });

  it('publishAll에 배열이 아닌 값을 넘기면 TypeError', () => {
    const bus = EventBus.getInstance();
    assert.throws(() => bus.publishAll({ type: 'x' }), /Array/);
  });
});

// ── listenerCount ───────────────────────────────────────────────────────────

describe('EventBus.listenerCount', () => {
  it('특정 타입 핸들러 수를 반환한다', () => {
    const bus = EventBus.getInstance();
    bus.subscribe('x', () => {});
    bus.subscribe('x', () => {});
    assert.equal(bus.listenerCount('x'), 2);
  });

  it('전체 핸들러 수를 반환한다', () => {
    const bus = EventBus.getInstance();
    bus.subscribe('x', () => {});
    bus.subscribe('y', () => {});
    assert.equal(bus.listenerCount(), 2);
  });

  it('unsubscribe 후 카운트가 감소한다', () => {
    const bus = EventBus.getInstance();
    const unsub = bus.subscribe('x', () => {});
    assert.equal(bus.listenerCount('x'), 1);
    unsub();
    assert.equal(bus.listenerCount('x'), 0);
  });
});

// ── Stats (운영 통계) ───────────────────────────────────────────────────────

describe('EventBus getStats()', () => {
  it('publish 호출마다 publishCount가 증가한다', () => {
    const bus = EventBus.getInstance();
    bus.publish({ type: 'a' });
    bus.publish({ type: 'b' });
    const stats = bus.getStats();
    assert.equal(stats.publishCount, 2);
  });

  it('핸들러 오류 발생 시 handlerErrorCount가 증가한다', () => {
    const bus = EventBus.getInstance();
    bus.subscribe('bad', () => { throw new Error('fail'); });
    bus.publish({ type: 'bad' });
    assert.equal(bus.getStats().handlerErrorCount, 1);
  });

  it('clearForTest() 후 stats가 0으로 초기화된다', () => {
    const bus = EventBus.getInstance();
    bus.publish({ type: 'x' });
    bus.clearForTest();
    const stats = bus.getStats();
    assert.equal(stats.publishCount, 0);
    assert.equal(stats.handlerErrorCount, 0);
  });

  it('listenerCount를 stats에 포함한다', () => {
    const bus = EventBus.getInstance();
    bus.subscribe('x', () => {});
    bus.subscribe('y', () => {});
    const stats = bus.getStats();
    assert.ok(stats.listenerCount >= 2);
  });
});

// ── DLQ (Handler Error Callback) ────────────────────────────────────────────

describe('EventBus handler error callback (DLQ)', () => {
  it('setHandlerErrorCallback: 구독자 오류 발생 시 콜백이 호출된다', () => {
    const bus = EventBus.getInstance();
    const dlq = [];
    bus.setHandlerErrorCallback((entry) => dlq.push(entry));
    bus.subscribe('fail.event', () => { throw new Error('boom'); });

    bus.publish({ type: 'fail.event', id: 'X-1' });

    assert.equal(dlq.length, 1);
    assert.equal(dlq[0].event.id, 'X-1');
    assert.ok(dlq[0].errorMessage || dlq[0].error, 'error info should be present');
  });

  it('clearForTest()는 handler error callback을 null로 초기화한다', () => {
    const bus = EventBus.getInstance();
    const called = [];
    bus.setHandlerErrorCallback((e) => called.push(e));
    bus.clearForTest();
    bus.subscribe('e', () => { throw new Error('x'); });
    bus.publish({ type: 'e' });
    assert.equal(called.length, 0, 'callback should be cleared');
  });
});

// ── History (테스트 유틸) ───────────────────────────────────────────────────

describe('EventBus history', () => {
  it('enableHistory() 후 발행 이벤트가 기록된다', () => {
    const bus = EventBus.getInstance();
    bus.enableHistory();
    bus.publish({ type: 'task.deleted', id: 'T-99' });
    const history = bus.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].id, 'T-99');
  });

  it('getHistory()는 내부 배열 복사본을 반환한다', () => {
    const bus = EventBus.getInstance();
    bus.enableHistory();
    bus.publish({ type: 'x' });
    const h1 = bus.getHistory();
    h1.push({ type: 'injected' });
    assert.equal(bus.getHistory().length, 1);
  });
});
