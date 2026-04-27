'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[readiness brief] promotion, scheduler, reread, benchmark state are summarized together', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  await execFileAsync('python3', ['scripts/run_promotion_pipeline.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });

  const { stdout } = await execFileAsync('python3', ['scripts/generate_readiness_brief.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.promotion_pipeline.available, 'boolean');
  assert.equal(typeof report.scheduler.ready, 'number');
  assert.equal(typeof report.reread_queue.reread_count, 'number');
  assert.ok(Array.isArray(report.benchmark_focus));
  assert.ok(Array.isArray(report.next_actions));
});
