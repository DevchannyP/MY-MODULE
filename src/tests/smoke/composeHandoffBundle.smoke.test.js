'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[handoff bundle] context, fit, and replay are composed into one artifact', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout } = await execFileAsync('python3', ['scripts/compose_handoff_bundle.py', '--goal', 'plan-and-learn', '--json'], {
    cwd: repoRoot,
  });

  const report = JSON.parse(stdout);
  assert.equal(report.goal, 'plan-and-learn');
  assert.equal(typeof report.current_packet.id, 'string');
  assert.equal(typeof report.context_bundle.profile_id, 'string');
  assert.equal(typeof report.fit_report.counts.pass, 'number');
  assert.equal(typeof report.replay_next_packet.goal, 'string');
  assert.ok(Array.isArray(report.sequence));
});
