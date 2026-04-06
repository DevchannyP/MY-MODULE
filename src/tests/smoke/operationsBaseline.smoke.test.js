'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[operations baseline smoke] observability and rollback validations pass for requirement portfolio', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');

  const observability = await execFileAsync('python3', ['scripts/validate_operations.py', 'observability'], {
    cwd: repoRoot,
  });
  assert.equal(observability.stderr, '');
  assert.match(observability.stdout, /observability baseline validation PASS/);

  const rollback = await execFileAsync('python3', ['scripts/validate_operations.py', 'rollback'], {
    cwd: repoRoot,
  });
  assert.equal(rollback.stderr, '');
  assert.match(rollback.stdout, /rollback baseline validation PASS/);
});
