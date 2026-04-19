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
  assert.match(html, /연속 실행 오퍼레이터 바/);
  assert.match(html, /반복 프롬프트/);
  assert.match(html, /Operator Chain/);
  assert.match(html, /Release Evidence/);
  assert.match(html, /Action Sources/);
  assert.match(html, /flow-source-summary/);
  assert.match(html, /source 집계 없음/);
  assert.match(html, /지금 실행할 카드/);
  assert.match(html, /flow-chain-spotlight-title/);
  assert.match(html, /Session Bootstrap/);
  assert.match(html, /control center에서 이어서 보기/);
  assert.match(html, /flow-chain-spotlight-copy/);
  assert.match(html, /flow-chain-spotlight-fill/);
  assert.match(html, /명령 복사/);
  assert.match(html, /실행 패널에 채우기/);
  assert.match(html, /source=home-spotlight/);
  assert.match(html, /바로 열기/);
  assert.match(html, /flow-chain-item is-active/);
  assert.match(html, /flow-chain-delivery-/);
  assert.match(html, /flow-chain-delivery-meta-/);
  assert.match(html, /flow-chain-delivery-pill/);
  assert.match(html, /normalizeOperatorActionClientEntries/);
  assert.match(html, /loadOperatorActionClientStorage/);
  assert.match(html, /mergeOperatorActionClientEntries/);
  assert.match(html, /operatorActionClientSourceSummary/);
  assert.match(html, /buildDeepLinkClientHref/);
  assert.match(html, /fetchJsonClient/);
  assert.match(html, /copyTextToClipboardClient/);
  assert.match(html, /reserveClientIdempotencyKey/);
  assert.match(html, /실행 이력 없음/);
  assert.match(html, /data-chain-scope="chain:/);
  assert.match(html, /최근 전달 없음/);
  assert.match(html, /focus=guard/);
  assert.match(html, /npm run ui:build/);
  assert.match(html, /master-planner\/index\.html/);
  assert.match(html, /MPO v1\.0/);
  assert.match(html, /completed_with_replan/);
  assert.match(html, /AUTO-REPLAN/);
  assert.match(html, /mpo\.plan\.replanned/);
  assert.match(html, /replan of/);
});
