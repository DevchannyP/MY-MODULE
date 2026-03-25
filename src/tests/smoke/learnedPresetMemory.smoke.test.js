'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[learned preset memory] decision/apply history becomes reusable preset memory', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  await execFileAsync('python3', ['scripts/run_decision_apply.py', '--json'], {
    cwd: repoRoot,
  });

  const { stdout } = await execFileAsync('python3', ['scripts/generate_learned_preset_memory.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.recommended_signature.planning_mode_id, 'string');
  assert.ok(Array.isArray(report.learning_sections));
  assert.ok(Array.isArray(report.top_signatures));
});
