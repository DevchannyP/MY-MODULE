'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[mindmap control center smoke] integrated control center is generated with plan board and module workbench', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const artifactPath = path.join(repoRoot, 'artifacts', 'mindmap', 'index.html');

  const { stderr } = await execFileAsync('node', ['scripts/generate-mindmap.js'], {
    cwd: repoRoot,
  });

  assert.equal(stderr, '');

  const html = fs.readFileSync(artifactPath, 'utf8');
  assert.match(html, /통합 통제 센터/);
  assert.match(html, /현재 목표/);
  assert.match(html, /현재 단계/);
  assert.match(html, /다음 작업/);
  assert.match(html, /통제 흐름/);
  assert.match(html, /입력 이해/);
  assert.match(html, /계획 수립/);
  assert.match(html, /실행/);
  assert.match(html, /검증/);
  assert.match(html, /완료/);
  assert.match(html, /모듈 생성/);
  assert.match(html, /실행 계획표/);
  assert.match(html, /담당 에이전트/);
  assert.match(html, /dry-run preview/);
  assert.match(html, /confirm 후 create/);
  assert.match(html, /현재 상태/);
  assert.match(html, /다음 행동/);
  assert.match(html, /재시도/);
  assert.match(html, /같은 리소스에서 다른 작업이 이미 진행 중입니다/);
  assert.match(html, /scaffold-preview/);
  assert.match(html, /scaffold-create/);

  // Planning Studio UX — 자동 전송 상태 카드 (CP-11, CP-12)
  assert.match(html, /자동 전송/);
  assert.match(html, /master-auto-send/);
  assert.match(html, /topbar-auto-send-badge/);
  assert.match(html, /tb-auto-off/);
  assert.match(html, /Planning Studio/);
  assert.match(html, /실행 제어/);
  assert.match(html, /선택 터미널/);
  assert.match(html, /프롬프트 전송/);
  assert.match(html, /추천 프롬프트/);
  assert.match(html, /다음 단계 엔터/);
  assert.match(html, /즉시 제어 worker/);
  assert.match(html, /execution-worker-select/);
  assert.match(html, /현재 worker 즉시 전송/);
  assert.match(html, /전체 worker 즉시 엔터/);
  assert.match(html, /이전 내용 다시 실행/);
  assert.match(html, /자동 전송 시작/);
  assert.match(html, /활성 worker/);
  assert.match(html, /선택 worker/);
  assert.match(html, /worker 배치/);
  assert.match(html, /worker 상태 요약/);
  assert.match(html, /worker 최근 배지/);
  assert.match(html, /execution-worker-card/);
  assert.match(html, /execution-worker-pill/);
  assert.match(html, /focusExecutionWorker/);
  assert.match(html, /sendExecutionWorkerNow/);
  assert.match(html, /retryExecutionWorker/);
  assert.match(html, /stopAutoSendFromWorkerCard/);
  assert.match(html, /이 worker 즉시 전송/);
  assert.match(html, /이 worker 재시도/);
  assert.match(html, /이 worker에서 자동 전송 중지/);
  assert.match(html, /실패 위치/);
  assert.match(html, /\/ui\/control-center-runtime/);
  assert.match(html, /\/api\/pty\/send-now/);
  assert.match(html, /\/api\/pty\/enter-now/);
  assert.match(html, /프롬프트 전송 비활성화/);
  assert.match(html, /자동 전송 비활성화/);
  assert.match(html, /즉시 전송 비활성화/);
  assert.match(html, /즉시 엔터 비활성화/);
});
