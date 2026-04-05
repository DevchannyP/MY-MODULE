'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, '../../..');

test('[static analysis gate smoke] eslint reports zero errors across src/ domains/ scripts/', async () => {
  const { stdout, stderr } = await execFileAsync(
    'node',
    ['node_modules/.bin/eslint', 'src', 'domains', 'scripts', '--max-warnings=0'],
    { cwd: REPO_ROOT },
  ).catch((err) => {
    // eslint exits non-zero when there are lint errors — capture stdout/stderr for diagnosis
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.code };
  });

  assert.equal(
    stderr, '',
    'ESLint produced unexpected stderr output',
  );
  assert.equal(
    stdout, '',
    `ESLint found lint errors or warnings — fix before releasing:\n${stdout}`,
  );
});
