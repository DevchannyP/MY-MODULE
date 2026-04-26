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
  assert.match(html, /계획 화면/);
  assert.match(html, /기능 목록/);
  assert.match(html, /학습 자료/);
  assert.match(html, /간단 실행 마스터 패널/);
  assert.match(html, /master-quick-grid/);
  assert.match(html, /side-item-action/);
  assert.match(html, /hero-master-panel/);
  assert.match(html, /hero-master-command/);
  assert.match(html, /runHomeMasterPanelAction/);
  assert.match(html, /openHomeMasterPanel\('drift'/);
  assert.match(html, /window\.__HOME_MASTER_PANEL_BLUEPRINTS__/);
  assert.match(html, /지금 해야 할 일 안내 바/);
  assert.match(html, /흐름 유지/);
  assert.match(html, /문제 해결 순서/);
  assert.match(html, /배포 판단 증거/);
  assert.match(html, /최근 실행 출처/);
  assert.match(html, /flow-source-summary/);
  assert.match(html, /아직 기록 없음/);
  assert.match(html, /지금 실행할 카드/);
  assert.match(html, /flow-chain-spotlight-title/);
  assert.match(html, /Session Bootstrap/);
  assert.match(html, /제어 센터에서 자세히 보기/);
  assert.match(html, /카드를 클릭하면 상세 설명과 수정 맵이 아래에 열립니다\./);
  assert.match(html, /flow-chain-spotlight-copy/);
  assert.match(html, /flow-chain-spotlight-fill/);
  assert.match(html, /명령 복사/);
  assert.match(html, /실행 화면에 넣기/);
  assert.match(html, /source=home-spotlight/);
  assert.match(html, /바로 열기/);
  assert.match(html, /flow-chain-item is-active/);
  assert.match(html, /클릭해서 수정 맵 보기/);
  assert.match(html, /flow-chain-delivery-/);
  assert.match(html, /flow-chain-delivery-meta-/);
  assert.match(html, /flow-chain-delivery-pill/);
  assert.match(html, /flow-chain-map-panel/);
  assert.match(html, /이 단계 설명과 해결 순서/);
  assert.match(html, /바로 보면 좋은 기준/);
  assert.match(html, /window\.__HOME_INITIAL_OPERATOR_CHAIN__/);
  assert.match(html, /window\.__HOME_OPERATOR_CHAIN_BLUEPRINTS__/);
  assert.match(html, /bindHomeOperatorChainInteractions/);
  assert.match(html, /homeOperatorChainMapHtml/);
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
  assert.match(html, /home-handoff-lane/);
  assert.match(html, /다음 작업 준비 상태/);
  assert.match(html, /handoff-current-wp/);
  assert.match(html, /handoff-next-wp/);
  assert.match(html, /handoff-drift-status/);
  assert.match(html, /handoff-validation-state/);
  assert.match(html, /handoff-evidence-state/);
  assert.match(html, /handoff-next-command/);
  assert.match(html, /focus=guard/);
  assert.match(html, /npm run ui:build/);
  assert.match(html, /master-planner\/index\.html/);
  assert.match(html, /MPO v1\.0/);
  assert.match(html, /completed_with_replan/);
  assert.match(html, /AUTO-REPLAN/);
  assert.match(html, /mpo\.plan\.replanned/);
  assert.match(html, /replan of/);
});
