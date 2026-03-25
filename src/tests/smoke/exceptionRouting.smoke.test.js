'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[exception routing] exception replay becomes routing patch suggestions', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/generate_exception_routing_patch.py', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(typeof report.goal, 'string');
  assert.ok(Array.isArray(report.routing_patch.promote_to_must_read));
  assert.ok(Array.isArray(report.routing_patch.keep_expand_if_needed));
  assert.ok(Array.isArray(report.rationale));
});
