'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, createAllEnabledFlags } = require('../../server/createServer');
const { startServerOrSkip } = require('./support/networkTestRuntime');

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), options);
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.json(),
  };
}

async function postJson(baseUrl, pathname, body, headers = {}) {
  return requestJson(baseUrl, pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function bootstrapScheduler(baseUrl, workers) {
  const sessions = await requestJson(baseUrl, '/api/pty/sessions');
  assert.equal(sessions.status, 200);
  assert.ok(Array.isArray(sessions.body.sessions));
  assert.ok(sessions.body.sessions.length >= 1);
  const pts = sessions.body.sessions[0].pts;

  const started = await postJson(baseUrl, '/api/pty/scheduler/start', {
    cycle_minutes: 15,
    enter_seconds: 5,
    workers: workers(pts),
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.ok, true);
  return pts;
}

async function sendSuccessfulPrompt(baseUrl) {
  const sent = await postJson(baseUrl, '/api/pty/send-now', { worker_index: 0 });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.results.length, 1);
  assert.equal(sent.body.results[0].worker, 'Adversarial Stable');
  assert.equal(sent.body.results[0].ok, true);
}

function stableWorkers(pts) {
  return [
    {
      name: 'Adversarial Stable',
      plan_id: 'WP-ADV-STABLE',
      pts,
      prompt: 'stable prompt',
      cycle_minutes: 15,
      enter_seconds: 5,
    },
    {
      name: 'Adversarial Secondary',
      plan_id: 'WP-ADV-SECONDARY',
      pts,
      prompt: 'secondary prompt',
      cycle_minutes: 15,
      enter_seconds: 5,
    },
  ];
}

test('[adversarial scheduler state smoke] invalid send-now index keeps last successful current activity', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    await bootstrapScheduler(runtime.url, stableWorkers);
    await sendSuccessfulPrompt(runtime.url);

    const invalidSend = await postJson(runtime.url, '/api/pty/send-now', { worker_index: 99 });
    assert.equal(invalidSend.status, 200);
    assert.equal(invalidSend.body.results.length, 1);
    assert.equal(invalidSend.body.results[0].ok, false);
    assert.match(String(invalidSend.body.results[0].error || ''), /index 99/);

    const controlRuntime = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntime.status, 200);
    assert.equal(controlRuntime.body.runtime_state.execution.current_activity.worker, 'Adversarial Stable');
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.current_execution, /running \/ Adversarial Stable/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.last_dispatch, /prompt \/ scheduler/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.blocked_at, /prompt \/ scheduler \/ pts 없음/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.failure_reason, /index 99/);
    assert.equal(controlRuntime.body.runtime_state.user_controls.failure_reason_visible, true);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[adversarial scheduler state smoke] invalid enter-now index keeps last successful current activity', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    await bootstrapScheduler(runtime.url, stableWorkers);
    await sendSuccessfulPrompt(runtime.url);

    const invalidEnter = await postJson(runtime.url, '/api/pty/enter-now', { worker_index: 99 });
    assert.equal(invalidEnter.status, 200);
    assert.equal(invalidEnter.body.results.length, 1);
    assert.equal(invalidEnter.body.results[0].ok, false);
    assert.match(String(invalidEnter.body.results[0].error || ''), /index 99/);

    const controlRuntime = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntime.status, 200);
    assert.equal(controlRuntime.body.runtime_state.execution.current_activity.worker, 'Adversarial Stable');
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.current_execution, /running \/ Adversarial Stable/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.last_dispatch, /enter \/ worker-99/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.blocked_at, /enter \/ worker-99 \/ pts 없음/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.failure_reason, /index 99/);
    assert.equal(controlRuntime.body.runtime_state.user_controls.failure_reason_visible, true);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[adversarial scheduler state smoke] invalid send-now idempotency replay preserves failure surface and current activity', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    await bootstrapScheduler(runtime.url, stableWorkers);
    await sendSuccessfulPrompt(runtime.url);

    const idempotencyKey = `adv-send-now-${Date.now()}`;
    const first = await postJson(runtime.url, '/api/pty/send-now', { worker_index: 99 }, {
      'idempotency-key': idempotencyKey,
    });
    assert.equal(first.status, 200);
    assert.equal(first.headers['idempotency-replayed'], undefined);
    assert.equal(first.body.results.length, 1);
    assert.equal(first.body.results[0].ok, false);

    const second = await postJson(runtime.url, '/api/pty/send-now', { worker_index: 99 }, {
      'idempotency-key': idempotencyKey,
    });
    assert.equal(second.status, 200);
    assert.equal(second.headers['idempotency-replayed'], 'true');
    assert.deepEqual(second.body, first.body);

    const controlRuntime = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntime.status, 200);
    assert.equal(controlRuntime.body.runtime_state.execution.current_activity.worker, 'Adversarial Stable');
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.current_execution, /running \/ Adversarial Stable/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.last_dispatch, /prompt \/ scheduler/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.failure_reason, /index 99/);
    assert.equal(controlRuntime.body.runtime_state.user_controls.failure_reason_visible, true);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
