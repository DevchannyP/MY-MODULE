'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[proven kickoff] blueprint, learned preset, and token budget are bundled together', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_proven_kickoff_deck.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.proven_start.blueprint_id, 'string');
  assert.ok(Array.isArray(report.kickoff_steps));
  assert.equal(typeof report.context_budget.locked_tokens, 'number');
  assert.ok(Array.isArray(report.benchmark_focus));
});
