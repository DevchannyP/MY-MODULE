'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[exception replay] allowed exception context is summarized for study and next actions', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_exception_replay.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.ok(Array.isArray(report.allowed_exception_paths));
  assert.ok(Array.isArray(report.candidate_primary_promotions));
  assert.ok(Array.isArray(report.study_prompts));
  assert.ok(Array.isArray(report.next_actions));
});
