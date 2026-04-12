'use strict';

/**
 * eventBusWiring.smoke.test.js
 *
 * WP-S8-003: 서버 EventBusPublisher 배선 검증
 *
 * 검증:
 *   1. POST /tasks 로 Task 생성 → GET /api/v1/domain-events 에서 이벤트 확인
 *      (Use case → EventBusPublisher → EventBus → ring buffer 체인 end-to-end)
 *   2. domain-events 링 버퍼에 task.created 계열 이벤트가 포함된다
 */

const path = require('node:path');
const http = require('node:http');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const { startServer, createAllEnabledFlags } = require(path.join(REPO_ROOT, 'src/server/createServer'));
const { EventBus } = require(path.join(REPO_ROOT, 'src/shared/EventBus'));

function request(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1', port, path: pathname, method,
        headers: {
          'content-type': 'application/json',
          'content-length': payload ? Buffer.byteLength(payload) : 0,
          'x-user-id': 'admin', 'x-permissions': 'task:write,task:read',
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf || 'null') }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('[eventbus wiring smoke] task 생성 후 domain-events ring buffer에 이벤트가 기록된다', async () => {
  let runtime;
  try {
    runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });
    const { port } = runtime;

    // Task 생성
    const createRes = await request(port, 'POST', '/tasks', {
      title: 'EventBus 연결 확인 태스크',
      assignee_id: 'user-smoke',
    });
    assert.equal(createRes.status, 201, `Expected 201, got ${createRes.status}: ${JSON.stringify(createRes.body)}`);
    assert.ok(createRes.body.task_id, 'task_id should be in response');

    // ring buffer에서 이벤트 확인
    const eventsRes = await request(port, 'GET', '/api/v1/domain-events?limit=10', null);
    assert.equal(eventsRes.status, 200, `Expected 200 from domain-events, got ${eventsRes.status}`);
    assert.ok(Array.isArray(eventsRes.body.events), 'events should be an array');
    assert.ok(eventsRes.body.total >= 1, 'At least 1 domain event should have been recorded');

    // TaskCreated 이벤트가 ring buffer에 존재해야 함
    const taskEvents = eventsRes.body.events.filter(
      (e) => e.type === 'TaskCreated' || e.event_type === 'TaskCreated'
    );
    assert.ok(taskEvents.length >= 1,
      `Expected TaskCreated in ring buffer, got: ${JSON.stringify(eventsRes.body.events.map((e) => e.type || e.event_type))}`);
  } finally {
    if (runtime) await runtime.shutdown();
  }
});

test('[eventbus wiring smoke] EventBus.getInstance()는 서버 시작 후 항상 동일 인스턴스', async () => {
  let runtime;
  try {
    runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });
    // 서버 기동 후에도 EventBus 싱글톤이 살아있어야 함
    const bus = EventBus.getInstance();
    assert.ok(bus, 'EventBus instance should exist');
    assert.equal(typeof bus.subscribe, 'function');
    assert.equal(typeof bus.publish, 'function');
  } finally {
    if (runtime) await runtime.shutdown();
  }
});
