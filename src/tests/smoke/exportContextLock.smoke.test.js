'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[context lock] exact file manifest is exported for minimal read tiers', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/export_context_lock.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(report.goal, 'plan-and-learn');
  assert.equal(typeof report.profile_id, 'string');
  assert.ok(Array.isArray(report.locked_files.primary));
  assert.ok(report.locked_files.primary.length >= 1);
  assert.ok(report.summary.total.file_count >= 1);
  assert.match(report.commands.context_lock_json, /export_context_lock/);
});
