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
          headers: res.headers,
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

test('[server wiring smoke] video flow succeeds over HTTP transport and preserves zero-valued fields', async () => {
  const runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });

  try {
    const uploaded = await jsonRequest(runtime.url, {
      method: 'POST',
      path: '/videos',
      permissions: ['video:read', 'video:write'],
      userId: 'video-uploader',
      body: {
        title: 'server-smoke-video',
        original_file_ref: 's3://bucket/video.mp4',
        file_size_bytes: 0,
      },
    });
    assert.equal(uploaded.status, 201);
    assert.ok(uploaded.body.video_id);
    assert.equal(uploaded.body.file_size_bytes, 0);

    const listed = await jsonRequest(runtime.url, {
      method: 'GET',
      path: '/videos',
      permissions: ['video:read'],
      userId: 'video-uploader',
    });
    assert.equal(listed.status, 200);
    assert.ok(Array.isArray(listed.body.items));
    assert.equal(listed.body.items[0].video_id, uploaded.body.video_id);
    assert.equal(listed.body.items[0].file_size_bytes, 0);
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

test('[server wiring smoke] disabled video transcode flag returns 404 over HTTP transport', async () => {
  const runtime = await startServer({
    port: 0,
    flags: {
      isEnabled(flagName) {
        return flagName !== 'video.transcode.enabled';
      },
    },
  });

  try {
    const uploaded = await jsonRequest(runtime.url, {
      method: 'POST',
      path: '/videos',
      permissions: ['video:read', 'video:write'],
      userId: 'video-uploader',
      body: {
        title: 'flag-gated-video',
        original_file_ref: 's3://bucket/flag-gated.mp4',
      },
    });
    assert.equal(uploaded.status, 201);

    const response = await jsonRequest(runtime.url, {
      method: 'POST',
      path: `/videos/${uploaded.body.video_id}/transcode`,
      permissions: ['video:write'],
      userId: 'video-uploader',
      body: {
        target_format: 'MP4',
        target_resolution: '1080p',
      },
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'NOT_FOUND');
  } finally {
    await closeServer(runtime.server);
  }
});

test('[server wiring smoke] unknown route returns RFC 9457 content type over HTTP transport', async () => {
  const runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });

  try {
    const response = await jsonRequest(runtime.url, {
      method: 'GET',
      path: '/unknown-route',
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.status, 404);
    assert.equal(response.body.title, 'Not Found');
    assert.match(String(response.headers['content-type'] || ''), /^application\/problem\+json/);
  } finally {
    await closeServer(runtime.server);
  }
});
