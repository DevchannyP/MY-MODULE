'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventBus } = require('../../shared/EventBus');
const { EventBusPublisher } = require('../../shared/EventBusPublisher');

beforeEach(() => EventBus._resetForTest());
after(() => EventBus._resetForTest());

describe('EventBusPublisher', () => {
  it('EventPublisher 포트를 구현한다 (publish 메서드 존재)', () => {
    const pub = new EventBusPublisher();
    assert.equal(typeof pub.publish, 'function');
  });

  it('publish: 도메인 이벤트가 EventBus를 통해 구독자에게 전달된다', async () => {
    const bus = EventBus.getInstance();
    bus.enableHistory();
    const received = [];
    bus.subscribe('TaskCreated', (e) => received.push(e));

    const pub = new EventBusPublisher(bus);
    await pub.publish([{ event_type: 'TaskCreated', aggregateId: 'T-001', payload: {} }]);

    assert.equal(received.length, 1);
    assert.equal(received[0].type, 'TaskCreated');
    assert.equal(received[0].aggregateId, 'T-001');
  });

  it('publish: event.type 필드를 우선 사용한다', async () => {
    const bus = EventBus.getInstance();
    const received = [];
    bus.subscribe('custom.type', (e) => received.push(e));

    const pub = new EventBusPublisher(bus);
    await pub.publish([{ type: 'custom.type', event_type: 'other.type' }]);

    assert.equal(received.length, 1);
    assert.equal(received[0].type, 'custom.type');
  });

  it('publish: event_type 없으면 domain.unknown 폴백', async () => {
    const bus = EventBus.getInstance();
    const received = [];
    bus.subscribe('domain.unknown', (e) => received.push(e));

    const pub = new EventBusPublisher(bus);
    await pub.publish([{ aggregateId: 'X' }]);

    assert.equal(received.length, 1);
  });

  it('publish: 배열이 아닌 단일 이벤트도 처리한다', async () => {
    const bus = EventBus.getInstance();
    const received = [];
    bus.subscribe('*', (e) => received.push(e));

    const pub = new EventBusPublisher(bus);
    await pub.publish({ event_type: 'TaskUpdated', id: 'T-002' });

    assert.equal(received.length, 1);
  });

  it('publish: 복수 이벤트 배열을 순서대로 발행한다', async () => {
    const bus = EventBus.getInstance();
    const order = [];
    bus.subscribe('*', (e) => order.push(e.seq));

    const pub = new EventBusPublisher(bus);
    await pub.publish([
      { event_type: 'A', seq: 1 },
      { event_type: 'B', seq: 2 },
      { event_type: 'C', seq: 3 },
    ]);

    assert.deepEqual(order, [1, 2, 3]);
  });

  it('constructor: 외부 EventBus 인스턴스를 주입할 수 있다', () => {
    EventBus._resetForTest();
    const customBus = EventBus.getInstance();
    const pub = new EventBusPublisher(customBus);
    assert.strictEqual(pub.bus, customBus);
  });

  it('constructor: 인자 없으면 EventBus.getInstance() 사용', () => {
    const bus = EventBus.getInstance();
    const pub = new EventBusPublisher();
    assert.strictEqual(pub.bus, bus);
  });
});
