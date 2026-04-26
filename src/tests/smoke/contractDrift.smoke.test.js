'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('[contract drift smoke] requirement-defined contracts validate cleanly', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const result = spawnSync('python3', ['scripts/validate_contract_drift.py'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const { stdout, stderr } = result;

  assert.equal(result.status, 0, stderr || stdout);
  assert.equal(stderr, '');
  assert.match(stdout, /contract drift validation PASS/);
});

test('[contract drift smoke] ui shell control api contract stays aligned with frontend and runtime endpoints', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const result = spawnSync('python3', ['scripts/validate_ui_shell_contract.py'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const { stdout, stderr } = result;

  assert.equal(result.status, 0, stderr || stdout);
  assert.equal(stderr, '');
  assert.match(stdout, /ui shell contract validation PASS/);
});
