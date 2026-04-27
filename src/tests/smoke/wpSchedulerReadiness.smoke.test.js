'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[wp scheduler readiness] json output includes promotion pipeline readiness', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  await execFileAsync('python3', ['scripts/run_promotion_pipeline.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });

  const { stdout } = await execFileAsync('python3', ['scripts/wp_scheduler.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.promotion_pipeline.available, 'boolean');
  assert.equal(typeof report.promotion_pipeline.promotion_ready, 'boolean');
  assert.equal(typeof report.promotion_pipeline.locked_tokens, 'number');
  assert.equal(typeof report.promotion_pipeline.drift_status, 'string');
  assert.ok(Array.isArray(report.ready));
});
