'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[promotion pipeline] artifacts and optional apply are orchestrated together', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfos-pipeline-'));
  const currentWpPath = path.join(tempDir, 'current-wp.yaml');
  const nextActionsPath = path.join(tempDir, 'next-actions.yaml');
  const artifactDir = path.join(tempDir, 'artifacts');

  fs.writeFileSync(currentWpPath, `id: "WP-DONE-PIPE-001"
goal: "승격 파이프라인을 테스트한다"
type: "planning"
stage: "A"
status: "completed"
scope_out:
  - "system OS core"
fail_if:
  - "core를 직접 수정한다"
`, 'utf8');
  fs.writeFileSync(nextActionsPath, 'as_of: "2026-03-24"\nselection_policy: "old"\nnext_wp: "WP-DONE-PIPE-001"\nqueue: []\n', 'utf8');

  const { stdout } = await execFileAsync('python3', [
    'scripts/run_promotion_pipeline.py',
    '--goal', 'plan-and-learn',
    '--apply',
    '--json',
    '--artifact-dir', artifactDir,
    '--current-wp-path', currentWpPath,
    '--next-actions-path', nextActionsPath,
  ], {
    cwd: path.resolve(__dirname, '../../..'),
  });

  const report = JSON.parse(stdout);
  assert.equal(report.result, 'applied');
  assert.equal(report.promotion_ready, true);
  assert.ok(fs.existsSync(report.artifacts.context_lock));
  assert.ok(fs.existsSync(report.artifacts.handoff_bundle));
  assert.ok(fs.existsSync(report.artifacts.benchmark_pack));
  assert.ok(fs.existsSync(report.artifacts.promoted_packet));

  const nextActions = fs.readFileSync(nextActionsPath, 'utf8');
  assert.match(nextActions, /WP-PROMOTE-/);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
