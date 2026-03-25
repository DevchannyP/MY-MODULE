'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[capability brief] current capability summary joins hierarchy, planning mode, and benchmark focus', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_capability_brief.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.capability.name, 'string');
  assert.ok(Array.isArray(report.next_ready_packets));
  assert.ok(Array.isArray(report.benchmark_focus));
  assert.ok(Array.isArray(report.study_points));
});
