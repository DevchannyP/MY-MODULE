'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, createAllEnabledFlags } = require('../../server/createServer');
const { startServerOrSkip } = require('./support/networkTestRuntime');

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), options);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function postJson(baseUrl, pathname, body) {
  return requestJson(baseUrl, pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('[scheduler current activity smoke] successful send-now selects dispatched worker as current activity', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
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
          name: 'Scheduler Alpha',
          plan_id: 'WP-SCHED-ALPHA',
          pts: selectedSession.pts,
          prompt: 'alpha prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
        {
          name: 'Scheduler Beta',
          plan_id: 'WP-SCHED-BETA',
          pts: selectedSession.pts,
          prompt: 'beta prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
      ],
    });
    assert.equal(schedulerStart.status, 200);
    assert.equal(schedulerStart.body.ok, true);

    const sent = await postJson(runtime.url, '/api/pty/send-now', {
      worker_index: 1,
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.results.length, 1);
    assert.equal(sent.body.results[0].worker, 'Scheduler Beta');
    assert.equal(sent.body.results[0].ok, true);

    const controlRuntime = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntime.status, 200);
    assert.equal(controlRuntime.body.runtime_state.scheduler.active_worker_index, 1);
    assert.equal(controlRuntime.body.runtime_state.scheduler.current_worker_index, 1);
    assert.equal(controlRuntime.body.runtime_state.execution.current_worker_index, 1);
    assert.equal(controlRuntime.body.runtime_state.execution.current_activity.worker, 'Scheduler Beta');
    assert.equal(controlRuntime.body.runtime_state.execution.current_activity.worker_index, 1);
    assert.equal(controlRuntime.body.runtime_state.execution.last_activity.worker, 'Scheduler Beta');
    assert.equal(controlRuntime.body.runtime_state.execution.last_activity.worker_index, 1);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.current_execution, /running \/ Scheduler Beta/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.last_dispatch, /prompt \/ Scheduler Beta/);
    assert.equal(controlRuntime.body.runtime_state.execution.operator_brief.blocked_at, '없음');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[scheduler current activity smoke] failed send-now keeps last successful current activity while exposing failure details', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
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
          name: 'Scheduler Stable',
          plan_id: 'WP-SCHED-STABLE',
          pts: selectedSession.pts,
          prompt: 'stable prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
        {
          name: 'Scheduler Broken',
          plan_id: 'WP-SCHED-BROKEN',
          pts: '/dev/pts/99999',
          prompt: 'broken prompt',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
      ],
    });
    assert.equal(schedulerStart.status, 200);
    assert.equal(schedulerStart.body.ok, true);

    const stableSend = await postJson(runtime.url, '/api/pty/send-now', {
      worker_index: 0,
    });
    assert.equal(stableSend.status, 200);
    assert.equal(stableSend.body.results[0].worker, 'Scheduler Stable');
    assert.equal(stableSend.body.results[0].ok, true);

    const failedSend = await postJson(runtime.url, '/api/pty/send-now', {
      worker_index: 1,
    });
    assert.equal(failedSend.status, 200);
    assert.equal(failedSend.body.results[0].worker, 'Scheduler Broken');
    assert.equal(failedSend.body.results[0].ok, false);
    assert.match(String(failedSend.body.results[0].error || ''), /\/dev\/pts\/99999/);

    const controlRuntime = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntime.status, 200);
    assert.equal(controlRuntime.body.runtime_state.scheduler.active_worker_index, 0);
    assert.equal(controlRuntime.body.runtime_state.scheduler.current_worker_index, 0);
    assert.equal(controlRuntime.body.runtime_state.execution.current_worker_index, 0);
    assert.equal(controlRuntime.body.runtime_state.execution.current_activity.worker, 'Scheduler Stable');
    assert.equal(controlRuntime.body.runtime_state.execution.current_activity.worker_index, 0);
    assert.equal(controlRuntime.body.runtime_state.execution.last_error.worker, 'Scheduler Broken');
    assert.equal(controlRuntime.body.runtime_state.execution.last_error.worker_index, 1);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.current_execution, /running \/ Scheduler Stable/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.last_dispatch, /prompt \/ Scheduler Broken/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.blocked_at, /prompt \/ Scheduler Broken \/ \/dev\/pts\/99999/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.failure_reason, /알 수 없는 PTY 세션입니다: \/dev\/pts\/99999/);
    assert.equal(controlRuntime.body.runtime_state.user_controls.failure_reason_visible, true);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[scheduler current activity smoke] targeted enter-now moves current activity to the selected worker', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
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
          name: 'Enter Alpha',
          plan_id: 'WP-ENTER-ALPHA',
          pts: selectedSession.pts,
          prompt: 'alpha enter',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
        {
          name: 'Enter Beta',
          plan_id: 'WP-ENTER-BETA',
          pts: selectedSession.pts,
          prompt: 'beta enter',
          cycle_minutes: 15,
          enter_seconds: 5,
        },
      ],
    });
    assert.equal(schedulerStart.status, 200);
    assert.equal(schedulerStart.body.ok, true);

    const entered = await postJson(runtime.url, '/api/pty/enter-now', {
      worker_index: 1,
    });
    assert.equal(entered.status, 200);
    assert.equal(entered.body.results.length, 1);
    assert.equal(entered.body.results[0].worker, 'Enter Beta');
    assert.equal(entered.body.results[0].ok, true);

    const controlRuntime = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntime.status, 200);
    assert.equal(controlRuntime.body.runtime_state.scheduler.active_worker_index, 1);
    assert.equal(controlRuntime.body.runtime_state.scheduler.current_worker_index, 1);
    assert.equal(controlRuntime.body.runtime_state.execution.current_worker_index, 1);
    assert.equal(controlRuntime.body.runtime_state.execution.current_activity.worker, 'Enter Beta');
    assert.equal(controlRuntime.body.runtime_state.execution.current_activity.worker_index, 1);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.current_execution, /running \/ Enter Beta/);
    assert.match(controlRuntime.body.runtime_state.execution.operator_brief.last_dispatch, /enter \/ Enter Beta/);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
