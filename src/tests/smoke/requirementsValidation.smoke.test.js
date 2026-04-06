'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[requirements validation smoke] baseline requirements file passes', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout, stderr } = await execFileAsync('python3', ['scripts/validate_requirements.py'], {
    cwd: repoRoot,
  });

  assert.equal(stderr, '');
  assert.match(stdout, /requirements validation PASS/);
});

test('[requirements validation smoke] schema-enforced uniqueItems rejects duplicate dependencies', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const sourcePath = path.join(repoRoot, 'requirements', 'requirements.yaml');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'requirements-schema-smoke-'));
  const tempRequirementsPath = path.join(tempDir, 'invalid-requirements.yaml');

  const source = fs.readFileSync(sourcePath, 'utf8');
  const invalid = source.replace(
    'depends_on: []',
    [
      'depends_on:',
      '  - "domains/productivity/task-tracking/contract/capability.yaml"',
      '  - "domains/productivity/task-tracking/contract/capability.yaml"',
    ].join('\n'),
  );
  fs.writeFileSync(tempRequirementsPath, invalid, 'utf8');

  let failure = null;
  try {
    await execFileAsync('python3', ['scripts/validate_requirements.py', tempRequirementsPath], {
      cwd: repoRoot,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure, 'expected validator to reject duplicate dependencies');
  assert.match(failure.stdout, /composition\.depends_on: schema violation -> items must be unique/);
});
