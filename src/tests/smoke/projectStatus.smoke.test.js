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
  assert.equal(report.current_wp, 'WP-RUN-004');
  assert.equal(typeof report.current_wp_goal, 'string');
  assert.equal(typeof report.current_wp_type, 'string');
  assert.equal(typeof report.current_wp_stage, 'string');
  assert.equal(typeof report.current_wp_context_budget.tier_reads, 'number');
  assert.equal(typeof report.current_wp_context_budget.context_reads, 'number');
  assert.equal(typeof report.current_wp_context_budget.tier_files, 'number');
  assert.equal(typeof report.current_wp_context_budget.context_files, 'number');
  assert.equal(typeof report.current_wp_context_budget.estimated_tokens, 'number');
  assert.ok(report.current_wp_context_budget.tier_reads > 0);
  assert.ok(report.current_wp_context_budget.context_reads > 0);
  assert.ok(report.current_wp_context_budget.estimated_tokens > 0);
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
  assert.equal(report.next_wp, 'NONE');
});
