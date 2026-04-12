'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

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

function validWorkers(pts) {
  return [
    {
      name: 'Property Alpha',
      plan_id: 'WP-PROP-ALPHA',
      pts,
      prompt: 'alpha prompt',
      cycle_minutes: 15,
      enter_seconds: 5,
    },
    {
      name: 'Property Beta',
      plan_id: 'WP-PROP-BETA',
      pts,
      prompt: 'beta prompt',
      cycle_minutes: 15,
      enter_seconds: 5,
    },
  ];
}

function brokenWorkers(pts) {
  return [
    {
      name: 'Property Stable',
      plan_id: 'WP-PROP-STABLE',
      pts,
      prompt: 'stable prompt',
      cycle_minutes: 15,
      enter_seconds: 5,
    },
    {
      name: 'Property Broken',
      plan_id: 'WP-PROP-BROKEN',
      pts: '/dev/pts/99999',
      prompt: 'broken prompt',
      cycle_minutes: 15,
      enter_seconds: 5,
    },
  ];
}

async function startScheduler(baseUrl, workers) {
  const started = await postJson(baseUrl, '/api/pty/scheduler/start', {
    cycle_minutes: 15,
    enter_seconds: 5,
    workers,
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.ok, true);
}

async function stopScheduler(baseUrl) {
  const stopped = await postJson(baseUrl, '/api/pty/scheduler/stop', {});
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.ok, true);
}

const HIGH_RATE_LIMIT = { readLimit: 10000, writeLimit: 10000, windowMs: 60 * 1000 };

test('[property] scheduler current activity follows the last successful targeted worker across valid action sequences', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags(), rateLimitPolicy: HIGH_RATE_LIMIT });
  if (!runtime) {
    return;
  }

  try {
    const ptySessions = await requestJson(runtime.url, '/api/pty/sessions');
    assert.equal(ptySessions.status, 200);
    assert.ok(Array.isArray(ptySessions.body.sessions));
    assert.ok(ptySessions.body.sessions.length >= 1);
    const pts = ptySessions.body.sessions[0].pts;

    await fc.assert(fc.asyncProperty(
      fc.array(fc.record({
        action: fc.constantFrom('send-now', 'enter-now'),
        workerIndex: fc.constantFrom(0, 1),
      }), { minLength: 1, maxLength: 6 }),
      async (steps) => {
        await startScheduler(runtime.url, validWorkers(pts));

        for (const step of steps) {
          const endpoint = step.action === 'send-now' ? '/api/pty/send-now' : '/api/pty/enter-now';
          const result = await postJson(runtime.url, endpoint, { worker_index: step.workerIndex });
          assert.equal(result.status, 200);
          assert.equal(result.body.results.length, 1);
          assert.equal(result.body.results[0].ok, true);
          assert.equal(result.body.results[0].worker, step.workerIndex === 0 ? 'Property Alpha' : 'Property Beta');
        }

        const lastStep = steps[steps.length - 1];
        const expectedWorker = lastStep.workerIndex === 0 ? 'Property Alpha' : 'Property Beta';
        const expectedAction = lastStep.action === 'send-now' ? 'prompt' : 'enter';
        const controlRuntime = await requestJson(runtime.url, '/ui/control-center-runtime');
        assert.equal(controlRuntime.status, 200);
        assert.equal(controlRuntime.body.runtime_state.execution.current_activity.worker, expectedWorker);
        assert.match(controlRuntime.body.runtime_state.execution.operator_brief.current_execution, new RegExp(`running \\/ ${expectedWorker}`));
        assert.match(controlRuntime.body.runtime_state.execution.operator_brief.last_dispatch, new RegExp(`${expectedAction} \\/ ${expectedWorker}`));
        assert.equal(controlRuntime.body.runtime_state.execution.operator_brief.blocked_at, '없음');
        assert.equal(controlRuntime.body.runtime_state.user_controls.failure_reason_visible, false);

        await stopScheduler(runtime.url);
      }
    ), { numRuns: 12 });
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[property] scheduler failures never overwrite the last successful current activity', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags(), rateLimitPolicy: HIGH_RATE_LIMIT });
  if (!runtime) {
    return;
  }

  try {
    const ptySessions = await requestJson(runtime.url, '/api/pty/sessions');
    assert.equal(ptySessions.status, 200);
    assert.ok(Array.isArray(ptySessions.body.sessions));
    assert.ok(ptySessions.body.sessions.length >= 1);
    const pts = ptySessions.body.sessions[0].pts;

    await fc.assert(fc.asyncProperty(
      fc.array(fc.record({
        action: fc.constantFrom('send-now', 'enter-now'),
        workerIndex: fc.constantFrom(0, 1),
      }), { minLength: 1, maxLength: 6 }),
      async (steps) => {
        await startScheduler(runtime.url, brokenWorkers(pts));

        for (const step of steps) {
          const endpoint = step.action === 'send-now' ? '/api/pty/send-now' : '/api/pty/enter-now';
          const result = await postJson(runtime.url, endpoint, { worker_index: step.workerIndex });
          assert.equal(result.status, 200);
          assert.equal(result.body.results.length, 1);
          assert.equal(result.body.results[0].worker, step.workerIndex === 0 ? 'Property Stable' : 'Property Broken');
          assert.equal(result.body.results[0].ok, step.workerIndex === 0);
        }

        const lastStep = steps[steps.length - 1];
        const expectedLastWorker = lastStep.workerIndex === 0 ? 'Property Stable' : 'Property Broken';
        const expectedLastAction = lastStep.action === 'send-now' ? 'prompt' : 'enter';
        const controlRuntime = await requestJson(runtime.url, '/ui/control-center-runtime');
        assert.equal(controlRuntime.status, 200);
        assert.equal(controlRuntime.body.runtime_state.execution.current_activity.worker, 'Property Stable');
        assert.match(controlRuntime.body.runtime_state.execution.operator_brief.current_execution, /running \/ Property Stable/);
        assert.match(controlRuntime.body.runtime_state.execution.operator_brief.last_dispatch, new RegExp(`${expectedLastAction} \\/ ${expectedLastWorker}`));

        if (lastStep.workerIndex === 1) {
          assert.match(controlRuntime.body.runtime_state.execution.operator_brief.blocked_at, new RegExp(`${expectedLastAction} \\/ Property Broken \\/ \\/dev\\/pts\\/99999`));
          assert.equal(controlRuntime.body.runtime_state.user_controls.failure_reason_visible, true);
        } else {
          assert.equal(controlRuntime.body.runtime_state.execution.operator_brief.blocked_at, '없음');
          assert.equal(controlRuntime.body.runtime_state.user_controls.failure_reason_visible, false);
        }

        await stopScheduler(runtime.url);
      }
    ), { numRuns: 12 });
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
