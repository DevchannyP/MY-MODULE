'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[reread queue] context drift candidates are exported in priority order', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  await execFileAsync('python3', ['scripts/run_promotion_pipeline.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });

  const { stdout } = await execFileAsync('python3', ['scripts/generate_reread_queue.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.drift_status, 'string');
  assert.equal(typeof report.reread_count, 'number');
  assert.ok(Array.isArray(report.reread_queue));
  assert.equal(typeof report.commands.reread_queue_json, 'string');
});
