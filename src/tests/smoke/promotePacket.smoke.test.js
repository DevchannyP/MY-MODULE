'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[promote packet] validated promotion can write next execution packet', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfos-promote-'));
  const currentWpPath = path.join(tempDir, 'current-wp.yaml');
  const nextActionsPath = path.join(tempDir, 'next-actions.yaml');
  const outputPacketPath = path.join(tempDir, 'promoted-packet.yaml');

  fs.writeFileSync(currentWpPath, `id: "WP-DONE-001"
goal: "직전 packet을 닫고 다음 packet으로 승격한다"
type: "planning"
stage: "A"
status: "completed"
scope_out:
  - "system OS core"
constraints:
  - "core는 수정하지 않는다"
fail_if:
  - "core를 직접 수정한다"
validation:
  - "python3 scripts/validate_master_shell.py"
context_budget:
  tier_reads:
    - "memory/checkpoint.yaml"
  context_reads:
    - "requirements/requirements.yaml"
`, 'utf8');
  fs.writeFileSync(nextActionsPath, 'as_of: "2026-03-24"\nselection_policy: "old"\nnext_wp: "WP-DONE-001"\nqueue: []\n', 'utf8');

  const { stdout } = await execFileAsync('python3', [
    'scripts/promote_packet.py',
    '--goal', 'plan-and-learn',
    '--apply',
    '--json',
    '--output', outputPacketPath,
    '--current-wp-path', currentWpPath,
    '--next-actions-path', nextActionsPath,
  ], {
    cwd: path.resolve(__dirname, '../../..'),
  });

  const report = JSON.parse(stdout);
  assert.equal(report.result, 'applied');
  assert.equal(report.promotion_ready, true);
  assert.match(report.promoted_packet.id, /WP-PROMOTE-/);
  assert.equal(report.next_actions_next_wp, report.promoted_packet.id);

  const currentWp = fs.readFileSync(currentWpPath, 'utf8');
  const nextActions = fs.readFileSync(nextActionsPath, 'utf8');
  const outputPacket = fs.readFileSync(outputPacketPath, 'utf8');

  assert.match(currentWp, /WP-PROMOTE-/);
  assert.match(nextActions, /next_wp: WP-PROMOTE-/);
  assert.match(outputPacket, /template_id:/);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
