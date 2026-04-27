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

test('[requirements validation smoke] --all mode validates all domain requirements files', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { stdout, stderr } = await execFileAsync(
    'python3',
    ['scripts/validate_requirements.py', '--all'],
    { cwd: repoRoot },
  );

  assert.equal(stderr, '');
  // 각 도메인 파일이 PASS인지 확인
  assert.match(stdout, /requirements validation PASS:.*billing/);
  assert.match(stdout, /requirements validation PASS:.*requirements/);
  assert.match(stdout, /requirements validation PASS:.*video/);
});

test('[requirements validation smoke] missing module.id is rejected', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const sourcePath = path.join(repoRoot, 'requirements', 'requirements.yaml');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'requirements-schema-smoke-'));
  const tempPath = path.join(tempDir, 'no-module-id.yaml');

  const source = fs.readFileSync(sourcePath, 'utf8');
  // module.id 값을 빈 문자열로 치환
  const invalid = source.replace(/^(\s+id:\s+)[^\n]+/m, '$1""');
  fs.writeFileSync(tempPath, invalid, 'utf8');

  let failure = null;
  try {
    await execFileAsync('python3', ['scripts/validate_requirements.py', tempPath], { cwd: repoRoot });
  } catch (err) {
    failure = err;
  }

  assert.ok(failure, 'expected validator to reject empty module.id');
  assert.match(failure.stdout, /module\.id/);
});

test('[requirements validation smoke] invalid NFR latency is rejected', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const sourcePath = path.join(repoRoot, 'requirements', 'requirements.yaml');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'requirements-schema-smoke-'));
  const tempPath = path.join(tempDir, 'bad-nfr.yaml');

  const source = fs.readFileSync(sourcePath, 'utf8');
  // latency_p99_ms를 음수로 치환
  const invalid = source.replace(/^(\s+latency_p99_ms:\s+)\d+/m, '$1-1');
  fs.writeFileSync(tempPath, invalid, 'utf8');

  let failure = null;
  try {
    await execFileAsync('python3', ['scripts/validate_requirements.py', tempPath], { cwd: repoRoot });
  } catch (err) {
    failure = err;
  }

  assert.ok(failure, 'expected validator to reject negative latency');
  assert.match(failure.stdout, /nfr\.latency_p99_ms/);
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

test('[requirements validation smoke] schema-enforced uniqueItems rejects duplicate provided contracts', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const sourcePath = path.join(repoRoot, 'requirements', 'requirements.yaml');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'requirements-schema-smoke-'));
  const tempRequirementsPath = path.join(tempDir, 'invalid-provides-requirements.yaml');

  const source = fs.readFileSync(sourcePath, 'utf8');
  const invalid = source.replace(
    '  provides:\n    - "domains/productivity/task-tracking/contract/capability.yaml"',
    [
      '  provides:',
      '    - "domains/productivity/task-tracking/contract/capability.yaml"',
      '    - "domains/productivity/task-tracking/contract/capability.yaml"',
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

  assert.ok(failure, 'expected validator to reject duplicate provided contracts');
  assert.match(failure.stdout, /composition\.provides: schema violation -> items must be unique/);
});
