'use strict';

const http = require('node:http');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { URL } = require('node:url');

const { startServer, createAllEnabledFlags } = require('../../server/createServer');

function futureDate(days = 30) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function jsonRequest(baseUrl, { method, path, body, permissions = [], userId = 'smoke-user' }) {
  const url = new URL(path, baseUrl);
  const payload = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-user-id': userId,
        'x-permissions': permissions.join(','),
      },
    }, (res) => {
      const chunks = [];

      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          body: raw ? JSON.parse(raw) : {},
        });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

test('[server wiring smoke] health endpoint and task flow succeed over HTTP transport', async () => {
  const runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });

  try {
    const health = await jsonRequest(runtime.url, {
      method: 'GET',
      path: '/health',
    });
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');

    const created = await jsonRequest(runtime.url, {
      method: 'POST',
      path: '/tasks',
      permissions: ['task:read', 'task:write'],
      body: {
        title: 'server-smoke-task',
        assignee_id: 'user-1',
        due_date: futureDate(),
      },
    });
    assert.equal(created.status, 201);
    assert.ok(created.body.task_id);

    const fetched = await jsonRequest(runtime.url, {
      method: 'GET',
      path: `/tasks/${created.body.task_id}`,
      permissions: ['task:read'],
    });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.task_id, created.body.task_id);
  } finally {
    await closeServer(runtime.server);
  }
});

test('[server wiring smoke] billing permission denial survives HTTP transport', async () => {
  const runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });

  try {
    const response = await jsonRequest(runtime.url, {
      method: 'POST',
      path: '/billing/invoices',
      body: { customer_id: 'cust-1' },
      permissions: [],
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'FORBIDDEN');
  } finally {
    await closeServer(runtime.server);
  }
});

test('[server wiring smoke] disabled task-management flag returns 404 over HTTP transport', async () => {
  const runtime = await startServer({
    port: 0,
    flags: {
      isEnabled(flagName) {
        return flagName !== 'enable_task_management';
      },
    },
  });

  try {
    const response = await jsonRequest(runtime.url, {
      method: 'GET',
      path: '/tasks',
      permissions: ['task:read'],
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'NOT_FOUND');
  } finally {
    await closeServer(runtime.server);
  }
});
