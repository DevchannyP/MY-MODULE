'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readFile } = require('node:fs/promises');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[planning studio stage-run migration smoke] snapshot backfills legacy stage-run storage with release evidence observability', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const latestPath = path.join(repoRoot, 'memory', 'project', 'stage-run-latest.yaml');
  const historyPath = path.join(repoRoot, 'memory', 'project', 'stage-run-history.yaml');
  const releaseEvidencePath = path.join(repoRoot, 'artifacts', 'release-evidence', 'release-evidence.json');
  const latestBackup = fs.readFileSync(latestPath, 'utf8');
  const historyBackup = fs.readFileSync(historyPath, 'utf8');

  const legacyLatest = [
    'requested_stage: D',
    'execution_mode: dry-run-only',
    'status: ready',
    "requested_module: ''",
    'quality_gate_result: ""',
    "summary: legacy latest report",
    "recorded_at: '2026-04-18T15:55:20'",
    '',
  ].join('\n');

  const legacyHistory = [
    '- requested_stage: D',
    '  execution_mode: dry-run-only',
    '  status: ready',
    "  requested_module: ''",
    '  quality_gate_result: ""',
    "  summary: legacy history report",
    "  recorded_at: '2026-04-18T15:55:20'",
    '',
  ].join('\n');

  try {
    fs.writeFileSync(latestPath, legacyLatest, 'utf8');
    fs.writeFileSync(historyPath, legacyHistory, 'utf8');

    const { stdout, stderr } = await execFileAsync('python3', ['scripts/planning_studio_api.py', 'snapshot'], {
      cwd: repoRoot,
    });

    assert.equal(stderr, '');
    const snapshot = JSON.parse(stdout);
    assert.equal(snapshot.stage_run_contract.drift_status, 'clean');
    assert.equal(snapshot.stage_run_contract.latest_history_head_match, true);
    assert.equal(snapshot.stage_run_contract.release_evidence_surface_complete, true);
    assert.equal(snapshot.stage_run_contract.release_evidence_generated, false);
    assert.equal(snapshot.stage_run_contract.release_evidence_trigger_reason, 'dry-run-only');
    assert.equal(snapshot.stage_run_last_report.quality_gate_result, 'DRY_RUN_ONLY');
    assert.equal(snapshot.stage_run_last_report.quality_gate_result_reported, '');
    assert.equal(snapshot.stage_run_last_report.quality_gate_source, 'dry-run-only');
    assert.equal(snapshot.stage_run_last_report.quality_gate_ready_for_release_evidence, false);
    assert.equal(snapshot.stage_run_quality_gate.result, 'DRY_RUN_ONLY');
    assert.equal(snapshot.stage_run_quality_gate.source, 'dry-run-only');
    assert.equal(snapshot.stage_run_quality_gate.blocker, 'dry-run-only');
    assert.equal(snapshot.stage_run_last_report.runtime_observability.report_saved, true);
    assert.equal(snapshot.stage_run_last_report.runtime_observability.release_evidence.triggered, false);
    assert.equal(snapshot.stage_run_last_report.runtime_observability.release_evidence.generated, false);
    assert.equal(snapshot.stage_run_last_report.runtime_observability.release_evidence.trigger_reason, 'dry-run-only');
    assert.equal(snapshot.stage_run_recent_reports[0].runtime_observability.release_evidence.command, 'python3 scripts/generate_release_evidence.py');

    const migratedLatest = fs.readFileSync(latestPath, 'utf8');
    const migratedHistory = fs.readFileSync(historyPath, 'utf8');
    assert.match(migratedLatest, /runtime_observability:/);
    assert.match(migratedLatest, /release_evidence:/);
    assert.match(migratedLatest, /quality_gate_result: DRY_RUN_ONLY/);
    assert.match(migratedLatest, /quality_gate_result_reported: ''/);
    assert.match(migratedLatest, /quality_gate_source: dry-run-only/);
    assert.match(migratedLatest, /trigger_reason: dry-run-only/);
    assert.match(migratedHistory, /runtime_observability:/);
    assert.match(migratedHistory, /release_evidence:/);
    assert.match(migratedHistory, /quality_gate_result: DRY_RUN_ONLY/);

    await execFileAsync('python3', ['scripts/generate_release_evidence.py'], {
      cwd: repoRoot,
    });
    const releaseEvidence = JSON.parse(await readFile(releaseEvidencePath, 'utf8'));
    assert.equal(releaseEvidence.stage_run_evidence.quality_gate_result, 'DRY_RUN_ONLY');
    assert.equal(releaseEvidence.stage_run_evidence.release_evidence_blocker, 'quality gate DRY_RUN_ONLY');
  } finally {
    fs.writeFileSync(latestPath, latestBackup, 'utf8');
    fs.writeFileSync(historyPath, historyBackup, 'utf8');
  }
});
