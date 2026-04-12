'use strict';

/**
 * billingVideoEventWiring.smoke.test.js
 *
 * WP-S16-001: BillingController / VideoController가 EventBus에 도메인 이벤트를 발행함을 검증
 *
 * createBillingController() / createVideoController() 가
 * _sharedDomainEventPublisher를 전달받아 실제 EventBus에 이벤트를 쓰는지 end-to-end 검증
 */

const path = require('node:path');
const http = require('node:http');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const { startServer, createAllEnabledFlags } = require(path.join(REPO_ROOT, 'src/server/createServer'));

function request(port, method, pathname, body, permissions = 'billing.write,billing.read,task:write,task:read,video:write,video:read') {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1', port, path: pathname, method,
        headers: {
          'content-type': 'application/json',
          'content-length': payload ? Buffer.byteLength(payload) : 0,
          'x-user-id': 'admin',
          'x-permissions': permissions,
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf || 'null') }); }
          catch { resolve({ status: res.statusCode, body: buf }); }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('[billing video event wiring smoke] POST /invoices → InvoiceCreated 이벤트가 ring buffer에 기록된다', async () => {
  let runtime;
  try {
    runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });
    const { port } = runtime;

    // 인보이스 생성
    const createRes = await request(port, 'POST', '/billing/invoices', { customer_id: 'cust-smoke-001' });
    assert.equal(createRes.status, 201, `Expected 201, got ${createRes.status}: ${JSON.stringify(createRes.body)}`);
    assert.ok(createRes.body.invoice_id || createRes.body.id, 'invoice_id should be in response');

    // ring buffer 확인
    const eventsRes = await request(port, 'GET', '/api/v1/domain-events?limit=20', null);
    assert.equal(eventsRes.status, 200, `domain-events: ${JSON.stringify(eventsRes.body)}`);
    assert.ok(Array.isArray(eventsRes.body.events), 'events should be array');

    const invoiceEvents = eventsRes.body.events.filter(
      (e) => (e.type || e.event_type || '').toLowerCase().includes('invoice'),
    );
    assert.ok(
      invoiceEvents.length >= 1,
      `Expected InvoiceCreated in ring buffer, got: ${JSON.stringify(eventsRes.body.events.map((e) => e.type || e.event_type))}`,
    );
  } finally {
    if (runtime) await runtime.shutdown();
  }
});

test('[billing video event wiring smoke] POST /videos → VideoUploaded 이벤트가 ring buffer에 기록된다', async () => {
  let runtime;
  try {
    runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });
    const { port } = runtime;

    // 비디오 업로드
    const uploadRes = await request(port, 'POST', '/videos', {
      title: 'smoke-test-video',
      uploader_id: 'user-smoke',
      original_file_ref: 's3://bucket/smoke.mp4',
    });
    assert.equal(uploadRes.status, 201, `Expected 201, got ${uploadRes.status}: ${JSON.stringify(uploadRes.body)}`);
    assert.ok(uploadRes.body.video_id || uploadRes.body.id, 'video_id should be in response');

    // ring buffer 확인
    const eventsRes = await request(port, 'GET', '/api/v1/domain-events?limit=20', null);
    assert.equal(eventsRes.status, 200);
    assert.ok(Array.isArray(eventsRes.body.events), 'events should be array');

    const videoEvents = eventsRes.body.events.filter(
      (e) => (e.type || e.event_type || '').toLowerCase().includes('video'),
    );
    assert.ok(
      videoEvents.length >= 1,
      `Expected VideoUploaded in ring buffer, got: ${JSON.stringify(eventsRes.body.events.map((e) => e.type || e.event_type))}`,
    );
  } finally {
    if (runtime) await runtime.shutdown();
  }
});

test('[billing video event wiring smoke] EventBus getStats().publishCount가 billing+video 액션 후 증가한다', async () => {
  let runtime;
  try {
    runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });
    const { port } = runtime;

    // health에서 초기 publishCount 확인
    const health1 = await request(port, 'GET', '/health', null);
    assert.equal(health1.status, 200);
    const countBefore = health1.body?.observability?.event_bus?.publishCount ?? 0;

    // 인보이스 생성 + 비디오 업로드
    await request(port, 'POST', '/billing/invoices', { customer_id: 'cust-stats-001' });
    await request(port, 'POST', '/videos', {
      title: 'stats-video', uploader_id: 'u-1', original_file_ref: 's3://bucket/v.mp4',
    });

    const health2 = await request(port, 'GET', '/health', null);
    assert.equal(health2.status, 200);
    const countAfter = health2.body?.observability?.event_bus?.publishCount ?? 0;

    assert.ok(
      countAfter > countBefore,
      `publishCount should increase after billing+video ops: before=${countBefore} after=${countAfter}`,
    );
  } finally {
    if (runtime) await runtime.shutdown();
  }
});
