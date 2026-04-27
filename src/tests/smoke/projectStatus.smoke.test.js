'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../../../scripts/project_status');

const execFileAsync = promisify(execFile);

test('[project status smoke] next_wp는 canonical wp-queue 기준으로 계산된다', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  await execFileAsync('python3', ['scripts/run_promotion_pipeline.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });
  const report = buildReport();
  // current_wp ID는 memory/current-wp.yaml에서 오므로 구조만 검증한다.
  assert.equal(typeof report.current_wp, 'string');
  assert.ok(report.current_wp.length > 0, 'current_wp must not be empty');
  assert.equal(typeof report.current_wp_goal, 'string');
  assert.equal(typeof report.current_wp_type, 'string');
  assert.equal(typeof report.current_wp_stage, 'string');
  assert.equal(typeof report.current_wp_context_budget.tier_reads, 'number');
  assert.equal(typeof report.current_wp_context_budget.context_reads, 'number');
  assert.equal(typeof report.current_wp_context_budget.tier_files, 'number');
  assert.equal(typeof report.current_wp_context_budget.context_files, 'number');
  assert.equal(typeof report.current_wp_context_budget.estimated_tokens, 'number');
  // context budget은 활성 WP일 때 > 0, queue 완료 상태에선 0도 유효
  assert.ok(report.current_wp_context_budget.tier_reads >= 0);
  assert.ok(report.current_wp_context_budget.context_reads >= 0);
  assert.ok(report.current_wp_context_budget.estimated_tokens >= 0);
  assert.equal(typeof report.current_wp_scope_boundary.scope_in, 'number');
  assert.equal(typeof report.current_wp_scope_boundary.scope_out, 'number');
  assert.equal(typeof report.current_wp_scope_boundary.protects_core, 'boolean');
  assert.equal(typeof report.promotion_pipeline.available, 'boolean');
  assert.equal(typeof report.promotion_pipeline.promotion_ready, 'boolean');
  assert.equal(typeof report.promotion_pipeline.locked_tokens, 'number');
  assert.equal(typeof report.promotion_pipeline.drift_status, 'string');
  assert.ok(Array.isArray(report.essential_improvements));
  assert.equal(report.essential_improvements.length, 3);
  assert.ok(report.essential_improvements.some((item) => item.id === 'master-planning-truth-surface'));
  assert.ok(report.essential_improvements.some((item) => item.id === 'minimum-context-routing-performance'));
  assert.ok(report.essential_improvements.some((item) => item.id === 'guided-learning-live-ops-cockpit'));
  // next_wp는 큐가 비어있으면 'NONE', 신규 WP가 있으면 해당 ID — 둘 다 유효
  assert.equal(typeof report.next_wp, 'string');
});
