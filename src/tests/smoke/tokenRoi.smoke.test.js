'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[token roi] context lock and exception routing produce token ROI guidance', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_token_roi_report.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.locked_tokens, 'number');
  assert.equal(typeof report.estimated_savings_tokens, 'number');
  assert.ok(Array.isArray(report.promote_to_primary));
  assert.ok(Array.isArray(report.defer_or_drop));
});
