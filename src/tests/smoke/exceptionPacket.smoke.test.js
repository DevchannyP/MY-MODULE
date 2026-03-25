'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[exception packet] bounded extra context becomes a packet draft', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_exception_packet.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.equal(report.mode, 'exception-context');
  assert.ok(Array.isArray(report.allowed_paths));
  assert.ok(Array.isArray(report.candidate_primary_promotions));
  assert.equal(typeof report.prompt_block, 'string');
});
