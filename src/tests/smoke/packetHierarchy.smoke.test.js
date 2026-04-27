'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[packet hierarchy] capability-scoped packet progress and next packets are exported', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_packet_hierarchy.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.current_wp_id, 'string');
  assert.equal(typeof report.capability.name, 'string');
  assert.equal(typeof report.capability.total_packets, 'number');
  assert.ok(Array.isArray(report.ready_in_capability));
  assert.ok(Array.isArray(report.learning_path));
});
