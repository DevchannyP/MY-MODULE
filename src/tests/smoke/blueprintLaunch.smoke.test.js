'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[blueprint launch] blueprint start deck is generated for the current goal', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_blueprint_launch_deck.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.blueprint.id, 'string');
  assert.equal(typeof report.planning_mode.id, 'string');
  assert.equal(typeof report.routing_profile.id, 'string');
  assert.ok(Array.isArray(report.launch_sequence));
  assert.ok(Array.isArray(report.benchmark_focus));
});
