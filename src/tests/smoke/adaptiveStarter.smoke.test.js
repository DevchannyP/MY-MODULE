'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[adaptive starter] learned preset memory is promoted into starter defaults', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_adaptive_starter_preset.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.source, 'string');
  assert.equal(typeof report.recommended_signature.planning_mode_id, 'string');
  assert.ok(Array.isArray(report.planning_sections));
});
