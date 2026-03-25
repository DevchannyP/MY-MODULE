'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[execution packet apply] exported packet can be applied to current-wp and next-actions', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfos-packet-'));
  const packetPath = path.join(tempDir, 'packet.yaml');
  const currentWpPath = path.join(tempDir, 'current-wp.yaml');
  const nextActionsPath = path.join(tempDir, 'next-actions.yaml');

  fs.writeFileSync(packetPath, `id: "WP-DRAFT-2026-03-24"
goal: "planner에서 생성한 실행 packet을 current-wp에 적용한다"
type: "planning"
stage: "A"
scope_in:
  - "memory/checkpoint.yaml"
constraints:
  - "master OS 코어를 수정하지 않는다"
done_when:
  - "planner artifact 재생성"
validation:
  - "python3 scripts/validate_master_shell.py"
context_budget:
  tier_reads:
    - "memory/checkpoint.yaml"
    - "memory/current-wp.yaml"
  context_reads:
    - "requirements/requirements.yaml"
  estimated_turns: 3
  max_new_files: 2
  max_modified_files: 4
`, 'utf8');
  fs.writeFileSync(currentWpPath, 'id: "OLD-WP"\ngoal: "old"\n', 'utf8');
  fs.writeFileSync(nextActionsPath, 'as_of: "2026-03-20"\nselection_policy: "old"\nnext_wp: "OLD-WP"\nqueue: []\n', 'utf8');

  const { stdout } = await execFileAsync('python3', [
    'scripts/apply_execution_packet.py',
    '--input', packetPath,
    '--apply',
    '--json',
    '--current-wp-path', currentWpPath,
    '--next-actions-path', nextActionsPath,
  ], {
    cwd: path.resolve(__dirname, '../../..'),
  });

  const report = JSON.parse(stdout);
  assert.equal(report.result, 'applied');
  assert.equal(report.packet_id, 'WP-DRAFT-2026-03-24');
  assert.equal(report.next_actions_next_wp, 'WP-DRAFT-2026-03-24');

  const currentWp = fs.readFileSync(currentWpPath, 'utf8');
  const nextActions = fs.readFileSync(nextActionsPath, 'utf8');

  assert.match(currentWp, /WP-DRAFT-2026-03-24/);
  assert.match(currentWp, /status: in_progress/);
  assert.match(currentWp, /context_budget:/);
  assert.match(nextActions, /next_wp: WP-DRAFT-2026-03-24/);
  assert.match(nextActions, /status: in_progress/);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
