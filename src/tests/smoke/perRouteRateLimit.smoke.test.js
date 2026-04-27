'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createAppHandler, createAllEnabledFlags } = require('../../server/createServer');
const { InMemoryRateLimiter } = require('../../shared/RateLimiter');

function makeReq(method, pathname, headers = {}) {
  return {
    method,
    url: `http://localhost${pathname}`,
    headers: {
      'x-user-id': 'test-user',
      'content-type': 'application/json',
      ...headers,
    },
  };
}

function makeRes() {
  const res = {
    statusCode: null,
    _headers: {},
    _body: '',
    setHeader(k, v) { this._headers[k] = v; },
    writeHead(code, headers = {}) {
      this.statusCode = code;
      Object.assign(this._headers, headers);
    },
    end(body) { this._body = body || ''; },
  };
  return res;
}

async function callHandler(handler, method, pathname, body = null) {
  const req = makeReq(method, pathname);
  req._body = body ? JSON.stringify(body) : null;

  // Simulate readable stream for POST body
  req[Symbol.asyncIterator] = async function* () {
    if (req._body) yield Buffer.from(req._body);
  };

  const res = makeRes();
  await handler(req, res);
  return { status: res.statusCode, headers: res._headers };
}

test('[per-route rate-limit smoke] POST /billing/payments enforces stricter 10/min limit', async () => {
  const rateLimiter = new InMemoryRateLimiter();
  const flags = createAllEnabledFlags();

  const handler = createAppHandler({
    rateLimiter,
    rateLimitPolicy: { readLimit: 1000, writeLimit: 1000, windowMs: 60 * 1000 },
    routeRateLimitPolicies: {
      'POST:/billing/payments': { limit: 3, windowMs: 60 * 1000 },
    },
    flags,
  });

  // First 3 POST /billing/payments: allowed (may get domain errors but not 429)
  for (let i = 0; i < 3; i++) {
    const { status } = await callHandler(handler, 'POST', '/billing/payments');
    assert.notEqual(status, 429, `Request ${i + 1} should not be rate-limited`);
  }

  // 4th request: should be 429
  const { status } = await callHandler(handler, 'POST', '/billing/payments');
  assert.equal(status, 429, 'Request 4 should be rate-limited (route limit=3)');
});

test('[per-route rate-limit smoke] POST /video/videos enforces stricter 5/min limit', async () => {
  const rateLimiter = new InMemoryRateLimiter();
  const flags = createAllEnabledFlags();

  const handler = createAppHandler({
    rateLimiter,
    rateLimitPolicy: { readLimit: 1000, writeLimit: 1000, windowMs: 60 * 1000 },
    routeRateLimitPolicies: {
      'POST:/video/videos': { limit: 2, windowMs: 60 * 1000 },
    },
    flags,
  });

  // First 2 POST /video/videos: allowed
  for (let i = 0; i < 2; i++) {
    const { status } = await callHandler(handler, 'POST', '/video/videos');
    assert.notEqual(status, 429, `Request ${i + 1} should not be rate-limited`);
  }

  // 3rd request: should be 429
  const { status } = await callHandler(handler, 'POST', '/video/videos');
  assert.equal(status, 429, 'Request 3 should be rate-limited (route limit=2)');
});

test('[per-route rate-limit smoke] routes without stricter policy use global limit only', async () => {
  const rateLimiter = new InMemoryRateLimiter();
  const flags = createAllEnabledFlags();

  const handler = createAppHandler({
    rateLimiter,
    rateLimitPolicy: { readLimit: 1000, writeLimit: 1000, windowMs: 60 * 1000 },
    routeRateLimitPolicies: {},
    flags,
  });

  // GET /livez should never hit per-route limit
  for (let i = 0; i < 10; i++) {
    const { status } = await callHandler(handler, 'GET', '/livez');
    assert.equal(status, 200, `GET /livez request ${i + 1} should be 200`);
  }
});
