'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[token roi routing] token ROI turns into a concrete routing patch', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_token_roi_routing_patch.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.estimated_savings_tokens, 'number');
  assert.ok(Array.isArray(report.routing_patch.promote_to_primary));
  assert.ok(Array.isArray(report.routing_patch.move_to_deferred));
});
