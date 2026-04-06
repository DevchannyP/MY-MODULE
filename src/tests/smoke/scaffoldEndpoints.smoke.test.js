'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, createAllEnabledFlags } = require('../../server/createServer');
const { startServerOrSkip } = require('./support/networkTestRuntime');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function jsonPost(port, pathname, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, method: 'POST', path: pathname,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'x-user-id': 'smoke',
        'x-permissions': 'system.admin',
        ...extraHeaders,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch { /* raw only */ }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function createStageCRuntimeFixture() {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-os-stagec-'));
  for (const relativePath of ['master-shell', 'requirements', 'worklog']) {
    fs.cpSync(path.join(REPO_ROOT, relativePath), path.join(runtimeRoot, relativePath), { recursive: true });
  }
  return runtimeRoot;
}

test('[scaffold smoke] POST /api/planning-studio/scaffold-preview returns 400 on missing domain', async (t) => {
  const handle = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!handle) return;
  try {
    const res = await jsonPost(handle.port, '/api/planning-studio/scaffold-preview', { blueprint: 'domain-module-extension' });
    assert.equal(res.status, 400);
  } finally {
    await handle.shutdown();
  }
});

test('[scaffold smoke] POST /api/planning-studio/scaffold-preview with valid args returns 200 with preview', async (t) => {
  const handle = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!handle) return;
  try {
    const res = await jsonPost(handle.port, '/api/planning-studio/scaffold-preview', {
      domain: 'smoke-test-domain',
      blueprint: 'domain-module-extension',
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
    assert.ok(res.json.ok, 'response.ok should be true');
    assert.ok(typeof res.json.data === 'object', 'response.data should be an object');
    assert.ok(typeof res.json.data.preview === 'string', 'response.data.preview should be a string');
    assert.equal(res.json.data.created, false, 'dry-run should not create a file');
  } finally {
    await handle.shutdown();
  }
});

test('[scaffold smoke] POST /api/planning-studio/scaffold-create with missing blueprint returns 400', async (t) => {
  const handle = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!handle) return;
  try {
    const res = await jsonPost(handle.port, '/api/planning-studio/scaffold-create', { domain: 'my-domain' });
    assert.equal(res.status, 400);
  } finally {
    await handle.shutdown();
  }
});

test('[scaffold smoke] scaffold-preview idempotency replay returns same 200 on second call', async (t) => {
  const handle = await startServerOrSkip(t, startServer, { port: 0, flags: createAllEnabledFlags() });
  if (!handle) return;
  const idemKey = `scaffold-preview-idem-${Date.now()}`;
  const requestBody = { domain: 'idem-test-domain', blueprint: 'domain-module-extension' };
  try {
    const first = await jsonPost(handle.port, '/api/planning-studio/scaffold-preview', requestBody, {
      'idempotency-key': idemKey,
    });
    assert.equal(first.status, 200, `first call: expected 200, got ${first.status}`);
    assert.ok(first.json.ok);

    const second = await jsonPost(handle.port, '/api/planning-studio/scaffold-preview', requestBody, {
      'idempotency-key': idemKey,
    });
    assert.equal(second.status, 200, `idempotency replay: expected 200, got ${second.status}`);
    assert.equal(second.headers['idempotency-replayed'], 'true', 'replay must set Idempotency-Replayed: true');
    assert.deepEqual(second.json, first.json, 'replayed response body must match original');
  } finally {
    await handle.shutdown();
  }
});

test('[scaffold smoke] scaffold-create auto-registers Stage C baselines in runtime root', async (t) => {
  const runtimeRoot = createStageCRuntimeFixture();
  const handle = await startServerOrSkip(t, startServer, {
    port: 0,
    flags: createAllEnabledFlags(),
    runtimeRoot,
  });
  if (!handle) {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    return;
  }
  try {
    const domain = 'stagec-smoke-domain';
    const res = await jsonPost(handle.port, '/api/planning-studio/scaffold-create', {
      domain,
      blueprint: 'domain-module-extension',
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
    assert.equal(res.json?.data?.created, true, 'scaffold-create should create files');

    assert.ok(fs.existsSync(path.join(runtimeRoot, 'requirements', `${domain}.yaml`)));
    assert.ok(fs.existsSync(path.join(runtimeRoot, 'domains', domain, 'contract', 'ui-contract.yaml')));
    assert.ok(fs.existsSync(path.join(runtimeRoot, 'domains', domain, 'contract', 'capability.yaml')));
    assert.ok(fs.existsSync(path.join(runtimeRoot, 'domains', domain, 'contract', 'openapi.yaml')));
    assert.ok(fs.existsSync(path.join(runtimeRoot, 'domains', domain, 'contract', 'events.schema.json')));
    assert.ok(fs.existsSync(path.join(runtimeRoot, 'memory', 'stageB', `${domain}.yaml`)));
    assert.ok(fs.existsSync(path.join(runtimeRoot, 'memory', 'stageC', `${domain}-plugin.yaml`)));

    const registryText = fs.readFileSync(path.join(runtimeRoot, 'master-shell', 'plugin-registry', 'registry.yaml'), 'utf8');
    const flagsText = fs.readFileSync(path.join(runtimeRoot, 'master-shell', 'feature-flags', 'flags.yaml'), 'utf8');
    const navText = fs.readFileSync(path.join(runtimeRoot, 'master-shell', 'navigation', 'nav.yaml'), 'utf8');

    assert.match(registryText, /id:\s*stagec-smoke-domain-plugin/);
    assert.match(registryText, /status:\s*inactive/);
    assert.match(registryText, /entry_point:\s*\/stagec-smoke-domain/);
    assert.match(flagsText, /enable_stagec_smoke_domain:\s*false/);
    assert.match(navText, /id:\s*stagec-smoke-domain/);
    assert.match(navText, /route:\s*\/stagec-smoke-domain/);
  } finally {
    await handle.shutdown();
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});
