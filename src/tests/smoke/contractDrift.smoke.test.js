'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[contract drift smoke] requirement-defined contracts validate cleanly', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout, stderr } = await execFileAsync('python3', ['scripts/validate_contract_drift.py'], {
    cwd: repoRoot,
  });

  assert.equal(stderr, '');
  assert.match(stdout, /contract drift validation PASS/);
});

test('[contract drift smoke] ui shell control api contract stays aligned with frontend and runtime endpoints', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout, stderr } = await execFileAsync('python3', ['scripts/validate_ui_shell_contract.py'], {
    cwd: repoRoot,
  });

  assert.equal(stderr, '');
  assert.match(stdout, /ui shell contract validation PASS/);
});
