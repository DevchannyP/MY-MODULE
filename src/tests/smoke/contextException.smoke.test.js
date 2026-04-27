'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[context exception] bounded extra-read ledger is generated from remaining headroom', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_context_exception_ledger.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.base_budget.primary_headroom_tokens, 'number');
  assert.equal(typeof report.base_budget.total_headroom_tokens, 'number');
  assert.equal(typeof report.allowed_exception_count, 'number');
  assert.ok(Array.isArray(report.exceptions));
});
