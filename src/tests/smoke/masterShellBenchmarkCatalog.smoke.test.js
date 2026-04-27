'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[master shell smoke] benchmark catalog and planner composition validate together', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout, stderr } = await execFileAsync('python3', ['scripts/validate_master_shell.py'], {
    cwd: repoRoot,
  });

  assert.equal(stderr, '');
  assert.match(stdout, /master-shell composition validation PASS/);
});
