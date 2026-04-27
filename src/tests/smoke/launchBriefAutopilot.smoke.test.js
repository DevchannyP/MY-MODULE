'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[launch brief autopilot] kickoff and starter evidence become one launch recommendation', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_launch_brief_autopilot.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.recommendation.planning_mode_id, 'string');
  assert.equal(typeof report.ready_gate.score, 'number');
  assert.ok(Array.isArray(report.start_now));
  assert.ok(Array.isArray(report.guardrails));
});
