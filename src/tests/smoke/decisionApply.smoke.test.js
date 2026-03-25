'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[decision apply] promotion decision can bridge directly to apply flow', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  await execFileAsync('python3', ['scripts/run_promotion_pipeline.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });

  const { stdout } = await execFileAsync('python3', ['scripts/run_decision_apply.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.decision_gate, 'string');
  assert.equal(typeof report.ready_to_apply, 'boolean');
  assert.equal(typeof report.recommended_next_command, 'string');
  assert.equal(typeof report.result, 'string');
});
