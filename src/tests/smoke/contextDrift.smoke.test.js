'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[context drift] changed and missing files are surfaced from a lock manifest', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfos-drift-'));
  const rootDir = path.join(tempDir, 'root');
  const filePath = path.join(rootDir, 'notes.txt');
  const lockPath = path.join(tempDir, 'context-lock.json');

  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(filePath, 'before\n', 'utf8');

  const sha256 = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  fs.writeFileSync(lockPath, JSON.stringify({
    goal: 'plan-and-learn',
    profile_id: 'plan-and-learn-routing',
    current_wp: { id: 'WP-TEST-DRIFT' },
    locked_files: {
      primary: [
        {
          path: 'notes.txt',
          tier: 'primary',
          exists: true,
          estimated_tokens: 2,
          sha256,
        },
      ],
      secondary: [
        {
          path: 'missing.txt',
          tier: 'secondary',
          exists: true,
          estimated_tokens: 3,
          sha256: 'missing-sha256',
        },
      ],
    },
  }, null, 2), 'utf8');

  fs.writeFileSync(filePath, 'after\n', 'utf8');

  const { stdout } = await execFileAsync('python3', [
    'scripts/check_context_drift.py',
    '--input', lockPath,
    '--root', rootDir,
    '--json',
  ], {
    cwd: path.resolve(__dirname, '../../..'),
  });

  const report = JSON.parse(stdout);
  assert.equal(report.drift_status, 'drifted');
  assert.equal(report.counts.changed, 1);
  assert.equal(report.counts.missing, 1);
  assert.ok(report.reread_first.includes('notes.txt'));
  assert.ok(report.reread_first.includes('missing.txt'));

  fs.rmSync(tempDir, { recursive: true, force: true });
});
