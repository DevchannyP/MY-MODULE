'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[harness contract smoke] provider adapter contract baseline validates', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stderr } = await execFileAsync('node', ['scripts/validate-harness-contract.js'], {
    cwd: repoRoot,
  });

  assert.equal(stderr, '');
});
