'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[apply outcome scorecard] apply history and token efficiency are summarized', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_apply_outcome_scorecard.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(typeof report.score, 'number');
  assert.equal(typeof report.history_window.entry_count, 'number');
  assert.equal(typeof report.token_efficiency.locked_tokens, 'number');
  assert.ok(Array.isArray(report.action_items));
});
