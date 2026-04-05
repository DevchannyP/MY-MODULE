'use strict';

const http = require('node:http');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, createAllEnabledFlags } = require('../../server/createServer');
const { startServerOrSkip } = require('./support/networkTestRuntime');

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
