'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[kickoff evidence] kickoff surfaces are bundled into one evidence artifact', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_kickoff_evidence_bundle.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.execution_readiness.score, 'number');
  assert.ok(Array.isArray(report.kickoff_steps));
  assert.ok(Array.isArray(report.planning_sections));
});
