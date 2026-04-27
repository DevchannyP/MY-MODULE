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

test('[feature flags] WOS_FLAG_ env override activates declared flags without creating phantom flags', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flags-env-'));
  const flagsPath = path.join(tempDir, 'flags.yaml');
  const metadataPath = path.join(tempDir, 'metadata.json');

  fs.writeFileSync(flagsPath, [
    'plugin_flags:',
    '  billing.enabled: false',
    '  video.enabled: false',
    '  enable_task_management: false',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(metadataPath, JSON.stringify({ flags: {} }), 'utf8');

  // env 오버라이드 설정
  process.env['WOS_FLAG_BILLING_ENABLED'] = 'true';
  process.env['WOS_FLAG_ENABLE_TASK_MANAGEMENT'] = '1';
  // phantom flag — yaml에 없는 키는 생성되지 않아야 한다
  process.env['WOS_FLAG_PHANTOM_KEY'] = 'true';

  try {
    const provider = new FeatureFlagProvider(flagsPath, metadataPath);

    // env로 활성화된 플래그
    assert.equal(provider.isEnabled('billing.enabled'), true, 'billing.enabled should be overridden to true');
    assert.equal(provider.isEnabled('enable_task_management'), true, 'enable_task_management should be overridden to true');
    // 오버라이드 없는 플래그는 yaml 기본값 유지
    assert.equal(provider.isEnabled('video.enabled'), false, 'video.enabled should remain false');
    // phantom flag 미생성 확인
    assert.equal('phantom_key' in provider.getAll(), false, 'phantom flag must not be created');
    assert.equal('WOS_FLAG_PHANTOM_KEY' in provider.getAll(), false, 'env key itself must not appear as flag');

    // getRuntimeStatus에 envOverridesApplied 노출
    const status = provider.getRuntimeStatus();
    assert.equal(status.envOverridesApplied, 2, `expected 2 overrides, got ${status.envOverridesApplied}`);
  } finally {
    delete process.env['WOS_FLAG_BILLING_ENABLED'];
    delete process.env['WOS_FLAG_ENABLE_TASK_MANAGEMENT'];
    delete process.env['WOS_FLAG_PHANTOM_KEY'];
  }
});

test('[feature flags] WOS_FLAG_ env override can also disable a yaml-enabled flag', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flags-env-off-'));
  const flagsPath = path.join(tempDir, 'flags.yaml');
  const metadataPath = path.join(tempDir, 'metadata.json');

  fs.writeFileSync(flagsPath, [
    'global_flags:',
    '  enable_debug_mode: true',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(metadataPath, JSON.stringify({ flags: {} }), 'utf8');

  process.env['WOS_FLAG_ENABLE_DEBUG_MODE'] = 'false';
  try {
    const provider = new FeatureFlagProvider(flagsPath, metadataPath);
    assert.equal(provider.isEnabled('enable_debug_mode'), false, 'env false should disable yaml-true flag');
    assert.equal(provider.getRuntimeStatus().envOverridesApplied, 1);
  } finally {
    delete process.env['WOS_FLAG_ENABLE_DEBUG_MODE'];
  }
});

test('[feature flags] WOS_FLAG_ env override bypasses rollout percentage — full env activation', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flags-env-rollout-'));
  const flagsPath = path.join(tempDir, 'flags.yaml');
  const metadataPath = path.join(tempDir, 'metadata.json');

  fs.writeFileSync(flagsPath, [
    'plugin_flags:',
    '  my_feature: false',
    '',
  ].join('\n'), 'utf8');
  // rollout 0% — 정상이라면 누구도 못 씀
  fs.writeFileSync(metadataPath, JSON.stringify({
    flags: {
      my_feature: {
        rollout: { percentage: 0, bucket_by: 'userId' },
      },
    },
  }), 'utf8');

  process.env['WOS_FLAG_MY_FEATURE'] = 'true';
  try {
    const provider = new FeatureFlagProvider(flagsPath, metadataPath);

    // rollout 0%지만 env override가 있으므로 모든 userId에 대해 true
    const result1 = provider.evaluate('my_feature', { userId: 'user-a' });
    const result2 = provider.evaluate('my_feature', { userId: 'user-b' });
    assert.equal(result1.value, true, 'env override should bypass 0% rollout for user-a');
    assert.equal(result2.value, true, 'env override should bypass 0% rollout for user-b');
    assert.equal(result1.reason, 'ENV_OVERRIDE_TRUE');
    assert.equal(result2.reason, 'ENV_OVERRIDE_TRUE');
  } finally {
    delete process.env['WOS_FLAG_MY_FEATURE'];
  }
});
