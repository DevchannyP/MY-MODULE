'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[capability seed tuning] mapped planning sections are generated from seed and feedback', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_capability_seed_tuning.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.planning_mode.id, 'string');
  assert.ok(Array.isArray(report.mapped_sections));
  assert.ok(report.mapped_sections.length > 0);
  assert.equal(typeof report.commands.capability_seed_tuning_json, 'string');
});
