'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[apply timeline] recent decision/apply history is summarized', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  await execFileAsync('python3', ['scripts/run_decision_apply.py', '--json'], {
    cwd: repoRoot,
  });

  const { stdout } = await execFileAsync('python3', ['scripts/generate_apply_timeline.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.entry_count, 'number');
  assert.ok(Array.isArray(report.timeline));
  assert.equal(typeof report.commands.apply_timeline_json, 'string');
});
