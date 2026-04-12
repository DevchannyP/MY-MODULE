'use strict';

/**
 * outboxPollerWiring.smoke.test.js
 *
 * WP-S9-001/S9-003: OutboxPoller 서버 배선 + graceful shutdown 검증
 *
 * 검증:
 *   1. 서버 기동 후 /api/v1/outbox/stats → poller isRunning=true
 *   2. 서버 shutdown 후 OutboxPoller가 정상 정지된다
 */

const path = require('node:path');
const http = require('node:http');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const { startServer, createAllEnabledFlags, _sharedOutboxPoller } = require(path.join(REPO_ROOT, 'src/server/createServer'));

function request(port, method, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: pathname, method,
        headers: { 'x-user-id': 'admin', 'x-permissions': '' } },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf || 'null') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('[outbox poller wiring smoke] 서버 기동 후 OutboxPoller가 실행 중이다', async () => {
  let runtime;
  try {
    runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });
    const { port } = runtime;

    const res = await request(port, 'GET', '/api/v1/outbox/stats');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(res.body.running, true, 'OutboxPoller should be running after server start');
    assert.ok(typeof res.body.stats === 'object', 'stats should be an object');
  } finally {
    if (runtime) await runtime.shutdown();
  }
});

test('[outbox poller wiring smoke] 서버 shutdown 후 OutboxPoller가 정지된다', async () => {
  const runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });
  assert.equal(_sharedOutboxPoller.isRunning, true, 'Poller should be running before shutdown');

  await runtime.shutdown();
  assert.equal(_sharedOutboxPoller.isRunning, false, 'Poller should stop after server shutdown');
});

test('[outbox poller wiring smoke] /health 엔드포인트가 observability 데이터를 포함한다', async () => {
  let runtime;
  try {
    runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });
    const { port } = runtime;

    const res = await request(port, 'GET', '/health');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const obs = res.body.observability;
    assert.ok(obs, 'observability field should exist in health response');
    assert.ok(typeof obs.event_bus.publishCount === 'number', 'event_bus.publishCount should be a number');
    assert.ok(typeof obs.event_bus.listenerCount === 'number', 'event_bus.listenerCount should be a number');
    assert.equal(obs.outbox_poller.running, true, 'outbox_poller.running should be true');
    assert.equal(typeof obs.dlq_size, 'number', 'dlq_size should be a number');
  } finally {
    if (runtime) await runtime.shutdown();
  }
});

test('[outbox poller wiring smoke] /api/v1/domain-events/dlq 엔드포인트가 응답한다', async () => {
  let runtime;
  try {
    runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });
    const { port } = runtime;

    const res = await request(port, 'GET', '/api/v1/domain-events/dlq');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(Array.isArray(res.body.entries), 'entries should be an array');
    assert.equal(typeof res.body.total, 'number', 'total should be a number');
  } finally {
    if (runtime) await runtime.shutdown();
  }
});
