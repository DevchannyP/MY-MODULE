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

    const mindmap = await requestText(runtime.url, '/mindmap/index.html');
    assert.equal(mindmap.status, 200);
    assert.match(mindmap.text, /통합 통제 센터/);
    assert.match(mindmap.text, /실행 계획표/);
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

    const controlRuntime = await requestJson(runtime.url, '/ui/control-center-runtime');
    assert.equal(controlRuntime.status, 200);
    assert.equal(controlRuntime.body.ok, true);
    assert.equal(controlRuntime.body.meta.contract_version, 'ui-runtime.v1');
    assert.ok(Array.isArray(controlRuntime.body.data.plan_rows));
    assert.ok(Array.isArray(controlRuntime.body.data.control_nodes));
    assert.equal(typeof controlRuntime.body.data.scaffold_capabilities.default_blueprint, 'string');

    const snapshotResponse = await fetch(new URL('/api/planning-studio/snapshot', runtime.url));
    assert.equal(snapshotResponse.status, 200);
    const snapshotBody = await snapshotResponse.json();
    assert.equal(snapshotBody.ok, true);
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
