'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[harness security smoke] trust-boundary and red-team baseline validate', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout, stderr } = await execFileAsync('python3', ['scripts/validate_harness_security.py'], {
    cwd: repoRoot,
  });

  assert.equal(stderr, '');
  assert.match(stdout, /harness security validation PASS/);
});
