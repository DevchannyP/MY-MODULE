'use strict';

/**
 * mindmapRebuildWorker.smoke.test.js
 *
 * WP-S7-003: Worker Thread — POST /api/mindmap/rebuild 엔드포인트 smoke
 *
 * 검증 항목:
 *   1. Worker entry 파일(generateMindmapWorker.js)이 존재한다
 *   2. POST /api/mindmap/rebuild이 200을 반환한다
 *   3. 응답에 { ok: true, durationMs: number }가 포함된다
 *   4. 재생성 후 artifacts/mindmap/index.html이 존재한다
 */

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '../../..');

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve, reject) => {
    const { createServer } = require(path.join(REPO_ROOT, 'src/server/createServer'));
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
    server.once('error', reject);
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function postJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: pathname, method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '0' } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || 'null') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('[mindmap rebuild smoke] generateMindmapWorker.js 파일이 존재한다', () => {
  const workerPath = path.join(REPO_ROOT, 'scripts', 'generateMindmapWorker.js');
  assert.ok(fs.existsSync(workerPath), `Worker entry not found: ${workerPath}`);
});

test('[mindmap rebuild smoke] POST /api/mindmap/rebuild — 200 + ok:true + durationMs', async () => {
  let runtime;
  try {
    runtime = await startServer();
    const result = await postJson(runtime.port, '/api/mindmap/rebuild');
    assert.equal(result.status, 200, `Expected 200, got ${result.status}`);
    assert.equal(result.body.ok, true, 'Expected ok:true');
    assert.equal(typeof result.body.durationMs, 'number', 'Expected durationMs to be a number');
    assert.ok(result.body.durationMs >= 0, 'durationMs should be non-negative');
  } finally {
    if (runtime) await stopServer(runtime.server);
  }
});

test('[mindmap rebuild smoke] 재생성 후 artifacts/mindmap/index.html 존재', () => {
  const artifactPath = path.join(REPO_ROOT, 'artifacts', 'mindmap', 'index.html');
  assert.ok(fs.existsSync(artifactPath), `Mindmap artifact not found: ${artifactPath}`);
  const stat = fs.statSync(artifactPath);
  assert.ok(stat.size > 100_000, `Mindmap file too small (${stat.size} bytes) — likely empty or corrupt`);
});
