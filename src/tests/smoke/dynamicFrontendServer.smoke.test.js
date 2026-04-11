'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, createAllEnabledFlags } = require('../../server/createServer');
const { startServerOrSkip } = require('./support/networkTestRuntime');

async function requestText(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
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

async function postJson(baseUrl, pathname, body, extraHeaders = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.json(),
  };
}

test('[dynamic frontend server smoke] node server renders dynamic frontend surfaces and keeps planning api alive', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    const home = await requestText(runtime.url, '/');
    assert.equal(home.status, 200);
    assert.match(home.text, /Workflow OS 운영 홈/);
    assert.match(home.text, /본문으로 건너뛰기/);
    assert.match(home.text, /aria-label="주요 운영 화면"/);
    assert.match(home.text, /aria-controls="home-stat-detail"/);
    assert.match(home.text, /통합 통제 센터/);
    assert.match(home.text, /같은 자동화 저장 재시도는 안전하게 재사용됩니다\./);
    assert.match(home.text, /같은 계획 초안을 다시 저장해도 중복 기록되지 않습니다\./);
    // 활성 플래그 가시성 위젯 — .env WOS_FLAG_* 오버라이드 확인 지점
    assert.match(home.text, /live-active-flags/, 'home must have live-active-flags element');
    assert.match(home.text, /live-env-overrides/, 'home must have live-env-overrides element');
    assert.match(home.text, /\/flags/, 'home must reference /flags endpoint');

    const mindmap = await requestText(runtime.url, '/mindmap/index.html');
    assert.equal(mindmap.status, 200);
    assert.match(mindmap.text, /통합 통제 센터/);
    assert.match(mindmap.text, /실행 계획표/);
    assert.match(mindmap.text, /Stage dry-run/);
    assert.match(mindmap.text, /Stage execute/);
    assert.ok(typeof mindmap.headers.etag === 'string' && mindmap.headers.etag.length > 0);

    const mindmapCached = await fetch(new URL('/mindmap/index.html', runtime.url), {
      headers: {
        'if-none-match': String(mindmap.headers.etag),
      },
    });
    assert.equal(mindmapCached.status, 304);

    const catalog = await requestText(runtime.url, '/catalog-site/index.html');
    assert.equal(catalog.status, 200);
    assert.match(catalog.text, /도메인 카탈로그/);

    const guide = await requestText(runtime.url, '/study-guide/index.html');
    assert.equal(guide.status, 200);
    assert.match(guide.text, /국내\/외 공식 레퍼런스/);

    const homeRuntime = await requestJson(runtime.url, '/ui/home-runtime');
    assert.equal(homeRuntime.status, 200);
    assert.equal(homeRuntime.body.ok, true);
    assert.equal(homeRuntime.body.meta.contract_version, 'ui-runtime.v1');
    assert.match(String(homeRuntime.body.data.status.goal || ''), /\S/);
    assert.equal(typeof homeRuntime.body.data.status.progress_pct, 'number');
    assert.equal(typeof homeRuntime.body.data.summary.current_wp, 'string');

    // runtime_state — 라이브 동적 컨텍스트 검증
    const rs = homeRuntime.body.runtime_state;
    assert.ok(rs, 'runtime_state must be present');
    assert.ok(Array.isArray(rs.feature_flags.enabled_flags), 'runtime_state.feature_flags.enabled_flags must be array');
    assert.ok(Array.isArray(rs.feature_flags.env_overridden_flags), 'runtime_state.feature_flags.env_overridden_flags must be array');
    assert.equal(typeof rs.feature_flags.env_overrides_applied, 'number');
    assert.equal(typeof rs.feature_flags.flags_loaded, 'boolean');
    assert.equal(typeof rs.scheduler.running, 'boolean');
    assert.equal(typeof rs.scheduler.worker_count, 'number');
    assert.equal(typeof rs.control_endpoints.send, 'string');
    assert.equal(rs.control_endpoints.flags, '/flags');
    assert.equal(rs.control_endpoints.scheduler_status, '/api/pty/scheduler/status');
    assert.equal(typeof rs.as_of, 'string');

    const controlRuntime = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntime.status, 200);
    assert.equal(controlRuntime.body.ok, true);
    assert.equal(controlRuntime.body.meta.contract_version, 'ui-runtime.v1');
    assert.ok(Array.isArray(controlRuntime.body.data.plan_rows));
    assert.ok(Array.isArray(controlRuntime.body.data.control_nodes));
    assert.equal(typeof controlRuntime.body.data.scaffold_capabilities.default_blueprint, 'string');
    assert.equal(controlRuntime.body.data.stage_capabilities.run_endpoint, '/api/planning-studio/stage-run');
    assert.ok(Array.isArray(controlRuntime.body.data.stage_capabilities.supported_stages));
    assert.ok(controlRuntime.body.runtime_state, 'control-center runtime_state must be present');
    assert.ok(Array.isArray(controlRuntime.body.runtime_state.feature_flags.enabled_flags));
    assert.equal(typeof controlRuntime.body.runtime_state.execution.runtime_available, 'boolean');
    assert.equal(typeof controlRuntime.body.runtime_state.execution.session_count, 'number');
    assert.equal(typeof controlRuntime.body.runtime_state.execution.next_action, 'string');
    assert.equal(typeof controlRuntime.body.runtime_state.scheduler.running, 'boolean');
    assert.ok(Array.isArray(controlRuntime.body.runtime_state.scheduler.workers));
    assert.equal(controlRuntime.body.runtime_state.control_endpoints.send, '/api/pty/send');
    assert.equal(controlRuntime.body.runtime_state.control_endpoints.rollback_base, '/api/v1/system/rollback');
    assert.equal(typeof controlRuntime.body.runtime_state.user_controls.send_prompt, 'boolean');
    assert.equal(typeof controlRuntime.body.runtime_state.user_controls.retry_last_prompt, 'boolean');
    assert.equal(typeof controlRuntime.body.runtime_state.user_controls.control_matrix.send_prompt.enabled, 'boolean');
    assert.equal(typeof controlRuntime.body.runtime_state.user_controls.control_matrix.send_prompt.reason, 'string');
    assert.equal(typeof controlRuntime.body.runtime_state.user_controls.control_matrix.rollback.enabled, 'boolean');
    assert.equal(typeof controlRuntime.body.runtime_state.user_controls.control_matrix.rollback.reason, 'string');
    assert.equal(controlRuntime.body.runtime_state.user_controls.terminal_status_visible, true);
    assert.equal(typeof controlRuntime.body.runtime_state.as_of, 'string');

    const snapshotResponse = await fetch(new URL('/api/planning-studio/snapshot', runtime.url));
    assert.equal(snapshotResponse.status, 200);
    const snapshotBody = await snapshotResponse.json();
    assert.equal(snapshotBody.ok, true);
    assert.ok(Array.isArray(snapshotBody.data.stage_run_recent_reports));

    const promptRecommendation = await requestJson(runtime.url, '/api/automation/optimize-prompt');
    assert.equal(promptRecommendation.status, 200);
    assert.match(String(promptRecommendation.body.prompt || ''), /\S/);

    const ptySessions = await requestJson(runtime.url, '/api/pty/sessions');
    assert.equal(ptySessions.status, 200);
    assert.ok(Array.isArray(ptySessions.body.sessions));
    assert.equal(ptySessions.body.count, ptySessions.body.sessions.length);
    assert.ok(ptySessions.body.sessions.length >= 1);

    const selectedSession = ptySessions.body.sessions[0];
    assert.equal(typeof selectedSession.pts, 'string');
    assert.match(selectedSession.pts, /\S/);

    const ptySend = await postJson(runtime.url, '/api/pty/send', {
      pts: selectedSession.pts,
      text: 'Roundtrip prompt\r',
      prompt: 'Roundtrip prompt',
      action: 'prompt',
      name: 'dynamic-frontend-smoke',
      packet_id: 'WP-SMOKE',
    }, {
      'idempotency-key': 'dynamic-pty-send-idem',
    });
    assert.equal(ptySend.status, 200);
    assert.equal(ptySend.body.ok, true);

    const controlRuntimeAfterSend = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntimeAfterSend.status, 200);
    assert.equal(controlRuntimeAfterSend.body.runtime_state.execution.last_prompt_text, 'Roundtrip prompt');
    assert.equal(controlRuntimeAfterSend.body.runtime_state.user_controls.retry_last_prompt, true);
    assert.equal(controlRuntimeAfterSend.body.runtime_state.user_controls.control_matrix.retry_last_prompt.enabled, true);
    assert.equal(controlRuntimeAfterSend.body.runtime_state.user_controls.failure_reason_visible, false);

    const ptySendReplay = await postJson(runtime.url, '/api/pty/send', {
      pts: selectedSession.pts,
      text: 'Roundtrip prompt\r',
      prompt: 'Roundtrip prompt',
      action: 'prompt',
      name: 'dynamic-frontend-smoke',
      packet_id: 'WP-SMOKE',
    }, {
      'idempotency-key': 'dynamic-pty-send-idem',
    });
    assert.equal(ptySendReplay.status, 200);
    assert.equal(ptySendReplay.headers['idempotency-replayed'], 'true');
    assert.deepEqual(ptySendReplay.body, ptySend.body);

    const schedulerBefore = await requestJson(runtime.url, '/api/pty/scheduler/status');
    assert.equal(schedulerBefore.status, 200);
    assert.equal(typeof schedulerBefore.body.running, 'boolean');
    assert.ok(Array.isArray(schedulerBefore.body.log));
    assert.equal(schedulerBefore.body.last_activity.action, 'prompt');

    const schedulerStart = await postJson(runtime.url, '/api/pty/scheduler/start', {
      cycle_minutes: 15,
      enter_seconds: 5,
      workers: [{
        name: 'Control Center Worker',
        plan_id: 'WP-SMOKE',
        pts: selectedSession.pts,
        prompt: '계속 진행',
        cycle_minutes: 15,
        enter_seconds: 5,
      }],
    }, {
      'idempotency-key': 'dynamic-scheduler-start-idem',
    });
    assert.equal(schedulerStart.status, 200);
    assert.equal(schedulerStart.body.ok, true);
    assert.equal(schedulerStart.body.workers, 1);

    const schedulerStartReplay = await postJson(runtime.url, '/api/pty/scheduler/start', {
      cycle_minutes: 15,
      enter_seconds: 5,
      workers: [{
        name: 'Control Center Worker',
        plan_id: 'WP-SMOKE',
        pts: selectedSession.pts,
        prompt: '계속 진행',
        cycle_minutes: 15,
        enter_seconds: 5,
      }],
    }, {
      'idempotency-key': 'dynamic-scheduler-start-idem',
    });
    assert.equal(schedulerStartReplay.status, 200);
    assert.equal(schedulerStartReplay.headers['idempotency-replayed'], 'true');
    assert.deepEqual(schedulerStartReplay.body, schedulerStart.body);

    const schedulerRunning = await requestJson(runtime.url, '/api/pty/scheduler/status');
    assert.equal(schedulerRunning.status, 200);
    assert.equal(schedulerRunning.body.running, true);
    assert.equal(schedulerRunning.body.workers.length, 1);
    assert.equal(schedulerRunning.body.current_activity.action, 'running');

    const schedulerSendNow = await postJson(runtime.url, '/api/pty/send-now', {});
    assert.equal(schedulerSendNow.status, 200);
    assert.ok(Array.isArray(schedulerSendNow.body.results));
    assert.equal(schedulerSendNow.body.results.length, 1);
    assert.equal(schedulerSendNow.body.results[0].worker, 'Control Center Worker');
    assert.equal(schedulerSendNow.body.results[0].ok, true);
    assert.equal(schedulerSendNow.body.results[0].error, null);

    const schedulerSendNowInvalid = await postJson(runtime.url, '/api/pty/send-now', {
      worker_index: 99,
    });
    assert.equal(schedulerSendNowInvalid.status, 200);
    assert.equal(schedulerSendNowInvalid.body.results[0].ok, false);
    assert.match(String(schedulerSendNowInvalid.body.results[0].error || ''), /index 99/);

    const schedulerEnterNow = await postJson(runtime.url, '/api/pty/enter-now', {});
    assert.equal(schedulerEnterNow.status, 200);
    assert.ok(Array.isArray(schedulerEnterNow.body.results));
    assert.equal(schedulerEnterNow.body.results.length, 1);
    assert.equal(schedulerEnterNow.body.results[0].worker, 'Control Center Worker');
    assert.equal(schedulerEnterNow.body.results[0].ok, true);
    assert.equal(schedulerEnterNow.body.results[0].error, null);

    const schedulerStop = await postJson(runtime.url, '/api/pty/scheduler/stop', {}, {
      'idempotency-key': 'dynamic-scheduler-stop-idem',
    });
    assert.equal(schedulerStop.status, 200);
    assert.equal(schedulerStop.body.ok, true);

    const schedulerStopReplay = await postJson(runtime.url, '/api/pty/scheduler/stop', {}, {
      'idempotency-key': 'dynamic-scheduler-stop-idem',
    });
    assert.equal(schedulerStopReplay.status, 200);
    assert.equal(schedulerStopReplay.headers['idempotency-replayed'], 'true');
    assert.deepEqual(schedulerStopReplay.body, schedulerStop.body);

    const schedulerStopped = await requestJson(runtime.url, '/api/pty/scheduler/status');
    assert.equal(schedulerStopped.status, 200);
    assert.equal(schedulerStopped.body.running, false);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[dynamic frontend server smoke] PTY send errors return RFC 7807 Problem Details', async (t) => {
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!runtime) {
    return;
  }

  try {
    // Case 1: pts 필드 누락 → VALIDATION_ERROR (400)
    const missingPts = await postJson(runtime.url, '/api/pty/send', {
      text: 'some text\r',
      action: 'prompt',
    });
    assert.equal(missingPts.status, 400);
    assert.equal(missingPts.headers['content-type'], 'application/problem+json; charset=utf-8');
    assert.equal(missingPts.body.status, 400);
    assert.equal(typeof missingPts.body.type, 'string');
    assert.ok(missingPts.body.type.includes('validation-error'), `type should include validation-error, got: ${missingPts.body.type}`);
    assert.equal(typeof missingPts.body.title, 'string');
    assert.equal(typeof missingPts.body.detail, 'string');

    const controlRuntimeAfterMissingPts = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntimeAfterMissingPts.status, 200);
    assert.equal(controlRuntimeAfterMissingPts.body.runtime_state.execution.last_error.error, 'pts 필드가 필수입니다.');
    assert.equal(controlRuntimeAfterMissingPts.body.runtime_state.user_controls.failure_reason_visible, true);
    assert.equal(controlRuntimeAfterMissingPts.body.runtime_state.user_controls.control_matrix.failure_reason_visible.enabled, true);
    assert.match(controlRuntimeAfterMissingPts.body.runtime_state.execution.next_action, /실패 원인/);

    // Case 2: 존재하지 않는 pts → NOT_FOUND (404)
    const unknownPts = await postJson(runtime.url, '/api/pty/send', {
      pts: '/dev/pts/99999',
      text: 'hello\r',
      action: 'prompt',
    });
    assert.equal(unknownPts.status, 404);
    assert.equal(unknownPts.headers['content-type'], 'application/problem+json; charset=utf-8');
    assert.equal(unknownPts.body.status, 404);
    assert.equal(typeof unknownPts.body.type, 'string');
    assert.ok(unknownPts.body.type.includes('not-found'), `type should include not-found, got: ${unknownPts.body.type}`);
    assert.equal(typeof unknownPts.body.title, 'string');
    assert.equal(typeof unknownPts.body.detail, 'string');

    const controlRuntimeAfterUnknownPts = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntimeAfterUnknownPts.status, 200);
    assert.equal(controlRuntimeAfterUnknownPts.body.runtime_state.execution.last_error.error, '알 수 없는 PTY 세션입니다: /dev/pts/99999');
    assert.equal(controlRuntimeAfterUnknownPts.body.runtime_state.execution.last_activity.ok, false);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
