'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[harness routing smoke] cost and latency routing baseline validates', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout, stderr } = await execFileAsync('python3', ['scripts/validate_harness_routing.py'], {
    cwd: repoRoot,
  });

  assert.equal(stderr, '');
  assert.match(stdout, /harness routing validation PASS/);
});
