'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[replay packet] logs and replay lenses produce a next packet draft', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_replay_packet.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.type, 'string');
  assert.equal(typeof report.stage, 'string');
  assert.ok(Array.isArray(report.read_first));
  assert.ok(Array.isArray(report.matched_lenses));
});
