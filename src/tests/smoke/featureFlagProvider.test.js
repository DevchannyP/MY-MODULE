'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { FeatureFlagProvider } = require('../../infrastructure/FeatureFlagProvider');

test('[feature flags] evaluates metadata, targeting, hooks, and stale state', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flags-'));
  const flagsPath = path.join(tempDir, 'flags.yaml');
  const metadataPath = path.join(tempDir, 'metadata.json');

  fs.writeFileSync(flagsPath, [
    'global_flags:',
    '  enable_debug_mode: true',
    'plugin_flags:',
    '  billing.exception.enabled: false',
    '  video.admin.enabled: false',
    '',
  ].join('\n'), 'utf8');

  fs.writeFileSync(metadataPath, JSON.stringify({
    schema_version: '1',
    flags: {
      'billing.exception.enabled': {
        owner: 'platform-team',
        stage: 'internal',
        expires_on: '2026-12-31',
        allow: {
          permissions_any: ['billing.admin'],
        },
      },
      'enable_debug_mode': {
        owner: 'platform-team',
        stage: 'canary',
        expires_on: '2026-12-31',
        rollout: {
          percentage: 0,
          bucket_by: 'userId',
        },
      },
      'video.admin.enabled': {
        owner: 'video-team',
        stage: 'internal',
        expires_on: '2025-01-01',
        allow: {
          users: ['ops-user'],
        },
      },
    },
  }, null, 2), 'utf8');

  const provider = new FeatureFlagProvider(flagsPath, metadataPath);
  const hookCalls = [];
  provider.registerHook({
    beforeEvaluate(input) {
      hookCalls.push({ phase: 'before', flagName: input.flagName });
    },
    afterEvaluate(details) {
      hookCalls.push({ phase: 'after', flagName: details.flagName, value: details.value });
    },
  });

  const billingDecision = provider.evaluate('billing.exception.enabled', {
    userId: 'analyst',
    permissions: ['billing.admin'],
    route: '/billing/exceptions',
    method: 'GET',
  });
  assert.equal(billingDecision.value, true);
  assert.equal(billingDecision.reason, 'TARGET_PERMISSION');
  assert.equal(billingDecision.stale, false);
  assert.equal(billingDecision.metadata.owner, 'platform-team');

  const adminDecision = provider.evaluate('video.admin.enabled', {
    userId: 'ops-user',
    permissions: [],
  });
  assert.equal(adminDecision.value, true);
  assert.equal(adminDecision.reason, 'TARGET_USER');
  assert.equal(adminDecision.stale, true);

  const rolloutDecision = provider.evaluate('enable_debug_mode', {
    userId: 'canary-user',
    targetingKey: 'canary-user',
  });
  assert.equal(rolloutDecision.value, false);
  assert.equal(rolloutDecision.reason, 'ROLLOUT_SKIP');

  const runtimeStatus = provider.getRuntimeStatus();
  assert.equal(runtimeStatus.flagsLoaded, true);
  assert.equal(runtimeStatus.metadataLoaded, true);
  assert.equal(runtimeStatus.errors.length, 0);

  assert.deepEqual(
    hookCalls.map((entry) => entry.phase),
    ['before', 'after', 'before', 'after', 'before', 'after']
  );
});
