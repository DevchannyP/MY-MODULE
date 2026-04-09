'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, createAllEnabledFlags } = require('../../server/createServer');
const { startServerOrSkip } = require('./support/networkTestRuntime');

async function requestText(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  return {
    status: response.status,
    text: await response.text(),
  };
}

async function requestJson(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function postJson(baseUrl, pathname, body) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test('[mindmap control center browser interaction smoke] selected worker wiring reaches send-now runtime path', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    const mindmap = await requestText(runtime.url, '/mindmap/index.html');
    assert.equal(mindmap.status, 200);
    assert.match(mindmap.text, /id="execution-worker-select"/);
    assert.match(mindmap.text, /dispatchSchedulerPromptNow\(\)/);
    assert.match(mindmap.text, /worker_index: workerIndex/);
    assert.match(mindmap.text, /execution-worker-action/);
    assert.match(mindmap.text, /focusExecutionWorker\(/);
    assert.match(mindmap.text, /sendExecutionWorkerNow\(/);
    assert.match(mindmap.text, /function focusExecutionWorker\(index\)/);
    assert.match(mindmap.text, /function sendExecutionWorkerNow\(index\)/);
    assert.match(mindmap.text, /S\.execution\.selectedWorkerIndex = index;/);
    assert.match(mindmap.text, /dispatchSchedulerPromptNow\(\);/);
    assert.match(mindmap.text, /window\.focusExecutionWorker = focusExecutionWorker;/);
    assert.match(mindmap.text, /window\.sendExecutionWorkerNow = sendExecutionWorkerNow;/);

    const ptySessions = await requestJson(runtime.url, '/api/pty/sessions');
    assert.equal(ptySessions.status, 200);
    assert.ok(Array.isArray(ptySessions.body.sessions));
    assert.ok(ptySessions.body.sessions.length >= 1);

    const selectedSession = ptySessions.body.sessions[0];
    const schedulerStart = await postJson(runtime.url, '/api/pty/scheduler/start', {
      cycle_minutes: 15,
      enter_seconds: 5,
      workers: [
        {
          name: 'Browser Worker Alpha',
          plan_id: 'WP-BROWSER-A',
          pts: selectedSession.pts,
          prompt: 'alpha prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
        {
          name: 'Browser Worker Beta',
          plan_id: 'WP-BROWSER-B',
          pts: selectedSession.pts,
          prompt: 'beta prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
      ],
    });
    assert.equal(schedulerStart.status, 200);
    assert.equal(schedulerStart.body.ok, true);
    assert.equal(schedulerStart.body.workers, 2);

    const controlRuntimeBeforeSend = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntimeBeforeSend.status, 200);
    assert.equal(controlRuntimeBeforeSend.body.runtime_state.scheduler.workers.length, 2);
    assert.equal(controlRuntimeBeforeSend.body.runtime_state.scheduler.workers[1].name, 'Browser Worker Beta');

    const sendSelectedWorker = await postJson(runtime.url, '/api/pty/send-now', {
      worker_index: 1,
    });
    assert.equal(sendSelectedWorker.status, 200);
    assert.ok(Array.isArray(sendSelectedWorker.body.results));
    assert.equal(sendSelectedWorker.body.results.length, 1);
    assert.equal(sendSelectedWorker.body.results[0].worker, 'Browser Worker Beta');
    assert.equal(sendSelectedWorker.body.results[0].ok, true);
    assert.equal(sendSelectedWorker.body.results[0].error, null);

    const controlRuntimeAfterSend = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntimeAfterSend.status, 200);
    assert.equal(controlRuntimeAfterSend.body.runtime_state.execution.last_activity.worker, 'Browser Worker Beta');
    assert.equal(controlRuntimeAfterSend.body.runtime_state.execution.last_activity.packet_id, 'WP-BROWSER-B');
    assert.equal(controlRuntimeAfterSend.body.runtime_state.execution.last_prompt_text, 'beta prompt');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[mindmap control center browser interaction smoke] selected failing worker propagates runtime error details', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    const mindmap = await requestText(runtime.url, '/mindmap/index.html');
    assert.equal(mindmap.status, 200);
    assert.match(mindmap.text, /이 worker 즉시 전송/);
    assert.match(mindmap.text, /이 worker 재시도/);
    assert.match(mindmap.text, /execution-worker-action primary/);
    assert.match(mindmap.text, /execution-worker-action secondary/);
    assert.match(mindmap.text, /execution-worker-action warn/);
    assert.match(mindmap.text, /focusExecutionWorker\(/);
    assert.match(mindmap.text, /sendExecutionWorkerNow\(/);
    assert.match(mindmap.text, /retryExecutionWorker\(/);
    assert.match(mindmap.text, /stopAutoSendFromWorkerCard\(/);
    assert.match(mindmap.text, /function retryExecutionWorker\(index\)/);
    assert.match(mindmap.text, /function stopAutoSendFromWorkerCard\(index\)/);
    assert.match(mindmap.text, /재시도 비활성화/);
    assert.match(mindmap.text, /자동 전송 중지 비활성화/);
    assert.match(mindmap.text, /이 worker에서 자동 전송 중지/);
    assert.match(mindmap.text, /window\.retryExecutionWorker = retryExecutionWorker;/);
    assert.match(mindmap.text, /window\.stopAutoSendFromWorkerCard = stopAutoSendFromWorkerCard;/);

    const ptySessions = await requestJson(runtime.url, '/api/pty/sessions');
    assert.equal(ptySessions.status, 200);
    assert.ok(Array.isArray(ptySessions.body.sessions));
    assert.ok(ptySessions.body.sessions.length >= 1);

    const selectedSession = ptySessions.body.sessions[0];
    const schedulerStart = await postJson(runtime.url, '/api/pty/scheduler/start', {
      cycle_minutes: 15,
      enter_seconds: 5,
      workers: [
        {
          name: 'Browser Worker Stable',
          plan_id: 'WP-BROWSER-STABLE',
          pts: selectedSession.pts,
          prompt: 'stable prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
        {
          name: 'Browser Worker Broken',
          plan_id: 'WP-BROWSER-BROKEN',
          pts: '/dev/pts/99999',
          prompt: 'broken prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
      ],
    });
    assert.equal(schedulerStart.status, 200);
    assert.equal(schedulerStart.body.ok, true);
    assert.equal(schedulerStart.body.workers, 2);

    const sendSelectedWorker = await postJson(runtime.url, '/api/pty/send-now', {
      worker_index: 1,
    });
    assert.equal(sendSelectedWorker.status, 200);
    assert.ok(Array.isArray(sendSelectedWorker.body.results));
    assert.equal(sendSelectedWorker.body.results.length, 1);
    assert.equal(sendSelectedWorker.body.results[0].worker, 'Browser Worker Broken');
    assert.equal(sendSelectedWorker.body.results[0].ok, false);
    assert.match(String(sendSelectedWorker.body.results[0].error || ''), /알 수 없는 PTY 세션입니다: \/dev\/pts\/99999/);

    const controlRuntimeAfterFailure = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntimeAfterFailure.status, 200);
    assert.equal(controlRuntimeAfterFailure.body.runtime_state.execution.last_error.worker, 'Browser Worker Broken');
    assert.equal(controlRuntimeAfterFailure.body.runtime_state.execution.last_error.packet_id, 'WP-BROWSER-BROKEN');
    assert.equal(controlRuntimeAfterFailure.body.runtime_state.execution.last_error.ok, false);
    assert.match(String(controlRuntimeAfterFailure.body.runtime_state.execution.last_error.error || ''), /알 수 없는 PTY 세션입니다: \/dev\/pts\/99999/);
    assert.equal(controlRuntimeAfterFailure.body.runtime_state.user_controls.failure_reason_visible, true);
    assert.match(String(controlRuntimeAfterFailure.body.runtime_state.execution.next_action || ''), /실패 원인/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[mindmap control center browser interaction smoke] send-now idempotency key replays completed response', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    const ptySessions = await requestJson(runtime.url, '/api/pty/sessions');
    assert.equal(ptySessions.status, 200);
    assert.ok(ptySessions.body.sessions.length >= 1);

    const selectedSession = ptySessions.body.sessions[0];
    const schedulerStart = await postJson(runtime.url, '/api/pty/scheduler/start', {
      cycle_minutes: 15,
      enter_seconds: 5,
      workers: [
        {
          name: 'Idempotency Worker',
          plan_id: 'WP-IDEM-TEST',
          pts: selectedSession.pts,
          prompt: 'idempotency test prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
      ],
    });
    assert.equal(schedulerStart.status, 200);

    const idempotencyKey = `send-now-idem-${Date.now()}`;

    // First request — should succeed and store result
    const first = await fetch(new URL('/api/pty/send-now', runtime.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ worker_index: 0 }),
    });
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('idempotency-replayed'), null, 'first request must not be replayed');
    assert.ok(Array.isArray(firstBody.results));
    assert.equal(firstBody.results[0].ok, true);

    // Second request — same key, same path → must replay
    const second = await fetch(new URL('/api/pty/send-now', runtime.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ worker_index: 0 }),
    });
    const secondBody = await second.json();
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('idempotency-replayed'), 'true', 'second request must be replayed');
    assert.deepEqual(secondBody, firstBody, 'replayed body must match original');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[mindmap control center browser interaction smoke] enter-now worker_index targets single worker', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    const ptySessions = await requestJson(runtime.url, '/api/pty/sessions');
    assert.equal(ptySessions.status, 200);
    assert.ok(ptySessions.body.sessions.length >= 1);
    const selectedSession = ptySessions.body.sessions[0];

    await postJson(runtime.url, '/api/pty/scheduler/start', {
      cycle_minutes: 15,
      enter_seconds: 5,
      workers: [
        { name: 'Enter Alpha', plan_id: 'WP-ENTER-A', pts: selectedSession.pts, prompt: 'alpha', cycle_minutes: 15, enter_seconds: 5 },
        { name: 'Enter Beta', plan_id: 'WP-ENTER-B', pts: selectedSession.pts, prompt: 'beta', cycle_minutes: 15, enter_seconds: 5 },
      ],
    });

    // No worker_index — should target ALL workers (2 results)
    const allWorkers = await postJson(runtime.url, '/api/pty/enter-now', {});
    assert.equal(allWorkers.status, 200);
    assert.equal(allWorkers.body.results.length, 2, 'no worker_index → all workers');
    assert.ok(allWorkers.body.results.every((r) => r.ok === true));

    // worker_index: 1 — should target only Beta
    const specificWorker = await postJson(runtime.url, '/api/pty/enter-now', { worker_index: 1 });
    assert.equal(specificWorker.status, 200);
    assert.equal(specificWorker.body.results.length, 1, 'worker_index:1 → single worker');
    assert.equal(specificWorker.body.results[0].worker, 'Enter Beta');
    assert.equal(specificWorker.body.results[0].ok, true);

    // worker_index out of range — should return error result
    const invalidWorker = await postJson(runtime.url, '/api/pty/enter-now', { worker_index: 99 });
    assert.equal(invalidWorker.status, 200);
    assert.equal(invalidWorker.body.results.length, 1);
    assert.equal(invalidWorker.body.results[0].ok, false);
    assert.match(String(invalidWorker.body.results[0].error || ''), /99/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
