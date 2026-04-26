'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[planning fit] constraint and adapter fit report is generated from current state', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/check_planning_fit.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(report.goal, 'plan-and-learn');
  assert.equal(report.profile_id, 'master-os-shell');
  assert.equal(typeof report.counts.pass, 'number');
  assert.ok(Array.isArray(report.checks));
  assert.ok(report.checks.some((item) => item.id === 'token-budget'));
  assert.ok(report.checks.some((item) => item.id === 'read-later-exception-policy'));
  assert.equal(typeof report.budget_risk.status, 'string');
  assert.equal(report.read_later_policy.default, 'excluded_from_active_context');
  assert.equal(typeof report.read_later_policy.exception_count, 'number');
});
