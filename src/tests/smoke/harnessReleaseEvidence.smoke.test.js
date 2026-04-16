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

test('[harness release smoke] release evidence includes prompt version and rollback metadata', async () => {
  await execFileAsync('python3', ['scripts/generate_release_evidence.py'], { cwd: REPO_ROOT });
  const releaseEvidence = JSON.parse(await readFile(RELEASE_EVIDENCE_PATH, 'utf8'));

  assert.equal(typeof releaseEvidence.harness_release, 'object');
  assert.equal(releaseEvidence.harness_release.prompt_version, '0.2.0');
  assert.equal(typeof releaseEvidence.harness_release.rollback_target, 'string');
  assert.equal(typeof releaseEvidence.harness_release.rollback_strategy, 'string');
  assert.equal(releaseEvidence.harness_release.output_schema_ref, 'contracts/harness/output.schema.json');
});
