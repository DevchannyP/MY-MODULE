'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { InMemoryEventPublisher, toCloudEvent } = require('../../shared/EventPublisher');
const { startServer, createAllEnabledFlags } = require('../../server/createServer');
const { startServerOrSkip } = require('./support/networkTestRuntime');

describe('[domain event bus smoke] InMemoryEventPublisher observer pattern', () => {
  test('onPublish callback fires for each published event', async () => {
    const publisher = new InMemoryEventPublisher();
    const received = [];
    publisher.onPublish((evt) => received.push(evt));

    const evt1 = { event_type: 'TaskCreated',      aggregateId: 'task-1', payload: {} };
    const evt2 = { event_type: 'TaskStatusChanged', aggregateId: 'task-1', payload: {} };
    await publisher.publish([evt1, evt2]);

    assert.equal(received.length, 2);
    assert.equal(received[0].event_type, 'TaskCreated');
    assert.equal(received[1].event_type, 'TaskStatusChanged');
  });

  test('multiple subscribers all receive the same event', async () => {
    const publisher = new InMemoryEventPublisher();
    const bucketA = [];
    const bucketB = [];
    publisher.onPublish((e) => bucketA.push(e.event_type));
    publisher.onPublish((e) => bucketB.push(e.event_type));

    await publisher.publish({ event_type: 'InvoiceCreated', payload: {} });

    assert.deepEqual(bucketA, ['InvoiceCreated']);
    assert.deepEqual(bucketB, ['InvoiceCreated']);
  });

  test('subscriber error does not break subsequent subscribers or publisher', async () => {
    const publisher = new InMemoryEventPublisher();
    const goodBucket = [];
    publisher.onPublish(() => { throw new Error('subscriber failure'); });
    publisher.onPublish((e) => goodBucket.push(e.event_type));

    await assert.doesNotReject(() => publisher.publish({ event_type: 'PaymentMismatch', payload: {} }));
    assert.deepEqual(goodBucket, ['PaymentMismatch']);
    assert.equal(publisher.published.length, 1);
  });

  test('published events still accumulate in .published array', async () => {
    const publisher = new InMemoryEventPublisher();
    publisher.onPublish(() => {}); // subscriber present
    await publisher.publish([
      { event_type: 'A', payload: {} },
      { event_type: 'B', payload: {} },
    ]);
    assert.equal(publisher.published.length, 2);
  });

  test('toCloudEvent wraps domain event in CloudEvents v1.0 envelope', () => {
    const domainEvt = { event_type: 'TaskCreated', aggregateId: 'task-42', payload: { title: 'test' } };
    const ce = toCloudEvent(domainEvt, '//workflow-os/productivity/task-tracking');

    assert.equal(ce.specversion, '1.0');
    assert.ok(typeof ce.id === 'string' && ce.id.length > 0);
    assert.equal(ce.source, '//workflow-os/productivity/task-tracking');
    assert.equal(ce.datacontenttype, 'application/json');
    assert.equal(ce.subject, 'task-42');
    assert.equal(ce.data, domainEvt);
  });

  test('single event (non-array) published via onPublish fires callback once', async () => {
    const publisher = new InMemoryEventPublisher();
    let count = 0;
    publisher.onPublish(() => { count++; });
    await publisher.publish({ event_type: 'BillingExceptionApproved', payload: {} });
    assert.equal(count, 1);
  });
});

describe('[domain event bus smoke] GET /api/v1/domain-events — ring buffer observable', () => {
  let serverHandle;

  test('domain events from POST /tasks appear at GET /api/v1/domain-events', async (t) => {
    const flags = createAllEnabledFlags();
    serverHandle = await startServerOrSkip(t, startServer, { port: 0, flags });
    if (!serverHandle) {
      return;
    }
    const { port } = serverHandle;

    // Create a task — this triggers TaskCreated domain event via _sharedDomainEventPublisher
    const createRes = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ title: 'event-bus-smoke', assignee_id: 'u-1' });
      const req = http.request({
        hostname: '127.0.0.1', port, method: 'POST', path: '/tasks',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-user-id': 'smoke-user',
          'x-permissions': 'task:write',
          'idempotency-key': `evt-bus-smoke-${Date.now()}`,
        },
      }, resolve);
      req.on('error', reject);
      req.end(body);
    });
    assert.equal(createRes.statusCode, 201);

    // Drain response body
    await new Promise((resolve) => { createRes.resume(); createRes.on('end', resolve); });

    // Poll domain events endpoint
    const eventsRes = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port, method: 'GET', path: '/api/v1/domain-events',
        headers: { 'x-user-id': 'smoke-user', 'x-permissions': 'task:read' },
      }, resolve);
      req.on('error', reject);
      req.end();
    });
    assert.equal(eventsRes.statusCode, 200);

    let raw = '';
    for await (const chunk of eventsRes) raw += chunk;
    const data = JSON.parse(raw);

    assert.ok(typeof data.total === 'number');
    assert.ok(Array.isArray(data.events));
    const taskCreated = data.events.find((e) => e.event_type === 'TaskCreated');
    assert.ok(taskCreated, 'TaskCreated event must appear in domain event ring buffer');
    assert.ok(taskCreated._observed_at, '_observed_at timestamp must be present');
  });

  test.after(async () => {
    if (serverHandle) await serverHandle.shutdown();
  });
});
