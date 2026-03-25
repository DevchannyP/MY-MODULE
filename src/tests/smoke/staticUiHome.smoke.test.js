'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[static ui home] artifacts root home is generated with core navigation links', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const artifactPath = path.join(repoRoot, 'artifacts', 'index.html');

  const { stderr } = await execFileAsync('node', ['scripts/generate-ui-home.js'], {
    cwd: repoRoot,
  });

  assert.equal(stderr, '');

  const html = fs.readFileSync(artifactPath, 'utf8');
  assert.match(html, /Workflow OS 운영 홈/);
  assert.match(html, /마스터 플래너/);
  assert.match(html, /도메인 카탈로그/);
  assert.match(html, /학습 가이드/);
  assert.match(html, /npm run ui:build/);
  assert.match(html, /master-planner\/index\.html/);
});
