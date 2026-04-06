'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readFile } = require('node:fs/promises');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, '../../..');
const RELEASE_EVIDENCE_PATH = path.join(REPO_ROOT, 'artifacts/release-evidence/release-evidence.json');

test('[release evidence smoke] sbom, provenance, and release evidence are regenerated with artifact digests', async () => {
  await execFileAsync('python3', ['scripts/generate_sbom.py'], { cwd: REPO_ROOT });
  await execFileAsync('python3', ['scripts/verify_provenance.py'], { cwd: REPO_ROOT });
  await execFileAsync('python3', ['scripts/generate_release_evidence.py'], { cwd: REPO_ROOT });

  const releaseEvidence = JSON.parse(await readFile(RELEASE_EVIDENCE_PATH, 'utf8'));

  assert.equal(releaseEvidence.schema_version, '3');
  assert.equal(releaseEvidence.repository, 'my-module');
  assert.match(String(releaseEvidence.generated_at_utc || ''), /\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof releaseEvidence.quality_gate_result, 'string');
  assert.ok(Array.isArray(releaseEvidence.quality_gate_inputs));
  assert.ok(releaseEvidence.quality_gate_inputs.length >= 4);

  assert.equal(typeof releaseEvidence.git_status, 'object');
  assert.equal(typeof releaseEvidence.git_status.is_clean, 'boolean');
  assert.ok(Array.isArray(releaseEvidence.git_status.modified_paths));
  assert.ok(Array.isArray(releaseEvidence.git_status.untracked_paths));

  assert.equal(typeof releaseEvidence.last_completed_unit, 'object');
  assert.match(String(releaseEvidence.last_completed_unit.mode || ''), /^(work_packet|stage|unknown)$/);

  const artifacts = releaseEvidence.release_artifacts || {};
  for (const key of ['release_evidence', 'provenance', 'sbom']) {
    assert.equal(typeof artifacts[key], 'object', `${key} evidence must exist`);
    assert.equal(artifacts[key].exists, true, `${key} artifact must exist`);
    assert.match(String(artifacts[key].path || ''), /^artifacts\//, `${key} path must be repo-relative`);
  }

  assert.equal(
    artifacts.release_evidence.digest_strategy,
    'external-verification-required',
    'release evidence self-digest must declare external verification strategy',
  );
  for (const key of ['provenance', 'sbom']) {
    assert.match(String(artifacts[key].sha256 || ''), /^[a-f0-9]{64}$/, `${key} sha256 must be present`);
  }
});
