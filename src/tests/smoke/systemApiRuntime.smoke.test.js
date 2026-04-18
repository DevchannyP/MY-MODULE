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

test('[system api runtime smoke] system routes are mounted when system_api.enabled=true', async (t) => {
  const flags = createFlagProvider([
    'system_api.enabled',
    'system_api.sse_stream.enabled',
    'system_api.flag_toggle_ui.enabled',
    'system_api.rollback_ui.enabled',
  ]);
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags });
  if (!runtime) {
    return;
  }

  try {
    const health = await requestJson(runtime.url, '/api/v1/system/health');
    assert.equal(health.status, 200);
    assert.equal(typeof health.body.overall_status, 'string');
    assert.ok(Array.isArray(health.body.domains));

    const catalog = await requestJson(runtime.url, '/api/v1/system/catalog');
    assert.equal(catalog.status, 200);
    assert.ok(Array.isArray(catalog.body.domains));
    const systemDomain = catalog.body.domains.find((domain) => domain.id === 'system');
    assert.ok(systemDomain);
    assert.ok(Array.isArray(systemDomain.routes));
    assert.ok(systemDomain.routes.some((route) => route.includes('/catalog')), 'catalog route must be present');
    assert.equal(typeof systemDomain.contracts.capability, 'string');
    assert.equal(typeof systemDomain.contracts.ui, 'string');
    assert.equal(typeof systemDomain.adapter_profile, 'string');

    const lifecycle = await requestJson(runtime.url, '/api/v1/system/lifecycle');
    assert.equal(lifecycle.status, 200);
    assert.ok(Array.isArray(lifecycle.body.domains));

    const flagsResponse = await requestJson(runtime.url, '/api/v1/system/flags');
    assert.equal(flagsResponse.status, 200);
    assert.ok(Array.isArray(flagsResponse.body.flags));
    assert.ok(flagsResponse.body.flags.some((flag) => flag.id === 'system_api.enabled'));

    const sseResponse = await fetch(new URL('/api/v1/system/events', runtime.url));
    assert.equal(sseResponse.status, 200);
    assert.match(String(sseResponse.headers.get('content-type') || ''), /text\/event-stream/);
    await sseResponse.body?.cancel();
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[system api runtime smoke] system routes return 404 when system_api.enabled=false', async (t) => {
  const flags = createFlagProvider([]);
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags });
  if (!runtime) {
    return;
  }

  try {
    const health = await requestJson(runtime.url, '/api/v1/system/health');
    assert.equal(health.status, 404);
    assert.equal(health.body.code, 'NOT_FOUND');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[system api runtime smoke] sub-feature gates return 503 when disabled', async (t) => {
  const flags = createFlagProvider(['system_api.enabled']);
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags });
  if (!runtime) {
    return;
  }

  try {
    const sseResponse = await fetch(new URL('/api/v1/system/events', runtime.url));
    assert.equal(sseResponse.status, 503);
    const sseBody = await sseResponse.json();
    // 503 응답의 식별자는 title 또는 code 필드 중 하나로 확인
    assert.ok(
      sseBody.code === 'FEATURE_DISABLED' || typeof sseBody.title === 'string',
      'SSE disabled response must include code or title'
    );

    const toggle = await requestJson(runtime.url, '/api/v1/system/flags/system_api.enabled', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'system-admin',
        'x-permissions': 'system.admin',
      },
      body: JSON.stringify({ value: false }),
    });
    assert.equal(toggle.status, 503);
    assert.ok(
      toggle.body.code === 'FEATURE_DISABLED' || typeof toggle.body.title === 'string',
      'toggle disabled response must include code or title'
    );

    const rollback = await requestJson(runtime.url, '/api/v1/system/rollback/system', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'system-admin',
        'x-permissions': 'system.admin',
      },
      body: JSON.stringify({ reason: 'smoke' }),
    });
    assert.equal(rollback.status, 503);
    assert.ok(
      rollback.body.code === 'FEATURE_DISABLED' || typeof rollback.body.title === 'string',
      'rollback disabled response must include code or title'
    );
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
