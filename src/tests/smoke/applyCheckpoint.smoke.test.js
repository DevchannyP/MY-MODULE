'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[apply checkpoint] pre-apply review artifact is generated from decision and promotion state', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  await execFileAsync('python3', ['scripts/run_promotion_pipeline.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });

  const { stdout } = await execFileAsync('python3', ['scripts/generate_apply_checkpoint.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.decision_gate, 'string');
  assert.equal(typeof report.ready_to_apply, 'boolean');
  assert.equal(typeof report.post_apply_preview.promoted_packet_id, 'string');
  assert.equal(typeof report.locked_context_budget.locked_total_estimated_tokens, 'number');
});
