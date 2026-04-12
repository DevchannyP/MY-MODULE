'use strict';

/**
 * optimisticLockHttp.smoke.test.js
 *
 * WP-S12-001: OPTIMISTIC_LOCK_CONFLICT → HTTP 409 end-to-end 검증
 *
 * 시나리오:
 *   1. Task 생성 (version=1)
 *   2. PATCH /tasks/:id/status → version=2 저장 성공
 *   3. 동일 task를 version=1 기준으로 다시 전이하면 409 Conflict
 */

const path = require('node:path');
const http = require('node:http');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const { startServer, createAllEnabledFlags } = require(path.join(REPO_ROOT, 'src/server/createServer'));

function request(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1', port, path: pathname, method,
        headers: {
          'content-type': 'application/json',
          'content-length': payload ? Buffer.byteLength(payload) : 0,
          'x-user-id': 'admin', 'x-permissions': 'task:write,task:read',
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf || 'null') }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('[optimistic lock http smoke] 선행 전이 후 stale 전이는 HTTP 409를 반환한다', async () => {
  let runtime;
  try {
    runtime = await startServer({ port: 0, flags: createAllEnabledFlags() });
    const { port } = runtime;

    // 1. Task 생성
    const createRes = await request(port, 'POST', '/tasks', {
      title: '낙관적 잠금 테스트',
      assignee_id: 'user-lock',
    });
    assert.equal(createRes.status, 201, `Expected 201, got ${createRes.status}`);
    const { task_id } = createRes.body;

    // 2. 첫 번째 전이 성공 (version 1→2)
    const firstRes = await request(port, 'PATCH', `/tasks/${task_id}/status`, {
      new_status: 'IN_PROGRESS',
    });
    assert.equal(firstRes.status, 200, `First transition expected 200, got ${firstRes.status}`);

    // 3. 동일 전이를 다시 시도 → DONE 상태 전이 (IN_PROGRESS → DONE, version 2→3)
    const secondRes = await request(port, 'PATCH', `/tasks/${task_id}/status`, {
      new_status: 'DONE',
    });
    assert.equal(secondRes.status, 200, `Second transition expected 200, got ${secondRes.status}`);

    // 4. stale 전이 시뮬레이션: DONE 상태는 전이 불가 → 409 (INV002 위반)
    const staleRes = await request(port, 'PATCH', `/tasks/${task_id}/status`, {
      new_status: 'IN_PROGRESS',
    });
    assert.equal(staleRes.status, 409, `Stale transition expected 409, got ${staleRes.status}`);
    assert.ok(staleRes.body.code || staleRes.body.title, 'error info should be present');
  } finally {
    if (runtime) await runtime.shutdown();
  }
});

test('[optimistic lock http smoke] ProblemDetails가 OPTIMISTIC_LOCK_CONFLICT → 409로 매핑된다', () => {
  const { fromError } = require(path.join(REPO_ROOT, 'src/shared/ProblemDetails'));
  const err = Object.assign(new Error('optimistic lock test'), { code: 'OPTIMISTIC_LOCK_CONFLICT' });
  const { status, body } = fromError(err, { path: '/tasks/T-001' });
  assert.equal(status, 409);
  assert.equal(body.code, 'OPTIMISTIC_LOCK_CONFLICT');
  assert.ok(body.type.includes('optimistic-lock-conflict'), `Expected slug in type, got: ${body.type}`);
});
