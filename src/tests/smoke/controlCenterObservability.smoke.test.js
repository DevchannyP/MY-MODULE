'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, createAllEnabledFlags } = require('../../server/createServer');
const { metrics } = require('../../infrastructure/telemetry');
const { startServerOrSkip } = require('./support/networkTestRuntime');

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), options);
  return {
    status: response.status,
    body: await response.json(),
  };
}

test('[control center observability smoke] node bridge emits control-center metrics', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  const baseline = {
    promptRecommendations: metrics.controlCenterPromptRecommendationsTotal.value,
    sessionsRead: metrics.ptyBridgeSessionsReadTotal.value,
    sends: metrics.ptyBridgeSendTotal.value,
    failures: metrics.ptyBridgeFailuresTotal.value,
    schedulerReads: metrics.ptySchedulerStatusReadTotal.value,
    schedulerStarts: metrics.ptySchedulerStartTotal.value,
    schedulerStops: metrics.ptySchedulerStopTotal.value,
    stageRunSaved: metrics.stageRunReportSavedTotal.value,
    stageRunSaveFailures: metrics.stageRunReportSaveFailuresTotal.value,
  };

  try {
    const recommendation = await requestJson(runtime.url, '/api/automation/optimize-prompt');
    assert.equal(recommendation.status, 200);
    assert.match(String(recommendation.body.prompt || ''), /\S/);

    const sessions = await requestJson(runtime.url, '/api/pty/sessions');
    assert.equal(sessions.status, 200);
    assert.ok(Array.isArray(sessions.body.sessions));
    assert.ok(sessions.body.sessions.length >= 1);

    const pts = sessions.body.sessions[0].pts;

    const sent = await requestJson(runtime.url, '/api/pty/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pts,
        text: 'observability check\r',
        prompt: 'observability check',
        action: 'prompt',
        name: 'observability-smoke',
        packet_id: 'WP-OBS-1',
      }),
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.ok, true);

    const failedSend = await requestJson(runtime.url, '/api/pty/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'missing pts\r',
      }),
    });
    assert.equal(failedSend.status, 400);
    // RFC 7807 Problem Details: status, type, detail 구조 확인
    assert.equal(failedSend.body.status, 400);
    assert.ok(failedSend.body.type && failedSend.body.type.includes('validation-error'));
    assert.equal(typeof failedSend.body.detail, 'string');

    const statusBefore = await requestJson(runtime.url, '/api/pty/scheduler/status');
    assert.equal(statusBefore.status, 200);

    const started = await requestJson(runtime.url, '/api/pty/scheduler/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cycle_minutes: 12,
        enter_seconds: 4,
        workers: [{
          name: 'obs-worker',
          plan_id: 'WP-OBS-1',
          pts,
          prompt: '계속 진행',
        }],
      }),
    });
    assert.equal(started.status, 200);
    assert.equal(started.body.ok, true);

    const statusRunning = await requestJson(runtime.url, '/api/pty/scheduler/status');
    assert.equal(statusRunning.status, 200);
    assert.equal(statusRunning.body.running, true);

    const stopped = await requestJson(runtime.url, '/api/pty/scheduler/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.ok, true);

    const stageRun = await requestJson(runtime.url, '/api/planning-studio/stage-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-permissions': 'system.admin' },
      body: JSON.stringify({ stage: 'D', module: 'task-management' }),
    });
    assert.equal(stageRun.status, 200);
    assert.equal(stageRun.body.ok, true);
    assert.equal(stageRun.body.data.runtime_observability.report_saved, true);

    assert.equal(metrics.controlCenterPromptRecommendationsTotal.value - baseline.promptRecommendations, 1);
    assert.equal(metrics.ptyBridgeSessionsReadTotal.value - baseline.sessionsRead, 1);
    assert.equal(metrics.ptyBridgeSendTotal.value - baseline.sends, 1);
    assert.equal(metrics.ptyBridgeFailuresTotal.value - baseline.failures, 1);
    assert.equal(metrics.ptySchedulerStatusReadTotal.value - baseline.schedulerReads, 2);
    assert.equal(metrics.ptySchedulerStartTotal.value - baseline.schedulerStarts, 1);
    assert.equal(metrics.ptySchedulerStopTotal.value - baseline.schedulerStops, 1);
    assert.equal(metrics.stageRunReportSavedTotal.value - baseline.stageRunSaved, 1);
    assert.equal(metrics.stageRunReportSaveFailuresTotal.value - baseline.stageRunSaveFailures, 0);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[control center observability smoke] GET /flags returns full flag state with env-override visibility', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }
  try {
    const res = await requestJson(runtime.url, '/flags');
    assert.equal(res.status, 200);

    // 필수 구조 검증
    assert.equal(typeof res.body.as_of, 'string', 'as_of should be ISO timestamp');
    assert.equal(typeof res.body.env_overrides_applied, 'number');
    assert.ok(Array.isArray(res.body.env_overridden_flags), 'env_overridden_flags must be array');
    assert.ok(Array.isArray(res.body.enabled_flags), 'enabled_flags must be array');
    assert.ok(Array.isArray(res.body.flags), 'flags must be array');

    // 각 플래그 항목 구조 검증
    assert.ok(res.body.flags.length > 0, 'at least one flag must be present');
    const firstFlag = res.body.flags[0];
    assert.equal(typeof firstFlag.flag, 'string');
    assert.equal(typeof firstFlag.enabled, 'boolean');
    assert.equal(typeof firstFlag.env_overridden, 'boolean');
    assert.equal(typeof firstFlag.source, 'string');
    assert.ok(['env', 'flags.yaml'].includes(firstFlag.source), `unexpected source: ${firstFlag.source}`);

    // createAllEnabledFlags()로 실행했으므로 enabled_flags가 비어 있지 않아야 함
    assert.ok(res.body.enabled_flags.length > 0, 'some flags should be enabled with createAllEnabledFlags');

    // enabled_flags와 flags 배열의 일관성
    const enabledInDetail = res.body.flags.filter((f) => f.enabled).map((f) => f.flag).sort();
    assert.deepEqual(res.body.enabled_flags, enabledInDetail, 'enabled_flags must match flags array enabled items');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[control center observability smoke] GET /readyz includes env_overridden_flags and enabled_flags', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }
  try {
    const res = await requestJson(runtime.url, '/readyz');
    assert.equal(res.status, 200);

    const ff = res.body.feature_flags;
    assert.ok(ff, 'feature_flags must be present');
    assert.ok(Array.isArray(ff.env_overridden_flags), 'env_overridden_flags must be array in readyz');
    assert.ok(Array.isArray(ff.enabled_flags), 'enabled_flags must be array in readyz');
    assert.equal(typeof ff.envOverridesApplied, 'number');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
