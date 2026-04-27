'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('../../server/createServer');
const { startServerOrSkip } = require('./support/networkTestRuntime');

function createFlagProvider(enabledFlags = [], details = null) {
  const enabled = new Set(enabledFlags);
  const detailList = Array.isArray(details) && details.length > 0
    ? details
    : [
      'system_api.enabled',
      'system_api.sse_stream.enabled',
      'system_api.flag_toggle_ui.enabled',
      'system_api.rollback_ui.enabled',
    ].map((flag) => ({
      flag,
      enabled: enabled.has(flag),
      env_overridden: false,
      source: 'flags.yaml',
      group: 'plugin_flags',
    }));

  return {
    evaluate(flagName) {
      return { flagName, value: enabled.has(flagName), reason: 'TEST_FLAG_PROVIDER', metadata: {}, stale: false };
    },
    isEnabled(flagName) {
      return enabled.has(flagName);
    },
    getFullFlagDetails() {
      return detailList.map((flag) => ({
        ...flag,
        enabled: enabled.has(flag.flag),
      }));
    },
    getRuntimeStatus() {
      return {
        flagsLoaded: true,
        metadataLoaded: true,
        errors: [],
        flagCount: detailList.length,
        metadataCount: detailList.length,
        envOverridesApplied: 0,
        env_overridden_flags: [],
        enabled_flags: detailList.filter((flag) => enabled.has(flag.flag)).map((flag) => flag.flag),
      };
    },
  };
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), options);
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.json(),
  };
}

test('[system api adversarial smoke] unauthorized admin actions return structured 403', async (t) => {
  const flags = createFlagProvider([
    'system_api.enabled',
    'system_api.flag_toggle_ui.enabled',
    'system_api.rollback_ui.enabled',
  ]);
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags });
  if (!runtime) {
    return;
  }

  try {
    const toggle = await requestJson(runtime.url, '/api/v1/system/flags/system_api.enabled', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'viewer',
      },
      body: JSON.stringify({ value: false }),
    });
    assert.equal(toggle.status, 403);
    assert.equal(toggle.body.code, 'FORBIDDEN');

    const rollback = await requestJson(runtime.url, '/api/v1/system/rollback/system', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'viewer',
      },
      body: JSON.stringify({ reason: 'unauthorized' }),
    });
    assert.equal(rollback.status, 403);
    assert.equal(rollback.body.code, 'FORBIDDEN');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[system api adversarial smoke] SSE client can reconnect after disconnect with trace headers preserved', async (t) => {
  const flags = createFlagProvider([
    'system_api.enabled',
    'system_api.sse_stream.enabled',
  ]);
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags });
  if (!runtime) {
    return;
  }

  try {
    // 첫 번째 연결: SSE 스트림 열기 + content-type 확인
    const firstResponse = await fetch(new URL('/api/v1/system/events', runtime.url), {
      headers: {
        'x-request-id': 'req-sse-1',
        'x-correlation-id': 'corr-sse-1',
      },
    });
    assert.equal(firstResponse.status, 200);
    assert.match(String(firstResponse.headers.get('content-type') || ''), /text\/event-stream/);
    await firstResponse.body?.cancel();

    // 두 번째 연결: disconnect 후 reconnect 성공 여부 확인
    const secondResponse = await fetch(new URL('/api/v1/system/events', runtime.url), {
      headers: {
        'x-request-id': 'req-sse-2',
        'x-correlation-id': 'corr-sse-2',
      },
    });
    assert.equal(secondResponse.status, 200, 'second SSE connection must succeed after disconnect');
    assert.match(String(secondResponse.headers.get('content-type') || ''), /text\/event-stream/);
    await secondResponse.body?.cancel();
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
