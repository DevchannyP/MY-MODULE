'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createAppHandler, createAllEnabledFlags } = require('../../server/createServer');
const { HarnessProviderAdapter } = require('../../infrastructure/ai/HarnessProviderAdapter');
const { EventBus } = require('../../shared/EventBus');

const ROOT = path.resolve(__dirname, '../../..');

function copyRecursive(source, target) {
  fs.cpSync(source, target, { recursive: true });
}

function createRuntimeRoot() {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpo-runtime-'));
  [
    'contracts',
    'requirements',
    'memory',
    'docs',
    'scripts',
    'src',
    'artifacts',
    'domains',
    'evals',
    'package.json',
    'package-lock.json',
  ].forEach((entry) => {
    const source = path.join(ROOT, entry);
    const target = path.join(runtimeRoot, entry);
    if (fs.existsSync(source)) {
      copyRecursive(source, target);
    }
  });
  return runtimeRoot;
}

function makeRequest({ method, pathname, body: _body = null, headers = {} }) {
  const req = new EventEmitter();
  req.method = method;
  req.url = `http://localhost${pathname}`;
  req.headers = {
    'x-user-id': 'test-user',
    'content-type': 'application/json',
    ...headers,
  };
  req.resume = () => {};
  return req;
}

function makeResponse() {
  let endResolve;
  const ended = new Promise((resolve) => {
    endResolve = resolve;
  });
  return {
    statusCode: null,
    headers: {},
    body: '',
    ended,
    writeHead(code, headers = {}) {
      this.statusCode = code;
      Object.assign(this.headers, headers);
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
    write(chunk) {
      this.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    },
    end(chunk) {
      if (chunk) {
        this.write(chunk);
      }
      endResolve();
    },
  };
}

async function invoke(handler, { method, pathname, body = null, headers = {}, keepOpen = false }) {
  const req = makeRequest({ method, pathname, body, headers });
  const res = makeResponse();
  const bodyText = body ? JSON.stringify(body) : '';
  const promise = handler(req, res);
  process.nextTick(() => {
    if (bodyText) {
      req.emit('data', Buffer.from(bodyText));
    }
    req.emit('end');
  });
  await promise;
  if (!keepOpen) {
    await res.ended;
  }
  return { req, res };
}

test('[mpo runtime smoke] in-process /api/v1/mpo/plan auto-approves and completes representative flow', async () => {
  const runtimeRoot = createRuntimeRoot();
  const handler = createAppHandler({
    flags: createAllEnabledFlags(),
    runtimeRoot,
    harnessProviderAdapter: new HarnessProviderAdapter({ root: runtimeRoot }),
  });

  const first = await invoke(handler, {
    method: 'POST',
    pathname: '/api/v1/mpo/plan',
    body: {
      goal: '문서 정리와 MPO dry-run 검증 경로를 확인해줘',
    },
  });
  assert.equal(first.res.statusCode, 202);
  const planned = JSON.parse(first.res.body);
  assert.equal(planned.approval_state, 'auto-approved');
  assert.equal(typeof planned.session_id, 'string');

  let final = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await invoke(handler, {
      method: 'GET',
      pathname: `/api/v1/mpo/session/${planned.session_id}`,
    });
    final = JSON.parse(current.res.body);
    if (final.status === 'completed' || final.status === 'failed') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(final, 'final session state must be readable');
  assert.equal(final.status, 'completed');
  assert.equal(final.execution.results.length, 4);
  assert.ok(fs.existsSync(path.join(runtimeRoot, final.execution.reconcile.report_path)));
});

test('[mpo runtime smoke] approval-required plan waits, then executes after explicit approve', async () => {
  const runtimeRoot = createRuntimeRoot();
  const handler = createAppHandler({
    flags: createAllEnabledFlags(),
    runtimeRoot,
    harnessProviderAdapter: new HarnessProviderAdapter({ root: runtimeRoot }),
  });

  const first = await invoke(handler, {
    method: 'POST',
    pathname: '/api/v1/mpo/plan',
    body: {
      goal: 'Video 도메인에 SQLite 어댑터 연결하고 통합 테스트 추가해줘',
    },
  });
  assert.equal(first.res.statusCode, 200);
  const planned = JSON.parse(first.res.body);
  assert.equal(planned.status, 'awaiting_approval');
  assert.equal(planned.approval_state, 'pending-approval');

  const approved = await invoke(handler, {
    method: 'POST',
    pathname: `/api/v1/mpo/session/${planned.session_id}/approve`,
    body: {},
  });
  assert.equal(approved.res.statusCode, 202);

  let final = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await invoke(handler, {
      method: 'GET',
      pathname: `/api/v1/mpo/session/${planned.session_id}`,
    });
    final = JSON.parse(current.res.body);
    if (final.status === 'completed' || final.status === 'failed') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(final, 'approved session must finish');
  assert.equal(final.status, 'completed');
});

test('[mpo runtime smoke] auto-replanned execution surfaces completed_with_replan session status', async () => {
  const runtimeRoot = createRuntimeRoot();
  let injectedFailure = false;
  const handler = createAppHandler({
    flags: createAllEnabledFlags(),
    runtimeRoot,
    harnessProviderAdapter: {
      async executeWorkPacket({ route = {}, sessionId = '', wp = {} } = {}) {
        if (!wp.execution_result || wp.execution_result.auto_replan !== true) {
          if (!injectedFailure) {
            injectedFailure = true;
            return {
              session_id: sessionId,
              wp_id: wp.id,
              changed_files: ['node_modules/blocked.js'],
              provider: {
                provider_id: 'smoke-provider',
                route_id: String(route.route_id || 'smoke-route'),
                selected_model_tier: String(route.selected_model_tier || 'mini'),
                reasoning_effort: String(route.reasoning_effort || 'medium'),
                fallback_applied: false,
                model: 'smoke-mini',
              },
            };
          }
          return {
            session_id: sessionId,
            wp_id: wp.id,
            changed_files: [],
            provider: {
              provider_id: 'smoke-provider',
              route_id: String(route.route_id || 'smoke-route'),
              selected_model_tier: String(route.selected_model_tier || 'mini'),
              reasoning_effort: String(route.reasoning_effort || 'medium'),
              fallback_applied: false,
              model: 'smoke-mini',
            },
          };
        }
        return {
          session_id: sessionId,
          wp_id: wp.id,
          changed_files: [],
          provider: {
            provider_id: 'smoke-provider',
            route_id: String(route.route_id || 'smoke-route'),
            selected_model_tier: String(route.selected_model_tier || 'standard'),
            reasoning_effort: String(route.reasoning_effort || 'medium'),
            fallback_applied: false,
            model: 'smoke-standard',
          },
        };
      },
    },
  });

  const first = await invoke(handler, {
    method: 'POST',
    pathname: '/api/v1/mpo/plan',
    body: {
      goal: '문서 정리와 MPO dry-run 검증 경로를 확인해줘',
    },
  });
  assert.equal(first.res.statusCode, 202);
  const planned = JSON.parse(first.res.body);

  let final = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await invoke(handler, {
      method: 'GET',
      pathname: `/api/v1/mpo/session/${planned.session_id}`,
    });
    final = JSON.parse(current.res.body);
    if (final.status === 'completed_with_replan' || final.status === 'failed') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(final, 'replanned session must be readable');
  assert.equal(final.status, 'completed_with_replan');
  assert.equal(final.execution.replanned, true);
  assert.equal(final.execution.results.length, 5);
  assert.ok(final.execution.results.some((entry) => entry.wp && /-REPLAN$/.test(entry.wp.id)));
  assert.ok(final.execution.results.some((entry) => entry.wp && entry.wp.id === 'WP-AUTO-004'));
  assert.ok(final.events.some((entry) => entry.type === 'mpo.plan.replanned'));
});

test('[mpo runtime smoke] /api/v1/system/events streams mpo.* events over SSE', async () => {
  const runtimeRoot = createRuntimeRoot();
  const handler = createAppHandler({
    flags: createAllEnabledFlags(),
    runtimeRoot,
    harnessProviderAdapter: new HarnessProviderAdapter({ root: runtimeRoot }),
  });
  const bus = EventBus.getInstance();
  const open = await invoke(handler, {
    method: 'GET',
    pathname: '/api/v1/system/events',
    keepOpen: true,
  });

  assert.equal(open.res.statusCode, 200);
  assert.match(String(open.res.headers['content-type'] || ''), /text\/event-stream/);
  assert.match(open.res.body, /event: mpo.connected/);

  bus.publish({
    type: 'mpo.test.event',
    session_id: 'mpo-test-session',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(open.res.body, /event: mpo.test.event/);

  open.req.emit('close');
});
