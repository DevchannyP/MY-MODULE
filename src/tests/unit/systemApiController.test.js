'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  SystemApiController,
} = require('../../infrastructure/SystemApiController');

test('[system api controller] flag toggle requires system.admin permission', () => {
  const controller = new SystemApiController();

  const response = controller.handle({
    method: 'PATCH',
    path: '/api/v1/system/flags/:flagId',
    params: { flagId: 'system_api.enabled' },
    body: { value: false },
    caller: { userId: 'guest', permissions: [] },
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'FORBIDDEN');
});

test('[system api controller] rollback requires system.admin permission', () => {
  const controller = new SystemApiController();

  const response = controller.handle({
    method: 'POST',
    path: '/api/v1/system/rollback/:domain',
    params: { domain: 'system' },
    body: { reason: 'unauthorized smoke' },
    caller: { userId: 'guest', permissions: [] },
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'FORBIDDEN');
});

test('[system api controller] runtime flag details are exposed ahead of raw yaml fallback', () => {
  const controller = new SystemApiController({
    flagProvider: {
      getFullFlagDetails() {
        return [
          {
            flag: 'system_api.enabled',
            enabled: true,
            env_overridden: true,
            source: 'env',
            group: 'plugin_flags',
            description: 'runtime override',
            depends_on: ['system_api.sse_stream.enabled'],
          },
        ];
      },
    },
  });

  const response = controller.handle({
    method: 'GET',
    path: '/api/v1/system/flags',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.flags.map((flag) => flag.id), ['system_api.enabled']);
  assert.equal(response.body.flags[0].env_overridden, true);
  assert.equal(response.body.flags[0].source, 'env');
});
