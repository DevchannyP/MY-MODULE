'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[benchmark pack] goal-specific benchmark action pack is generated', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_benchmark_pack.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(report.goal, 'plan-and-learn');
  assert.ok(Array.isArray(report.recommended_focuses));
  assert.equal(report.recommended_focuses.length, 3);
  assert.ok(report.recommended_focuses.some((item) => item.id === 'master-planning-truth-surface'));
  assert.ok(report.recommended_focuses.some((item) => item.id === 'minimum-context-routing-performance'));
  assert.ok(report.recommended_focuses.some((item) => item.id === 'guided-learning-live-ops-cockpit'));
  assert.equal(report.benchmark_review.reviewed_on, '2026-03-25');
  assert.ok(Array.isArray(report.benchmark_sources));
  assert.match(report.commands.promote_json, /promote_packet/);
});
