'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[routing learning] exception and ROI signals merge into canonical routing memory', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_routing_learning_ledger.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.routing_profile_id, 'string');
  assert.equal(typeof report.estimated_savings_tokens, 'number');
  assert.ok(Array.isArray(report.routing_learning.promote_to_primary));
  assert.ok(Array.isArray(report.routing_learning.move_to_deferred));
});
