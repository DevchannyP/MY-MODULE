'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { computeMetrics, evaluateMetric } = require('../../../scripts/harness-dashboard');

const REPO_ROOT = path.resolve(__dirname, '../../..');

test('[harness dashboard] computeMetrics returns all 6 KPI keys', () => {
  const metrics = computeMetrics(REPO_ROOT);
  const keys = [
    'avg_token_per_wp',
    'intake_success_rate',
    'gate_first_pass_rate',
    'auto_approve_rate',
    'truthfulness_violation_rate',
    'memory_sync_atomic_rate',
  ];
  keys.forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(metrics, key), `missing KPI: ${key}`);
  });
});

test('[harness dashboard] evaluateMetric PASS for value meeting gte target', () => {
  const result = evaluateMetric('intake_success_rate', 0.96);
  assert.equal(result.status, 'PASS');
  assert.equal(result.meets_target, true);
});

test('[harness dashboard] evaluateMetric FAIL for value below gte target', () => {
  const result = evaluateMetric('gate_first_pass_rate', 0.70);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.meets_target, false);
});

test('[harness dashboard] evaluateMetric PASS for value meeting lte target', () => {
  const result = evaluateMetric('avg_token_per_wp', 12000);
  assert.equal(result.status, 'PASS');
  assert.equal(result.meets_target, true);
});

test('[harness dashboard] evaluateMetric FAIL for value exceeding lte target', () => {
  const result = evaluateMetric('avg_token_per_wp', 20000);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.meets_target, false);
});

test('[harness dashboard] evaluateMetric NO_DATA for null value', () => {
  const result = evaluateMetric('gate_first_pass_rate', null);
  assert.equal(result.status, 'NO_DATA');
  assert.equal(result.meets_target, null);
});

test('[harness dashboard] truthfulness_violation_rate is 0 in clean state', () => {
  const metrics = computeMetrics(REPO_ROOT);
  assert.equal(metrics.truthfulness_violation_rate, 0);
});

test('[harness dashboard] avg_token_per_wp is below MPO v1.0 target of 15000', () => {
  const metrics = computeMetrics(REPO_ROOT);
  if (metrics.avg_token_per_wp !== null) {
    assert.ok(metrics.avg_token_per_wp <= 15000, `avg_token_per_wp ${metrics.avg_token_per_wp} exceeds target 15000`);
  }
});
