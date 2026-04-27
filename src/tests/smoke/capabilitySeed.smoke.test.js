'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[capability seed] capability-specific planning seed sections are generated', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_capability_planning_seed.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.planning_mode.id, 'string');
  assert.ok(Array.isArray(report.seed_sections));
  assert.ok(report.seed_sections.some((item) => item.id === 'capability_goal'));
});
