'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[kickoff ready gate] kickoff evidence becomes a single ready review blocked signal', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_kickoff_ready_gate.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.match(report.gate_status, /^(ready|review|blocked)$/);
  assert.equal(typeof report.score, 'number');
  assert.ok(Array.isArray(report.reasons));
  assert.ok(Array.isArray(report.next_actions));
});
