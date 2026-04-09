'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[mindmap control center interaction smoke] worker selection is wired to immediate dispatch controls', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const artifactPath = path.join(repoRoot, 'artifacts', 'mindmap', 'index.html');

  const { stderr } = await execFileAsync('node', ['scripts/generate-mindmap.js'], {
    cwd: repoRoot,
  });

  assert.equal(stderr, '');

  const html = fs.readFileSync(artifactPath, 'utf8');

  assert.match(html, /즉시 제어 worker/);
  assert.match(html, /id="execution-worker-select"/);
  assert.match(html, /onchange="syncExecutionInputs\(\)"/);
  assert.match(html, /var workerEl = document\.getElementById\('execution-worker-select'\);/);
  assert.match(html, /S\.execution\.selectedWorkerIndex = Math\.max\(0, Number\.parseInt\(workerEl\.value, 10\) \|\| 0\);/);
  assert.match(html, /var workerIndex = Number\.isInteger\(S\.execution\.selectedWorkerIndex\) \? S\.execution\.selectedWorkerIndex : 0;/);
  assert.match(html, /worker 선택 확인 필요/);
  assert.match(html, /idempotencyPayload: \{ worker_index: workerIndex \}/);
  assert.match(html, /body: JSON\.stringify\(\{ worker_index: workerIndex \}\)/);
  assert.match(html, /showToast\(workerName \+ ' 즉시 전송 완료'\);/);
});
