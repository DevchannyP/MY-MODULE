'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const execFileAsync = promisify(execFile);

test('[master planner] bundles per-screen UI guides for operators and planners', async () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const artifactPath = path.join(repoRoot, 'artifacts', 'master-planner', 'index.html');

  const { stderr } = await execFileAsync('python3', ['scripts/generate-master-planner.py', '--silent'], {
    cwd: repoRoot,
  });

  assert.equal(stderr, '');

  const html = fs.readFileSync(artifactPath, 'utf8');
  assert.match(html, /"ui_guides"/);
  assert.match(html, /"adapter_catalog"/);
  assert.match(html, /"adapter_scorecards"/);
  assert.match(html, /"project_blueprints"/);
  assert.match(html, /"project_intake_canvas"/);
  assert.match(html, /"adapter_compatibility"/);
  assert.match(html, /"ai_learning_tracks"/);
  assert.match(html, /"learning_mastery_map"/);
  assert.match(html, /"ai_runtime_recipes"/);
  assert.match(html, /"master_os_relations"/);
  assert.match(html, /화면 설명서/);
  assert.match(html, /어댑터 레지스트리/);
  assert.match(html, /어댑터 Scorecard/);
  assert.match(html, /프로젝트 시작 블루프린트/);
  assert.match(html, /프로젝트 시작 질문지/);
  assert.match(html, /추천 조합/);
  assert.match(html, /AI 학습 플로우/);
  assert.match(html, /어댑터 호환성 매트릭스/);
  assert.match(html, /학습 숙련도 로드맵/);
  assert.match(html, /AI Runtime Recipes/);
  assert.match(html, /마스터 OS 관계 맵/);
  assert.match(html, /핵심 KPI, 미결 인보이스, 예외 현황/);
  assert.match(html, /비동기 트랜스코딩 작업의 진행률과 실패 원인/);
  assert.match(html, /마스터 OS AI 스튜디오/);
  assert.match(html, /마스터 OS 기초/);
  assert.match(html, /Workflow OS 기본 구조 이해/);
  assert.match(html, /Planner-First Hybrid/);
});
