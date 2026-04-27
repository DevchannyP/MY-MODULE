'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[promotion decision] readiness, fit, and reread state become a single gate', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  await execFileAsync('python3', ['scripts/run_promotion_pipeline.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });

  const { stdout } = await execFileAsync('python3', ['scripts/generate_promotion_decision.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.gate_status, 'string');
  assert.equal(typeof report.ready_to_apply, 'boolean');
  assert.equal(typeof report.locked_tokens, 'number');
  assert.equal(typeof report.recommended_next_command, 'string');
  assert.ok(Array.isArray(report.reasons));
});
