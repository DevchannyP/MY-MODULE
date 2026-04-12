#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { buildReport } = require('./project_status');
const { readYaml, readYamlMany } = require('./run_stage');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'artifacts', 'mindmap');
const OUT_FILE = path.join(OUT_DIR, 'index.html');

// ─── Position helpers ────────────────────────────────────────────────────────

function domainPosition(angle, radius) {
  const rad = angle * (Math.PI / 180);
  return {
    x: 800 + radius * Math.cos(rad),
    y: 500 + radius * Math.sin(rad),
  };
}

function stagePositions(domainX, domainY, awayAngleDeg) {
  const awayRad = awayAngleDeg * (Math.PI / 180);
  const radius = 130;
  const spreads = [-60, -30, 0, 30, 60];
  return spreads.map((offsetDeg) => {
    const rad = awayRad + offsetDeg * (Math.PI / 180);
    return {
      x: domainX + radius * Math.cos(rad),
      y: domainY + radius * Math.sin(rad),
    };
  });
}

function flagPositions(dx, dy, awayAngleDeg, count) {
  const awayRad = awayAngleDeg * (Math.PI / 180);
  const perpAngle = awayRad + Math.PI / 2;
  const halfSpread = (count - 1) * 30 * (Math.PI / 180) / 2;
  return Array.from({ length: count }, (_, i) => {
    const angle = perpAngle - halfSpread + i * 30 * (Math.PI / 180);
    return {
      x: dx + 170 * Math.cos(angle),
      y: dy + 170 * Math.sin(angle),
    };
  });
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function stageProgress(stageValue) {
  const stage = String(stageValue || '').toUpperCase();
  if (stage === 'A') return 20;
  if (stage === 'B') return 35;
  if (stage === 'C') return 55;
  if (stage === 'D') return 80;
  if (stage === 'E') return 100;
  return 10;
}

function laneStatusByStage(stageValue, laneId) {
  const stage = String(stageValue || '').toUpperCase();
  const order = ['A', 'B', 'C', 'D', 'E'];
  const currentIndex = Math.max(order.indexOf(stage), 0);
  const laneThresholds = {
    'control-intake': 0,
    'control-planning': 1,
    'control-execution': 2,
    'control-validation': 3,
    'control-complete': 4,
    'control-module': 1,
  };
  const threshold = laneThresholds[laneId];
  if (laneId === 'control-module') {
    return currentIndex >= 1 ? 'ready' : 'pending';
  }
  if (currentIndex > threshold) return 'completed';
  if (currentIndex === threshold) return 'in_progress';
  return 'pending';
}

function buildKanbanLanes(planRows, controlNodes, currentLaneId) {
  const nodeById = new Map((Array.isArray(controlNodes) ? controlNodes : []).map((node) => [node.id, node]));
  const laneOrder = [
    'control-intake',
    'control-planning',
    'control-execution',
    'control-validation',
    'control-complete',
    'control-module',
  ];

  return laneOrder.map((laneId) => {
    const node = nodeById.get(laneId) || {};
    const cards = (Array.isArray(planRows) ? planRows : [])
      .filter((row) => String(row.nodeId || '') === laneId)
      .map((row) => ({
        id: String(row.id || laneId),
        title: String(row.task || node.label || laneId),
        purpose: String(row.purpose || ''),
        input: String(row.input || ''),
        output: String(row.output || ''),
        next_action: String(row.nextAction || ''),
        owner: String(row.owner || node.owner || ''),
        priority: String(row.priority || ''),
        status: String(row.status || node.status || 'pending'),
      }));

    return {
      id: laneId,
      label: String(node.label || laneId),
      owner: String(node.owner || ''),
      status: String((cards[0] && cards[0].status) || node.status || 'pending'),
      purpose: String(node.purpose || ''),
      is_current: laneId === currentLaneId,
      cards,
    };
  });
}

function buildControlCenterMeta(report, bundle) {
  const currentWp = bundle['memory/current-wp.yaml'] || {};
  const nextActions = bundle['memory/next-actions.yaml'] || {};
  const plannerDraft = bundle['memory/project/master-planner-draft.yaml'] || {};
  const blueprintsYaml = bundle['master-shell/catalog/project-blueprints.yaml'] || {};
  const recipesYaml = bundle['master-shell/catalog/ai-runtime-recipes.yaml'] || {};
  const matrixYaml = bundle['master-shell/catalog/adapter-compatibility-matrix.yaml'] || {};

  const currentGoal = String(report?.current_wp_goal || currentWp.goal || '통합 통제 허브 정리').trim();
  const currentStage = String(report?.current_wp_stage || currentWp.stage || 'B').trim().toUpperCase() || 'B';
  const nextTask = String(report?.next_wp || nextActions.next_wp || 'NONE').trim() || 'NONE';
  const issues = Array.isArray(report?.known_issues) ? report.known_issues : [];
  const blockerLabel = report?.promotion_pipeline?.drift_status === 'clean'
    ? (issues.length > 0 ? `확인 필요 ${issues.length}건` : '정상')
    : `드리프트 ${String(report?.promotion_pipeline?.drift_status || 'unknown')}`;

  const controlNodes = [
    {
      id: 'control-intake',
      label: '입력 이해',
      owner: 'Planner',
      purpose: '사용자 요청, 제약, 누락 정보를 한 묶음으로 정리한다.',
      inputs: ['사용자 요청', '현재 Work Packet', 'next-actions'],
      outputs: ['정리된 목표', '제약 목록', '누락 정보'],
      issues: issues.length ? issues.map((item) => `${item.id}: ${item.severity}`) : ['현재 알려진 차단 이슈 없음'],
      nextAction: '계획 수립으로 연결',
      status: laneStatusByStage(currentStage, 'control-intake'),
      kind: 'control',
    },
    {
      id: 'control-planning',
      label: '계획 수립',
      owner: 'Planner',
      purpose: '작업을 분해하고 우선순위와 성공조건을 확정한다.',
      inputs: ['current-wp', 'planner draft', 'promotion pipeline'],
      outputs: ['실행 계획', '우선순위', '성공조건'],
      issues: [report?.promotion_pipeline?.drift_status === 'clean' ? 'promotion drift 없음' : `promotion drift: ${report?.promotion_pipeline?.drift_status || 'unknown'}`],
      nextAction: '실행 카드와 계획표 동기화',
      status: laneStatusByStage(currentStage, 'control-planning'),
      kind: 'control',
    },
    {
      id: 'control-execution',
      label: '실행',
      owner: 'Builder',
      purpose: '자료 수집, 분석, 생성/수정, CLI 실행을 통제한다.',
      inputs: ['현재 packet 목표', 'CLI 허브', 'system API'],
      outputs: ['산출물', '실행 로그', '적용 결과'],
      issues: ['기존 홈의 CLI 허브와 runtime bridge를 그대로 사용'],
      nextAction: '검증 단계로 넘길 evidence 준비',
      status: laneStatusByStage(currentStage, 'control-execution'),
      kind: 'control',
    },
    {
      id: 'control-validation',
      label: '검증',
      owner: 'Reviewer',
      purpose: '드리프트, 품질 게이트, smoke 결과를 한 표로 확인한다.',
      inputs: ['quality gate', 'drift control', 'recent runtime'],
      outputs: ['PASS/FAIL 판정', '수정 필요 항목'],
      issues: ['기존 smoke를 유지하면서 통제 센터 전용 smoke를 추가'],
      nextAction: '완료 조건 충족 여부 판정',
      status: laneStatusByStage(currentStage, 'control-validation'),
      kind: 'control',
    },
    {
      id: 'control-complete',
      label: '완료',
      owner: 'Reporter',
      purpose: '지금까지의 결과와 다음 액션을 사용자 기준으로 마감한다.',
      inputs: ['검증 결과', '완료 artifact', '다음 packet'],
      outputs: ['완료 보고', '다음 작업', '결과 요약'],
      issues: ['사용자에게는 지금/결과/다음만 강하게 노출'],
      nextAction: '홈 또는 다음 packet으로 이동',
      status: laneStatusByStage(currentStage, 'control-complete'),
      kind: 'control',
    },
    {
      id: 'control-module',
      label: '모듈 생성',
      owner: 'Builder',
      purpose: '새 모듈 추가를 GUI에서 preview -> dry-run -> confirm -> create로 통제한다.',
      inputs: ['project blueprints', 'runtime recipes', 'generate-domain-scaffold.js'],
      outputs: ['requirements preview', '신규 requirements 파일', '다음 단계 안내'],
      issues: ['실제 생성 전 preview를 먼저 강제'],
      nextAction: 'blueprint와 recipe를 고른 뒤 dry-run preview 실행',
      status: laneStatusByStage(currentStage, 'control-module'),
      kind: 'module',
    },
  ];

  const planRows = [
    {
      id: 'plan-intake',
      nodeId: 'control-intake',
      step: '1',
      task: '입력 이해',
      purpose: '현재 목표와 제약을 빠르게 고정',
      input: '사용자 요청 / current-wp / next-actions',
      output: currentGoal || '정리된 목표',
      status: laneStatusByStage(currentStage, 'control-intake'),
      priority: '최고',
      owner: 'Planner',
      nextAction: '계획 수립',
    },
    {
      id: 'plan-planning',
      nodeId: 'control-planning',
      step: '2',
      task: '계획 수립',
      purpose: '작업 분해와 성공조건 고정',
      input: 'planner draft / promotion pipeline',
      output: `현재 단계 ${currentStage} / 다음 ${nextTask}`,
      status: laneStatusByStage(currentStage, 'control-planning'),
      priority: '최고',
      owner: 'Planner',
      nextAction: '실행 패널 동기화',
    },
    {
      id: 'plan-execution',
      nodeId: 'control-execution',
      step: '3',
      task: '실행',
      purpose: '자료 수집, 생성/수정, CLI 실행',
      input: 'system API / CLI hub / packet focus',
      output: String(report?.current_wp || currentWp.id || 'NONE'),
      status: laneStatusByStage(currentStage, 'control-execution'),
      priority: '최고',
      owner: 'Builder',
      nextAction: '검증 evidence 적재',
    },
    {
      id: 'plan-validation',
      nodeId: 'control-validation',
      step: '4',
      task: '검증',
      purpose: 'drift, gate, smoke 상태 확인',
      input: 'quality / runtime / changed files',
      output: `drift ${String(report?.promotion_pipeline?.drift_status || 'unknown')}`,
      status: laneStatusByStage(currentStage, 'control-validation'),
      priority: '최고',
      owner: 'Reviewer',
      nextAction: '완료 판정',
    },
    {
      id: 'plan-complete',
      nodeId: 'control-complete',
      step: '5',
      task: '완료',
      purpose: '결과와 다음 작업을 사용자 기준으로 정리',
      input: '검증 결과 / completed work',
      output: `다음 packet ${nextTask}`,
      status: laneStatusByStage(currentStage, 'control-complete'),
      priority: '높음',
      owner: 'Reporter',
      nextAction: '홈 또는 다음 작업 이동',
    },
    {
      id: 'plan-module',
      nodeId: 'control-module',
      step: '6',
      task: '모듈 생성',
      purpose: '새 모듈 추가를 안전하게 preview',
      input: 'blueprint / recipe / domain id',
      output: `blueprints ${(Array.isArray(blueprintsYaml.blueprints) ? blueprintsYaml.blueprints.length : 0)}개`,
      status: laneStatusByStage(currentStage, 'control-module'),
      priority: '최고',
      owner: 'Builder',
      nextAction: 'dry-run preview 실행',
    },
  ];
  const activeLane = controlNodes.find((item) => item.status === 'in_progress');
  const currentLaneId = activeLane ? activeLane.id : 'control-planning';

  return {
    statusBar: {
      goal: currentGoal,
      currentStage,
      progress: stageProgress(currentStage),
      blocker: blockerLabel,
      nextTask,
      autoSendEnabled: false,
      currentLaneId,
      summary: `현재 packet ${String(report?.current_wp || currentWp.id || 'NONE')} 기준 통제 상태`,
    },
    controlNodes,
    planRows,
    kanbanLanes: buildKanbanLanes(planRows, controlNodes, currentLaneId),
    roadmapSections: Array.isArray(plannerDraft.sections) ? plannerDraft.sections : [],
    scaffoldCatalog: {
      blueprints: (Array.isArray(blueprintsYaml.blueprints) ? blueprintsYaml.blueprints : []).map((item) => ({
        id: item.id,
        name: item.name,
        summary: item.summary,
        architecture_profile: item.architecture_profile,
        starter_sequence: Array.isArray(item.starter_sequence) ? item.starter_sequence : [],
      })),
      recipes: (Array.isArray(recipesYaml.recipes) ? recipesYaml.recipes : []).map((item) => ({
        id: item.id,
        name: item.name,
        objective: item.objective,
        architecture_profile: item.architecture_profile,
        blueprint_refs: Array.isArray(item.blueprint_refs) ? item.blueprint_refs : [],
      })),
      profiles: (Array.isArray(matrixYaml.profiles) ? matrixYaml.profiles : []).map((item) => ({
        id: item.profile_id,
        notes: Array.isArray(item.notes) ? item.notes : [],
        recommended_recipes: Array.isArray(item.recommended_recipes) ? item.recommended_recipes : [],
      })),
      defaultBlueprint: 'domain-module-extension',
      defaultRecipe: 'contract-first-module-builder',
    },
  };
}

// ─── Build graph data ────────────────────────────────────────────────────────

function buildGraphData(bundle) {
  const report = buildReport();
  const controlCenter = buildControlCenterMeta(report, bundle);
  const flagsYaml = bundle['master-shell/feature-flags/flags.yaml'] || {};
  const domainsYaml = bundle['master-shell/catalog/domains.yaml'] || {};
  const healthYaml = bundle['master-shell/observability/health-scores.yaml'] || {};

  const pluginFlags = flagsYaml.plugin_flags || {};
  const healthDomains = healthYaml.domains || {};

  // Resolve health score by domain id
  // "productivity/task-tracking" → productivity
  function healthFor(domainId) {
    if (healthDomains[domainId]) return healthDomains[domainId];
    const found = Object.entries(healthDomains).find(([k]) => {
      const slug = k.split('/')[0];
      return slug === domainId;
    });
    return found ? found[1] : { score: 95, trend: '→', ejectable: false };
  }

  // Domain layout: angle in degrees (standard math coords: 0=right, 270=top)
  // system=top(270°), billing=right(0°), productivity=bottom(90°), video=left(180°)
  const domainLayout = [
    { id: 'system',       angle: 270, label: '시스템 운영' },
    { id: 'billing',      angle: 0,   label: '정산관리'   },
    { id: 'productivity', angle: 90,  label: '생산성 관리' },
    { id: 'video',        angle: 180, label: '콘텐츠 관리' },
  ];

  // Catalog domain lookup
  const catalogDomains = Array.isArray(domainsYaml.domains) ? domainsYaml.domains : [];
  const catalogById = new Map(catalogDomains.map((d) => [d.id, d]));

  // Flag grouping: prefix → domain id
  function flagDomainId(flagKey) {
    if (flagKey.startsWith('billing')) return 'billing';
    if (flagKey.startsWith('video')) return 'video';
    if (flagKey.startsWith('system_api')) return 'system';
    // enable_task_management, enable_bulk_assign → productivity
    return 'productivity';
  }

  // Group flags by domain
  const flagsByDomain = {};
  for (const [key, value] of Object.entries(pluginFlags)) {
    const domId = flagDomainId(key);
    if (!flagsByDomain[domId]) flagsByDomain[domId] = [];
    flagsByDomain[domId].push({ key, value });
  }

  const nodes = [];
  const edges = [];

  // Root node (fixed)
  nodes.push({ id: 'root', type: 'root', label: 'Workflow OS', x: 800, y: 500, fixed: true });

  for (const { id, angle, label } of domainLayout) {
    const pos = domainPosition(angle, 180);
    const health = healthFor(id);
    const catalog = catalogById.get(id) || {};

    // Domain node
    const flagActive = (() => {
      if (id === 'system') return pluginFlags['system_api.enabled'] !== false;
      if (id === 'billing') return pluginFlags['billing.enabled'] !== false;
      if (id === 'video') return pluginFlags['video.enabled'] !== false;
      return pluginFlags['enable_task_management'] !== false;
    })();

    nodes.push({
      id,
      type: 'domain',
      label,
      x: pos.x,
      y: pos.y,
      healthScore: health.score,
      trend: health.trend,
      ejectable: health.ejectable,
      stageStatus: 'E/PASS',
      description: catalog.description || '',
      flagActive,
    });

    // Edge: root → domain
    edges.push({ id: 'root-' + id, source: 'root', target: id, type: 'dependency' });

    // Stage nodes
    const stagePoses = stagePositions(pos.x, pos.y, angle);
    ['A', 'B', 'C', 'D', 'E'].forEach((stage, idx) => {
      const stageId = id + '-' + stage;
      const sp = stagePoses[idx];
      nodes.push({
        id: stageId,
        type: 'stage',
        label: stage,
        status: 'PASS',
        parentId: id,
        x: sp.x,
        y: sp.y,
      });
      edges.push({ id: id + '-stage-' + stage, source: id, target: stageId, type: 'lifecycle' });
    });

    // Flag nodes
    const domainFlags = flagsByDomain[id] || [];
    if (domainFlags.length > 0) {
      const fpos = flagPositions(pos.x, pos.y, angle, domainFlags.length);
      domainFlags.forEach((f, idx) => {
        const flagNodeId = 'flag-' + f.key;
        const fp = fpos[idx];
        nodes.push({
          id: flagNodeId,
          type: 'flag',
          label: f.key,
          value: f.value === true || f.value === 'true',
          parentId: id,
          group: id,
          x: fp.x,
          y: fp.y,
        });
        edges.push({
          id: id + '-flag-' + f.key,
          source: id,
          target: flagNodeId,
          type: 'flag',
        });
      });
    }
  }

  // Contract nodes near system domain
  nodes.push({
    id: 'contract-system-api',
    type: 'contract',
    label: 'System API',
    path: 'contracts/system-api/openapi.yaml',
    x: 650,
    y: 220,
  });
  nodes.push({
    id: 'contract-ui-shell',
    type: 'contract',
    label: 'UI Shell',
    path: 'contracts/ui-shell/ui-contract.yaml',
    x: 950,
    y: 220,
  });
  edges.push({ id: 'system-contract-api', source: 'system', target: 'contract-system-api', type: 'contract' });
  edges.push({ id: 'system-contract-ui',  source: 'system', target: 'contract-ui-shell',   type: 'contract' });

  controlCenter.controlNodes.forEach((node) => {
    nodes.push({
      id: node.id,
      type: 'control',
      label: node.label,
      hiddenInGraph: true,
      status: node.status,
      owner: node.owner,
      purpose: node.purpose,
      inputs: uniqueStrings(node.inputs),
      outputs: uniqueStrings(node.outputs),
      issues: uniqueStrings(node.issues),
      nextAction: String(node.nextAction || ''),
      controlKind: node.kind,
    });
  });

  // Meta
  const meta = {
    generatedAt: new Date().toISOString(),
    flagStates: {
      'system_api.enabled':           pluginFlags['system_api.enabled']           !== undefined ? pluginFlags['system_api.enabled']           : true,
      'system_api.sse_stream.enabled': pluginFlags['system_api.sse_stream.enabled'] !== undefined ? pluginFlags['system_api.sse_stream.enabled'] : true,
      'system_api.flag_toggle_ui.enabled': pluginFlags['system_api.flag_toggle_ui.enabled'] !== undefined ? pluginFlags['system_api.flag_toggle_ui.enabled'] : false,
      'system_api.rollback_ui.enabled':    pluginFlags['system_api.rollback_ui.enabled']    !== undefined ? pluginFlags['system_api.rollback_ui.enabled']    : false,
    },
    apiBase: '/api/v1',
    sseUrl: '/api/v1/system/events',
    planningApiBase: '/api/planning-studio',
    report,
    controlCenter,
  };

  return { nodes, edges, meta };
}

// ─── Build HTML ───────────────────────────────────────────────────────────────

function escHtmlStatic(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderStageRunHistoryStatic(history) {
  if (!Array.isArray(history) || history.length === 0) return '';
  return history.slice(0, 5).map(function(item, index) {
    const status = String(item.status || 'ready');
    const tone = status === 'fail' ? 'error' : status === 'blocked' ? 'warn' : 'info';
    const stage = escHtmlStatic(item.requested_stage || 'D');
    const module = escHtmlStatic(item.requested_module || '전체');
    const recordedAt = escHtmlStatic(item.recorded_at || '');
    return '<div id="execution-history-item-' + index + '" class="execution-history-item is-' + tone + '">' +
      '<div class="execution-failure-badges">' +
        '<span class="execution-history-pill is-' + tone + '">' + escHtmlStatic(status) + '</span>' +
      '</div>' +
      '<strong>Stage ' + stage + ' / ' + module + '</strong>' +
      '<div class="execution-history-meta">' + recordedAt + '</div>' +
    '</div>';
  }).join('');
}

function buildHtml(graphData) {
  const graphJson = JSON.stringify(graphData)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  const css = `
:root {
  --bg: #f7f3ea;
  --surface: #fffdf8;
  --surface-strong: #fff7ea;
  --line: #dccfba;
  --text: #1f2a37;
  --muted: #61707f;
  --accent: #0f766e;
  --accent-2: #c2410c;
  --accent-3: #1d4ed8;
  --green: #0f766e;
  --amber: #b45309;
  --slate: #475569;
  --shadow: 0 18px 40px rgba(70, 52, 28, 0.08);
  --radius-xl: 28px;
  --radius-lg: 20px;
  --radius-md: 14px;
  --font-ui: "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  --font-mono: "JetBrains Mono", "D2Coding", "SFMono-Regular", monospace;
  --node-root: #1d4ed8;
  --node-domain: #0f766e;
  --node-stage-pass: #0f766e;
  --node-stage-fail: #dc2626;
  --node-stage-idle: #9ca3af;
  --node-contract: #475569;
  --node-flag-on: #b45309;
  --node-flag-off: #9ca3af;
  --edge-dependency: #dccfba;
  --edge-lifecycle: #bfdbfe;
  --edge-contract: #0f766e;
  --edge-flag: #fcd34d;
  --health-green: #0f766e;
  --health-amber: #b45309;
  --health-red: #dc2626;
  --topbar-h: 56px;
  --masterbar-h: 74px;
  --sidebar-w: 248px;
  --detail-w: 360px;
  --plan-board-h: 390px;
  --panel-width: 340px;
  --status-bar-h: 40px;
  --canvas-bg: #f0ebe0;
  --panel-bg: rgba(255, 253, 248, 0.97);
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
body { font-family: var(--font-ui); color: var(--text); background: var(--bg); display: flex; flex-direction: column; position: relative; }

#topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: rgba(255, 253, 248, 0.9);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(8px);
  height: var(--topbar-h);
  z-index: 30;
  flex-shrink: 0;
}

.brand { display: flex; align-items: center; gap: 10px; }
.brand-mark {
  width: 36px; height: 36px; border-radius: 10px;
  display: grid; place-items: center;
  background: linear-gradient(135deg, #0f766e, #1d4ed8);
  color: white; font-weight: 800; font-size: 13px;
}
.brand-copy strong { display: block; font-size: 14px; letter-spacing: -0.02em; }
.brand-copy span { color: var(--muted); font-size: 11px; }

.topbar-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.tb-btn {
  padding: 6px 12px;
  background: var(--surface-strong);
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.tb-btn:hover { background: var(--line); }
.tb-btn-studio {
  background: rgba(15,118,110,0.10);
  border-color: rgba(15,118,110,0.35);
  color: var(--green);
  font-weight: 600;
}
.tb-btn-studio:hover { background: rgba(15,118,110,0.18); }
.tb-auto-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  border: 1.5px solid;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.tb-status-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  border: 1.5px solid;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.tb-auto-on {
  background: rgba(15,118,110,0.12);
  border-color: rgba(15,118,110,0.45);
  color: var(--green);
}
.tb-auto-off {
  background: rgba(148,163,184,0.12);
  border-color: rgba(148,163,184,0.45);
  color: var(--slate);
}
.tb-ready {
  background: rgba(15,118,110,0.12);
  border-color: rgba(15,118,110,0.45);
  color: var(--green);
}
.tb-warn {
  background: rgba(245,158,11,0.16);
  border-color: rgba(180,83,9,0.36);
  color: var(--amber);
}
.tb-blocked {
  background: rgba(220,38,38,0.12);
  border-color: rgba(220,38,38,0.34);
  color: var(--accent-2);
}
.tb-info {
  background: rgba(29,78,216,0.12);
  border-color: rgba(29,78,216,0.34);
  color: var(--accent-3);
}

#master-status {
  height: var(--masterbar-h);
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(255,253,248,0.96), rgba(255,247,234,0.92));
  display: grid;
  grid-template-columns: repeat(9, minmax(0, 1fr));
  gap: 10px;
  padding: 12px 16px;
  z-index: 25;
  flex-shrink: 0;
}
.master-card {
  border: 1px solid rgba(220, 207, 186, 0.88);
  border-radius: 16px;
  background: rgba(255,255,255,0.72);
  padding: 10px 12px;
  min-width: 0;
}
.master-card-auto {
  border-color: rgba(148,163,184,0.5);
  background: rgba(248,250,252,0.85);
}
.master-card span {
  display: block;
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 4px;
}
.master-card strong {
  display: block;
  font-size: 14px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.master-card strong.status-attention { color: var(--amber); }
.master-card strong.status-ok { color: var(--green); }
.master-card strong.status-blocked { color: var(--accent-2); }
.master-auto-on { color: var(--green); font-weight: 700; }
.master-auto-off { color: var(--slate); }

.sidebar-console {
  border-radius: 18px;
  border: 1px solid rgba(220, 207, 186, 0.9);
  background: linear-gradient(180deg, #fffefb, #fff8ef);
  padding: 12px;
  display: grid;
  gap: 10px;
}
.execution-summary {
  border-radius: 14px;
  border: 1px solid rgba(220, 207, 186, 0.9);
  background: rgba(255,255,255,0.82);
  padding: 10px;
  display: grid;
  gap: 6px;
}
.execution-summary.is-success {
  background: #f3fbf7;
  border-color: rgba(15,118,110,0.26);
}
.execution-summary.is-warning {
  background: #fff8ef;
  border-color: rgba(180,83,9,0.28);
}
.execution-summary.is-error {
  background: #fff4f3;
  border-color: rgba(220,38,38,0.22);
}
.execution-summary strong {
  font-size: 13px;
}
.execution-summary p {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.6;
}
.execution-grid {
  display: grid;
  gap: 8px;
}
.execution-row {
  display: grid;
  gap: 4px;
}
.execution-row span {
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.execution-row strong {
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-line;
  word-break: break-word;
}
.execution-select,
.execution-textarea {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(220, 207, 186, 0.92);
  background: #fffdf8;
  padding: 10px 12px;
  font: inherit;
  color: var(--text);
}
.execution-textarea {
  min-height: 116px;
  resize: vertical;
  line-height: 1.6;
}
.execution-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.execution-worker-cards {
  display: grid;
  gap: 8px;
}
.execution-worker-card {
  border-radius: 12px;
  border: 1px solid rgba(220, 207, 186, 0.92);
  background: rgba(255,255,255,0.82);
  padding: 10px;
  display: grid;
  gap: 6px;
}
.execution-worker-card.is-selected {
  border-color: rgba(29,78,216,0.36);
  background: #f4f8ff;
}
.execution-worker-card.is-error {
  border-color: rgba(220,38,38,0.28);
  background: #fff3f2;
}
.execution-worker-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.execution-worker-card-title {
  font-size: 12px;
  font-weight: 700;
}
.execution-worker-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: #fff8ef;
  color: #9a3412;
}
.execution-worker-pill.is-selected {
  background: #dbeafe;
  color: #1d4ed8;
}
.execution-worker-pill.is-error {
  background: #fee2e2;
  color: #b91c1c;
}
.execution-worker-meta,
.execution-worker-detail {
  font-size: 11px;
  line-height: 1.55;
  color: var(--muted);
  word-break: break-word;
}
.execution-worker-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.execution-worker-action {
  border: none;
  border-radius: 10px;
  padding: 7px 10px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
}
.execution-worker-action.secondary {
  background: #fff;
  border: 1px solid var(--line);
  color: var(--text);
}
.execution-worker-action.primary {
  background: linear-gradient(135deg, #0f766e, #1d4ed8);
  color: white;
}
.execution-worker-action.warn {
  background: #c2410c;
  color: white;
}
.execution-worker-action:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.execution-button {
  border: none;
  border-radius: 12px;
  padding: 9px 12px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}
.execution-button.primary { background: linear-gradient(135deg, #0f766e, #1d4ed8); color: white; }
.execution-button.secondary { background: #fff; border: 1px solid var(--line); color: var(--text); }
.execution-button.warn { background: #c2410c; color: white; }
.execution-button.is-active {
  box-shadow: inset 0 0 0 2px rgba(15,118,110,0.18);
}
.execution-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.execution-note {
  border-radius: 12px;
  border: 1px dashed rgba(220, 207, 186, 0.92);
  background: rgba(255,255,255,0.74);
  padding: 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--muted);
}
.deep-link-highlight {
  box-shadow: 0 0 0 2px rgba(29,78,216,0.28), 0 16px 30px rgba(29,78,216,0.12);
  border-color: rgba(29,78,216,0.34) !important;
}
.deep-link-context-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(220, 207, 186, 0.88);
  background: linear-gradient(90deg, rgba(239,246,255,0.92), rgba(255,251,235,0.94));
  z-index: 24;
}
.deep-link-context-bar[hidden] {
  display: none;
}
.deep-link-context-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.deep-link-context-label {
  font-size: 11px;
  color: var(--muted);
}
.deep-link-context-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.deep-link-context-reason {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 420px;
}
.deep-link-context-command {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(148,163,184,0.32);
  background: rgba(255,255,255,0.88);
  color: var(--accent);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 360px;
}
.deep-link-context-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.execution-history-list {
  display: grid;
  gap: 8px;
}
.execution-history-anchor {
  border-radius: 12px;
  border: 1px dashed rgba(29,78,216,0.28);
  background: rgba(29,78,216,0.05);
  padding: 10px;
  display: grid;
  gap: 6px;
}
.execution-history-item {
  border-radius: 12px;
  border: 1px solid rgba(220, 207, 186, 0.88);
  background: rgba(255,255,255,0.82);
  padding: 10px;
  display: grid;
  gap: 6px;
}
.execution-history-item.is-pass {
  border-color: rgba(15,118,110,0.34);
  background: rgba(15,118,110,0.06);
}
.execution-history-item.is-fail {
  border-color: rgba(220,38,38,0.3);
  background: rgba(220,38,38,0.06);
}
.execution-history-item.is-blocked,
.execution-history-item.is-out-of-route {
  border-color: rgba(245,158,11,0.34);
  background: rgba(245,158,11,0.08);
}
.execution-history-item.is-highlighted {
  box-shadow: 0 0 0 2px rgba(29,78,216,0.22), 0 12px 24px rgba(29,78,216,0.10);
  transform: translateY(-1px);
}
.execution-history-meta {
  font-size: 11px;
  line-height: 1.55;
  color: var(--muted);
  white-space: pre-wrap;
}
.execution-operator-history {
  display: grid;
  gap: 8px;
}
.execution-operator-history-item {
  border-radius: 12px;
  border: 1px solid rgba(220, 207, 186, 0.88);
  background: rgba(255,255,255,0.82);
  padding: 10px;
  display: grid;
  gap: 6px;
}
.execution-operator-history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.execution-operator-history-head strong {
  font-size: 12px;
}
.execution-operator-history-meta {
  font-size: 11px;
  line-height: 1.55;
  color: var(--muted);
  white-space: pre-wrap;
}
.execution-operator-history-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.execution-operator-history-empty {
  font-size: 11px;
  line-height: 1.6;
  color: var(--muted);
}
.execution-history-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.execution-history-pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border: none;
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: rgba(148,163,184,0.12);
  color: var(--slate);
}
.execution-history-pill.is-action {
  cursor: pointer;
}
.execution-history-pill.is-pass {
  background: rgba(15,118,110,0.12);
  color: var(--green);
}
.execution-history-pill.is-fail {
  background: rgba(220,38,38,0.12);
  color: var(--accent-2);
}
.execution-history-pill.is-blocked,
.execution-history-pill.is-out-of-route {
  background: rgba(245,158,11,0.16);
  color: var(--amber);
}
.execution-history-pill.is-info {
  background: rgba(29,78,216,0.12);
  color: #1d4ed8;
}
.execution-history-pill.is-focus {
  background: rgba(15,118,110,0.12);
  color: var(--green);
}
.execution-failure-focus {
  border-radius: 14px;
  border: 1px solid rgba(220,38,38,0.22);
  background: rgba(220,38,38,0.06);
  padding: 12px;
  display: grid;
  gap: 8px;
}
.execution-failure-focus strong {
  display: block;
}
.execution-failure-focus .execution-history-meta {
  color: var(--text);
}
.execution-failure-badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.execution-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  border-radius: 999px;
  padding: 4px 9px;
  font-size: 10px;
  font-weight: 700;
  border: 1px solid rgba(148,163,184,0.42);
  background: rgba(148,163,184,0.12);
  color: var(--slate);
}
.execution-badge.is-live {
  border-color: rgba(15,118,110,0.4);
  background: rgba(15,118,110,0.1);
  color: var(--green);
}
.execution-badge.is-error {
  border-color: rgba(220,38,38,0.3);
  background: rgba(220,38,38,0.08);
  color: var(--accent-2);
}

#control-sidebar {
  position: fixed;
  left: 0;
  top: calc(var(--topbar-h) + var(--masterbar-h));
  bottom: calc(var(--status-bar-h) + var(--plan-board-h));
  width: var(--sidebar-w);
  padding: 16px 12px 18px 16px;
  border-right: 1px solid var(--line);
  background: rgba(255, 251, 245, 0.96);
  overflow-y: auto;
  z-index: 18;
}
.sidebar-section + .sidebar-section { margin-top: 18px; }
.sidebar-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 10px;
}
.sidebar-stack {
  display: grid;
  gap: 8px;
}
.control-entry {
  width: 100%;
  text-align: left;
  border-radius: 16px;
  border: 1px solid rgba(220, 207, 186, 0.88);
  background: linear-gradient(180deg, #fffefb, #fff8ef);
  padding: 12px;
  cursor: pointer;
}
.control-entry:hover,
.control-entry.active {
  border-color: rgba(15, 118, 110, 0.45);
  box-shadow: 0 10px 20px rgba(15, 118, 110, 0.10);
}
.control-entry strong {
  display: block;
  font-size: 13px;
}
.control-entry span {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}
.control-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 3px 7px;
  font-size: 10px;
  font-weight: 700;
  margin-bottom: 8px;
}
.control-pill.is-completed { background: rgba(15,118,110,0.12); color: var(--green); }
.control-pill.is-in_progress { background: rgba(29,78,216,0.12); color: var(--accent-3); }
.control-pill.is-pending { background: rgba(148,163,184,0.14); color: var(--slate); }
.control-pill.is-ready { background: rgba(245,158,11,0.16); color: var(--amber); }
.control-pill.is-blocked { background: rgba(220,38,38,0.14); color: var(--accent-2); }

#canvas-wrap {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: var(--canvas-bg);
  margin-left: var(--sidebar-w);
  margin-right: var(--detail-w);
  margin-bottom: calc(var(--plan-board-h) + var(--status-bar-h));
}
#mindmap-svg { width: 100%; height: 100%; cursor: grab; display: block; }
#mindmap-svg:active { cursor: grabbing; }

#detail-panel {
  position: fixed;
  right: 0;
  top: calc(var(--topbar-h) + var(--masterbar-h));
  bottom: calc(var(--status-bar-h) + var(--plan-board-h));
  width: var(--detail-w);
  background: var(--panel-bg);
  border-left: 1px solid var(--line);
  box-shadow: var(--shadow);
  transition: transform 0.25s ease;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  z-index: 20;
}
#detail-panel.panel-closed { transform: translateX(100%); }

#panel-header {
  position: relative;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.ph-type { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
.ph-title { font-size: 16px; font-weight: 700; margin-top: 2px; padding-right: 24px; }
.ph-close {
  position: absolute; right: 12px; top: 12px;
  background: none; border: none; cursor: pointer;
  font-size: 16px; color: var(--muted);
}
.ph-close:hover { color: var(--text); }

#panel-tabs { display: flex; border-bottom: 1px solid var(--line); flex-shrink: 0; }
.tab-btn {
  flex: 1; padding: 8px; border: none; background: none;
  cursor: pointer; font-size: 12px; color: var(--muted);
  font-family: var(--font-ui);
}
.tab-btn:hover { color: var(--text); background: var(--surface-strong); }
.tab-btn.tab-active { color: var(--accent); border-bottom: 2px solid var(--accent); font-weight: 700; }

#panel-body { flex: 1; overflow-y: auto; padding: 16px; }

#plan-board {
  position: fixed;
  left: 0;
  right: 0;
  bottom: var(--status-bar-h);
  height: var(--plan-board-h);
  border-top: 1px solid var(--line);
  background: rgba(255, 253, 248, 0.97);
  padding: 14px 16px 18px;
  z-index: 22;
  box-shadow: 0 -12px 24px rgba(70, 52, 28, 0.08);
}
.plan-board-head {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 16px;
  margin-bottom: 12px;
}
.plan-board-head h3 {
  font-size: 15px;
}
.plan-board-head p {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}
.plan-board-wrap {
  height: calc(100% - 226px);
  overflow: auto;
  border-radius: 16px;
  border: 1px solid rgba(220, 207, 186, 0.88);
  background: #fffdfa;
}
.kanban-board-head {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 12px;
  margin-bottom: 10px;
}
.kanban-board-head strong {
  display: block;
  font-size: 13px;
}
.kanban-board-head span {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}
.kanban-board {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.kanban-lane {
  border-radius: 16px;
  border: 1px solid rgba(220, 207, 186, 0.88);
  background: rgba(255,255,255,0.72);
  padding: 10px;
  display: grid;
  gap: 8px;
  min-height: 152px;
}
.kanban-lane.is-current {
  border-color: rgba(29,78,216,0.34);
  background: rgba(219,234,254,0.42);
  box-shadow: inset 0 0 0 1px rgba(29,78,216,0.08);
}
.kanban-lane-head {
  display: grid;
  gap: 6px;
}
.kanban-lane-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.kanban-lane-title {
  font-size: 12px;
  font-weight: 700;
}
.kanban-lane-owner {
  font-size: 10px;
  color: var(--muted);
}
.kanban-lane-brief {
  border-radius: 12px;
  border: 1px dashed rgba(220, 207, 186, 0.92);
  background: rgba(255,255,255,0.76);
  padding: 8px;
  display: grid;
  gap: 4px;
}
.kanban-lane-brief span {
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.kanban-lane-brief strong {
  font-size: 11px;
  line-height: 1.55;
}
.kanban-card-stack {
  display: grid;
  gap: 8px;
}
.kanban-card {
  border-radius: 12px;
  border: 1px solid rgba(220, 207, 186, 0.88);
  background: #fffdfa;
  padding: 9px;
  display: grid;
  gap: 6px;
}
.kanban-card-title {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 8px;
}
.kanban-card-title strong {
  font-size: 12px;
}
.kanban-card-copy {
  font-size: 10px;
  color: var(--muted);
  line-height: 1.55;
}
.kanban-card-copy b {
  color: var(--text);
}
.plan-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.plan-table th,
.plan-table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(220, 207, 186, 0.68);
  vertical-align: top;
  white-space: nowrap;
}
.plan-table td.plan-cell-wrap {
  white-space: normal;
  min-width: 160px;
}
.plan-table th {
  position: sticky;
  top: 0;
  background: #fff7ea;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.plan-row {
  cursor: pointer;
}
.plan-row:hover,
.plan-row.active {
  background: rgba(15, 118, 110, 0.06);
}
.status-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 700;
}
.status-chip.is-completed { background: rgba(15,118,110,0.12); color: var(--green); }
.status-chip.is-in_progress { background: rgba(29,78,216,0.12); color: var(--accent-3); }
.status-chip.is-pending { background: rgba(148,163,184,0.14); color: var(--slate); }
.status-chip.is-ready { background: rgba(245,158,11,0.16); color: var(--amber); }
.status-chip.is-blocked { background: rgba(220,38,38,0.14); color: var(--accent-2); }

#status-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--status-bar-h);
  background: var(--surface);
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
  z-index: 30;
  flex-shrink: 0;
}

.sb-item { white-space: nowrap; }
.sb-green { color: var(--green); font-weight: 600; }
.sb-amber { color: var(--amber); font-weight: 600; }
.sb-red { color: var(--accent-2); font-weight: 600; }
.sb-sep { color: var(--line); }
.sb-hint { margin-left: auto; font-size: 10px; color: var(--line); white-space: nowrap; }

.node { cursor: pointer; }
.node:hover circle:not([data-health-badge]) { filter: brightness(1.15); }
.node:hover rect { filter: brightness(1.15); }
.node:hover polygon { filter: brightness(1.15); }
.node-selected circle:not([data-health-badge]),
.node-selected rect,
.node-selected polygon { filter: drop-shadow(0 0 8px rgba(15, 118, 110, 0.6)); }

#confirm-modal {
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center;
}
.modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.4); }
.modal-box {
  position: relative;
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 32px;
  width: 400px;
  box-shadow: var(--shadow);
}
.modal-icon { font-size: 32px; text-align: center; margin-bottom: 8px; }
.modal-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
.modal-body { font-size: 12px; color: var(--muted); margin-bottom: 8px; line-height: 1.6; }
.modal-warning-box {
  background: #fff1f2;
  border: 1px solid rgba(220, 38, 38, 0.18);
  color: #991b1b;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 10px;
}
.modal-context-list {
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
}
.modal-context-row {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--surface-strong);
  border: 1px solid var(--line);
}
.modal-context-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.modal-context-value {
  font-size: 12px;
  color: var(--text);
  font-weight: 600;
}
.modal-warning-note {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}
.modal-validation-state {
  margin: 0 0 12px;
  padding: 9px 10px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid var(--line);
  background: var(--surface-strong);
  color: var(--muted);
}
.modal-validation-state.is-ready {
  background: rgba(15, 118, 110, 0.10);
  border-color: rgba(15, 118, 110, 0.22);
  color: #0f766e;
}
.modal-validation-state.is-blocked {
  background: #fff1f2;
  border-color: rgba(220, 38, 38, 0.18);
  color: #991b1b;
}
.modal-reason {
  width: 100%; margin: 12px 0;
  padding: 8px; border: 1px solid var(--line);
  border-radius: 8px; font-family: var(--font-ui);
  font-size: 12px; resize: none; height: 60px;
  background: var(--surface-strong);
}
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
.btn-cancel {
  background: var(--surface-strong); border: 1px solid var(--line);
  border-radius: var(--radius-md); padding: 10px 20px; cursor: pointer;
  font-family: var(--font-ui); font-size: 13px;
}
.btn-confirm-rollback {
  background: var(--accent-2); color: white; border: none;
  border-radius: var(--radius-md); padding: 10px 20px;
  cursor: pointer; font-weight: 600; font-family: var(--font-ui); font-size: 13px;
}
.btn-confirm-rollback:hover { background: #b91c1c; }
.btn-confirm-rollback:disabled {
  cursor: not-allowed;
  opacity: 0.56;
  background: #fca5a5;
}

#disabled-overlay {
  position: absolute; inset: 0;
  background: rgba(247, 243, 234, 0.92);
  display: flex; align-items: center; justify-content: center;
  z-index: 50;
}
.overlay-msg { text-align: center; }
.overlay-icon { font-size: 48px; margin-bottom: 12px; }
.overlay-title { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
.overlay-body { color: var(--muted); font-size: 14px; line-height: 1.6; }

.ov-section { display: flex; flex-direction: column; gap: 4px; }
.ov-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
.ov-value { font-size: 13px; font-weight: 600; }
.ov-mono { font-family: var(--font-mono); font-size: 10px; word-break: break-all; color: var(--text); }
.ov-pass { color: var(--green); }
.ov-fail { color: var(--accent-2); }
.ov-idle { color: var(--muted); }
.ov-warn {
  background: #fef3c7; border: 1px solid #fcd34d;
  border-radius: 8px; padding: 6px 10px;
  font-size: 11px; color: var(--amber);
}
.mt8 { margin-top: 8px; }
.mb8 { margin-bottom: 8px; }

.health-ring-wrap {
  display: flex; flex-direction: column;
  align-items: center; gap: 4px; margin-bottom: 16px;
}
.health-label { font-size: 11px; color: var(--muted); }

.stage-stepper { display: flex; align-items: center; gap: 0; margin: 8px 0; }
.step {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; color: white;
}
.step-pass { background: var(--node-stage-pass); }
.step-fail { background: var(--node-stage-fail); }
.step-idle { background: var(--node-stage-idle); }
.step-line { flex: 1; height: 2px; background: var(--line); min-width: 8px; }

.flag-list { display: flex; flex-direction: column; gap: 8px; }
.flag-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px; background: var(--surface-strong);
  border-radius: var(--radius-md); gap: 8px;
}
.flag-id {
  font-family: var(--font-mono); font-size: 10px; color: var(--text);
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.toggle-wrap { display: flex; align-items: center; gap: 6px; cursor: pointer; flex-shrink: 0; }
.toggle-wrap input { display: none; }
.toggle-track {
  width: 32px; height: 16px; border-radius: 8px;
  background: #d1d5db; position: relative; transition: background 0.2s;
}
.toggle-wrap input:checked + .toggle-track { background: var(--accent); }
.toggle-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 12px; height: 12px; border-radius: 50%;
  background: white; transition: left 0.2s; pointer-events: none;
}
.toggle-wrap input:checked + .toggle-track .toggle-thumb { left: 18px; }
.toggle-val { font-size: 10px; color: var(--muted); width: 22px; }
.toggle-disabled { opacity: 0.5; cursor: not-allowed; }

.gate-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.gate-table th, .gate-table td {
  padding: 6px 8px; text-align: left;
  border-bottom: 1px solid var(--line);
}
.gate-table th { color: var(--muted); font-weight: 600; font-size: 11px; }
.gate-pass { color: var(--green); font-weight: 600; }
.gate-fail { color: var(--accent-2); font-weight: 600; }
.gate-idle { color: var(--muted); }

.btn-rollback {
  background: var(--accent-2); color: white; border: none;
  border-radius: var(--radius-md); padding: 8px 16px;
  cursor: pointer; font-size: 12px; width: 100%;
  font-family: var(--font-ui);
}
.btn-rollback:hover { background: #b91c1c; }

.tab-empty, .tab-loading {
  text-align: center; color: var(--muted);
  font-size: 12px; padding: 24px 0;
}

.audit-list { display: flex; flex-direction: column; gap: 6px; }
.audit-row { display: flex; gap: 6px; font-size: 10px; align-items: center; }
.audit-seq { color: var(--muted); min-width: 28px; }
.audit-ts { color: var(--muted); min-width: 90px; font-family: var(--font-mono); }
.audit-action { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-section {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}
.detail-section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.detail-grid-cards { display: grid; gap: 10px; }
.detail-card {
  border-radius: 16px;
  border: 1px solid rgba(220, 207, 186, 0.88);
  background: #fffdf8;
  padding: 14px;
}
.detail-card span {
  display: block;
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.detail-card strong {
  display: block;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-line;
}
.detail-card p {
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}
.detail-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.detail-card-action {
  border: none;
  border-radius: 10px;
  padding: 8px 10px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
}
.detail-card-action.primary {
  background: linear-gradient(135deg, #0f766e, #1d4ed8);
  color: white;
}
.detail-card-action.secondary {
  background: #fff;
  border: 1px solid var(--line);
  color: var(--text);
}
.module-workbench {
  margin-top: 16px;
  border-radius: 18px;
  border: 1px solid rgba(220, 207, 186, 0.88);
  background: linear-gradient(180deg, #fffefb, #fff8ef);
  padding: 14px;
}
.module-grid {
  display: grid;
  gap: 10px;
}
.module-field {
  display: grid;
  gap: 6px;
}
.module-field span {
  font-size: 11px;
  color: var(--muted);
}
.module-input,
.module-select,
.module-preview {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(220, 207, 186, 0.92);
  background: #fffdf8;
  padding: 10px 12px;
  font: inherit;
  color: var(--text);
}
.module-preview {
  min-height: 180px;
  max-height: 280px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.module-status {
  border-radius: 14px;
  border: 1px solid rgba(220, 207, 186, 0.92);
  background: #fffdf8;
  padding: 12px;
  display: grid;
  gap: 8px;
}
.module-status.is-idle {
  background: #fffdf8;
}
.module-status.is-success {
  background: #f3fbf7;
  border-color: rgba(15, 118, 110, 0.28);
}
.module-status.is-warning {
  background: #fff8ef;
  border-color: rgba(180, 83, 9, 0.32);
}
.module-status.is-error {
  background: #fff4f3;
  border-color: rgba(220, 38, 38, 0.22);
}
.module-status-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.module-status-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}
.module-status-badge {
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: rgba(122, 109, 91, 0.12);
  color: var(--muted);
}
.module-status-grid {
  display: grid;
  gap: 8px;
}
.module-status-row {
  display: grid;
  gap: 3px;
}
.module-status-row span {
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.module-status-row strong {
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-line;
}
.module-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.module-button {
  border: none;
  border-radius: 12px;
  padding: 10px 14px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}
.module-button.primary { background: linear-gradient(135deg, #0f766e, #1d4ed8); color: white; }
.module-button.secondary { background: #fff; border: 1px solid var(--line); color: var(--text); }
.module-button.warn { background: #c2410c; color: white; }
.module-note {
  margin-top: 10px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.6;
}

@media (max-width: 1180px) {
  :root {
    --sidebar-w: 220px;
    --detail-w: 320px;
  }
}

@media (max-width: 980px) {
  :root {
    --masterbar-h: 156px;
    --plan-board-h: 520px;
  }
  #master-status {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  #control-sidebar {
    width: 100%;
    top: calc(var(--topbar-h) + var(--masterbar-h));
    bottom: auto;
    height: 164px;
    border-right: none;
    border-bottom: 1px solid var(--line);
  }
  #canvas-wrap {
    margin-left: 0;
    margin-right: 0;
    margin-top: 164px;
  }
  #detail-panel {
    left: 0;
    width: 100%;
    top: auto;
    bottom: calc(var(--status-bar-h) + var(--plan-board-h));
    height: 42vh;
  }
}

@media (max-width: 1280px) {
  .kanban-board {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .kanban-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
`;

  const js = `(function() {
'use strict';

// ─── Parse embedded data ─────────────────────────────────────────────────────
const RAW = JSON.parse(document.getElementById('mindmap-data').textContent);
const CONTROL = RAW.meta.controlCenter || {};
const AUTH_HEADERS = {
  'x-user-id': 'master-ui-operator',
  'x-permissions': 'domain.viewer,system.admin',
};
const OPERATOR_HISTORY_STORAGE_KEY = 'workflow-os.operator-action-history';
const DEEP_LINK_CONTEXT_STORAGE_KEY = 'workflow-os.deep-link-context';

// ─── State ───────────────────────────────────────────────────────────────────
const S = {
  nodes: RAW.nodes.map(function(n) { return Object.assign({}, n); }),
  edges: RAW.edges.slice(),
  byId: {},
  selected: null,
  tx: 0, ty: 0, tk: 1,
  dragging: null,
  isPanning: false,
  panStart: null,
  sseStatus: 'DISCONNECTED',
  panelTab: 'overview',
  flagToggleEnabled: RAW.meta.flagStates['system_api.flag_toggle_ui.enabled'] || false,
  rollbackEnabled: RAW.meta.flagStates['system_api.rollback_ui.enabled'] || false,
  apiBase: RAW.meta.apiBase,
  liveFlags: {},
  liveHealth: {},
  lastUpdate: null,
  totalTests: 570,
  passingTests: 570,
  planningApiBase: RAW.meta.planningApiBase || '/api/planning-studio',
  statusSummary: Object.assign({ autoSendEnabled: false }, CONTROL.statusBar || {}),
  controlNodes: Array.isArray(CONTROL.controlNodes) ? CONTROL.controlNodes.slice() : [],
  planRows: Array.isArray(CONTROL.planRows) ? CONTROL.planRows.slice() : [],
  kanbanLanes: Array.isArray(CONTROL.kanbanLanes) ? CONTROL.kanbanLanes.slice() : [],
  scaffoldCatalog: CONTROL.scaffoldCatalog || { blueprints: [], recipes: [], profiles: [], defaultBlueprint: '', defaultRecipe: '' },
  roadmapSections: Array.isArray(CONTROL.roadmapSections) ? CONTROL.roadmapSections.slice() : [],
  planningSnapshot: null,
  scaffoldForm: {
    domain: '',
    blueprint: (CONTROL.scaffoldCatalog && CONTROL.scaffoldCatalog.defaultBlueprint) || 'domain-module-extension',
    recipe: (CONTROL.scaffoldCatalog && CONTROL.scaffoldCatalog.defaultRecipe) || 'contract-first-module-builder',
  },
  scaffoldPreview: '',
  scaffoldTranscript: '',
  scaffoldError: '',
  scaffoldStatus: {
    tone: 'idle',
    title: 'preview 대기',
    currentState: 'preview를 아직 실행하지 않았습니다.',
    nextAction: 'dry-run preview를 먼저 누르세요.',
    retryable: '가능',
    detail: 'domain, blueprint, recipe를 고른 뒤 preview를 실행하면 결과가 여기에 표시됩니다.',
  },
  execution: {
    runtimeAvailable: false,
    sessions: [],
    selectedPts: '',
    selectedWorkerIndex: 0,
    currentWorkerIndex: null,
    activeWorkerIndex: null,
    rollbackTargetDomain: '',
    promptText: '',
    optimizedPrompt: '',
    lastPromptText: '',
    schedulerRunning: false,
    schedulerWorkers: [],
    currentActivity: null,
    lastActivity: null,
    lastError: null,
    operatorBrief: null,
    operatorCockpit: null,
    operatorActionHistory: [],
    nextActionHint: '',
    controls: {
      sendPrompt: false,
      autoSendToggle: false,
      stop: false,
      retryLastPrompt: false,
      rollback: false,
      terminalStatusVisible: true,
      failureReasonVisible: false,
    },
    controlMatrix: {},
    statusTone: 'warning',
    statusTitle: '터미널 연결 확인 필요',
    statusDetail: 'PTY 세션과 스케줄러 상태를 불러오는 중입니다.',
  },
  deepLinkContext: {
    focus: '',
    reason: '',
    command: '',
    label: '',
    source: '',
  },
  stageRun: {
    selectedStage: 'D',
    selectedModule: '',
    supportedStages: ['A', 'B', 'C', 'D', 'E'],
    runEndpoint: '/api/planning-studio/stage-run',
    history: [],
    historyFilter: 'all',
    historySignalView: 'all',
    historySignalCollapsed: false,
    historySort: 'risk-first',
    highlightedHistoryIndex: -1,
    matchedHistoryIndexes: [],
    matchedHistoryCursor: -1,
    focusedSignalType: '',
    focusedSignalValue: '',
    lastRequest: null,
    lastReport: null,
    statusTone: 'idle',
    statusTitle: 'Stage 실행 대기',
    statusDetail: 'dry-run 또는 execute를 선택하면 결과가 여기에 표시됩니다.',
  },
};

// ─── Bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  S.execution.operatorActionHistory = loadOperatorActionHistory();
  S.nodes.forEach(function(n) { S.byId[n.id] = n; });

  if (RAW.meta.flagStates['system_api.enabled'] === false) {
    document.getElementById('disabled-overlay').style.display = 'flex';
    return;
  }

  resizeCanvas();
  window.addEventListener('resize', function() { resizeCanvas(); applyTransform(); });

  runForce(120);
  render();
  renderMasterStatus();
  if (Array.isArray(RAW.meta.stageRunHistory) && RAW.meta.stageRunHistory.length > 0) {
    applyStageRunHistory(RAW.meta.stageRunHistory);
  }
  if (RAW.meta.stageRunLatest && typeof RAW.meta.stageRunLatest === 'object') {
    S.stageRun.lastReport = normalizeStageRunReport(RAW.meta.stageRunLatest);
  }
  renderExecutionConsole();
  renderSidebar();
  renderPlanBoard();
  updateStatusBar();
  setupPanZoom();
  setupNodeInteractions();
  setupKeyboard();
  hydrateFromApi();
  hydratePlanningSnapshot();
  hydrateExecutionRuntime();
  connectSSE();

  selectNode(S.statusSummary.currentLaneId || 'root');
  setTimeout(fitView, 50);
  setTimeout(applyControlCenterDeepLink, 120);
  window.addEventListener('popstate', applyControlCenterDeepLink);
  window.addEventListener('hashchange', applyControlCenterDeepLink);
});

// ─── Canvas resize ───────────────────────────────────────────────────────────
function resizeCanvas() {
  var svg = document.getElementById('mindmap-svg');
  var wrap = document.getElementById('canvas-wrap');
  svg.setAttribute('width', wrap.clientWidth);
  svg.setAttribute('height', wrap.clientHeight);
  svg.setAttribute('viewBox', '0 0 ' + wrap.clientWidth + ' ' + wrap.clientHeight);
}

// ─── Force simulation ────────────────────────────────────────────────────────
function runForce(iterations) {
  var nodes = S.nodes;
  var edges = S.edges;

  nodes.forEach(function(n) { n.vx = 0; n.vy = 0; });

  for (var iter = 0; iter < iterations; iter++) {
    var alpha = 1 - iter / iterations;
    var alpha2 = alpha * alpha;

    for (var i = 0; i < nodes.length; i++) {
      for (var j = i + 1; j < nodes.length; j++) {
        var dx = nodes[j].x - nodes[i].x;
        var dy = nodes[j].y - nodes[i].y;
        var d2 = dx * dx + dy * dy;
        if (d2 < 1) continue;
        var d = Math.sqrt(d2);
        var repulse = -250 * alpha2 / d2;
        var fx = repulse * dx / d;
        var fy = repulse * dy / d;
        nodes[i].vx += fx; nodes[i].vy += fy;
        nodes[j].vx -= fx; nodes[j].vy -= fy;
      }
    }

    for (var ei = 0; ei < edges.length; ei++) {
      var edge = edges[ei];
      var src = S.byId[edge.source];
      var tgt = S.byId[edge.target];
      if (!src || !tgt) continue;
      var edx = tgt.x - src.x;
      var edy = tgt.y - src.y;
      var ed = Math.sqrt(edx * edx + edy * edy) || 1;
      var restLen = edge.type === 'dependency' ? 180 :
                    edge.type === 'lifecycle'  ? 130 :
                    edge.type === 'flag'       ? 150 :
                    edge.type === 'contract'   ? 180 : 150;
      var force = (ed - restLen) * 0.06 * alpha;
      var efx = force * edx / ed;
      var efy = force * edy / ed;
      src.vx += efx; src.vy += efy;
      tgt.vx -= efx; tgt.vy -= efy;
    }

    var cx = 800, cy = 500;
    nodes.forEach(function(n) {
      if (n.type === 'root') return;
      n.vx += (cx - n.x) * 0.003 * alpha;
      n.vy += (cy - n.y) * 0.003 * alpha;
    });

    nodes.forEach(function(n) {
      if (n.fixed) return;
      n.x += n.vx; n.y += n.vy;
      n.vx *= 0.65; n.vy *= 0.65;
    });
  }

  nodes.forEach(function(n) { delete n.vx; delete n.vy; });
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────
var SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  var el = document.createElementNS(SVG_NS, tag);
  var keys = Object.keys(attrs || {});
  for (var i = 0; i < keys.length; i++) el.setAttribute(keys[i], attrs[keys[i]]);
  return el;
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  renderEdges();
  renderNodes();
  applyTransform();
}

function renderEdges() {
  var layer = document.getElementById('edges-layer');
  layer.innerHTML = '';
  for (var i = 0; i < S.edges.length; i++) {
    var edge = S.edges[i];
    var src = S.byId[edge.source];
    var tgt = S.byId[edge.target];
    if (!src || !tgt) continue;

    var el;
    if (edge.type === 'contract') {
      var mx = (src.x + tgt.x) / 2;
      var my = (src.y + tgt.y) / 2 - 40;
      el = svgEl('path', {
        d: 'M' + src.x + ' ' + src.y + ' Q' + mx + ' ' + my + ' ' + tgt.x + ' ' + tgt.y,
        fill: 'none',
        stroke: 'var(--edge-contract)',
        'stroke-width': '1.5',
        'stroke-dasharray': '5 3',
        opacity: '0.7',
        'marker-end': 'url(#arrow)',
      });
    } else {
      el = svgEl('line', {
        x1: src.x, y1: src.y, x2: tgt.x, y2: tgt.y,
        stroke: edge.type === 'dependency' ? 'var(--edge-dependency)' :
                edge.type === 'lifecycle'  ? 'var(--edge-lifecycle)'  :
                edge.type === 'flag'       ? 'var(--edge-flag)'       : 'var(--line)',
        'stroke-width': edge.type === 'dependency' ? '2' : '1',
        opacity: edge.type === 'flag' ? '0.5' : '0.8',
        'marker-end': edge.type === 'dependency' ? 'url(#arrow)' : '',
      });
    }
    el.dataset.edgeId = edge.id;
    layer.appendChild(el);
  }
}

function nodeRadius(type) {
  return type === 'root' ? 40 : type === 'domain' ? 34 : type === 'stage' ? 18 : type === 'contract' ? 22 : 14;
}

function nodeFill(node) {
  if (node.type === 'root')     return 'url(#grad-root)';
  if (node.type === 'domain')   return 'var(--node-domain)';
  if (node.type === 'stage') {
    return node.status === 'PASS' ? 'var(--node-stage-pass)' :
           node.status === 'FAIL' ? 'var(--node-stage-fail)' : 'var(--node-stage-idle)';
  }
  if (node.type === 'contract') return 'var(--node-contract)';
  if (node.type === 'flag')     return node.value ? 'var(--node-flag-on)' : 'var(--node-flag-off)';
  return '#888';
}

function renderNodes() {
  var layer = document.getElementById('nodes-layer');
  layer.innerHTML = '';

  for (var ni = 0; ni < S.nodes.length; ni++) {
    var node = S.nodes[ni];
    if (node.hiddenInGraph) continue;
    var g = svgEl('g', {
      transform: 'translate(' + node.x + ',' + node.y + ')',
      class: 'node node-' + node.type + (S.selected === node.id ? ' node-selected' : ''),
      'data-id': node.id,
      'data-type': node.type,
      role: 'button',
      tabindex: '0',
      'aria-label': node.label + ' — ' + node.type,
    });

    var r = nodeRadius(node.type);

    if (node.type === 'root' || node.type === 'domain') {
      var circle = svgEl('circle', {
        r: r,
        fill: nodeFill(node),
        stroke: S.selected === node.id ? 'white' : 'rgba(255,255,255,0.3)',
        'stroke-width': S.selected === node.id ? '3' : '1.5',
        filter: 'url(#node-shadow)',
      });
      g.appendChild(circle);

      var labelText = node.label.length > 6 ? node.label.slice(0, 6) + '\\u2026' : node.label;
      var label = svgEl('text', {
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: 'white',
        'font-size': node.type === 'root' ? '10' : '9',
        'font-weight': '700',
        'font-family': 'var(--font-ui)',
        'pointer-events': 'none',
      });
      label.textContent = labelText;
      g.appendChild(label);

      if (node.type === 'domain' && node.healthScore !== undefined) {
        var badgeG = svgEl('g', { transform: 'translate(' + (r - 6) + ',' + (-r + 6) + ')' });
        var badge = svgEl('circle', {
          r: '8',
          fill: node.healthScore >= 90 ? 'var(--health-green)' :
                node.healthScore >= 70 ? 'var(--health-amber)' : 'var(--health-red)',
          stroke: 'var(--surface)',
          'stroke-width': '1.5',
          'data-health-badge': node.id,
        });
        var badgeTxt = svgEl('text', {
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          fill: 'white',
          'font-size': '6',
          'font-weight': '700',
          'pointer-events': 'none',
          'data-health-score': node.id,
        });
        badgeTxt.textContent = String(node.healthScore || 0);
        badgeG.appendChild(badge);
        badgeG.appendChild(badgeTxt);
        g.appendChild(badgeG);
      }

    } else if (node.type === 'stage') {
      var rect = svgEl('rect', {
        x: -r, y: -10, width: r * 2, height: 20,
        rx: '8', ry: '8',
        fill: nodeFill(node),
        stroke: 'rgba(255,255,255,0.4)',
        'stroke-width': '1',
      });
      g.appendChild(rect);
      var stageLabel = node.label + (node.status === 'PASS' ? ' \\u2713' : node.status === 'FAIL' ? ' \\u2717' : '');
      var stageTxt = svgEl('text', {
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: 'white',
        'font-size': '9',
        'font-weight': '700',
        'pointer-events': 'none',
      });
      stageTxt.textContent = stageLabel;
      g.appendChild(stageTxt);

    } else if (node.type === 'contract') {
      var size = r;
      var diamond = svgEl('polygon', {
        points: '0,-' + size + ' ' + size + ',0 0,' + size + ' -' + size + ',0',
        fill: nodeFill(node),
        stroke: 'rgba(255,255,255,0.4)',
        'stroke-width': '1',
        filter: 'url(#node-shadow)',
      });
      g.appendChild(diamond);
      var contractTxt = svgEl('text', {
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: 'white',
        'font-size': '7',
        'font-weight': '600',
        'pointer-events': 'none',
      });
      contractTxt.textContent = node.label;
      g.appendChild(contractTxt);

    } else if (node.type === 'flag') {
      var fw = 70, fh = 20;
      var flagRect = svgEl('rect', {
        x: -fw/2, y: -fh/2, width: fw, height: fh,
        rx: '10', ry: '10',
        fill: nodeFill(node),
        stroke: 'rgba(255,255,255,0.3)',
        'stroke-width': '1',
        opacity: node.value ? '1' : '0.6',
      });
      g.appendChild(flagRect);
      var flagLabelStr = node.label.length > 14 ? node.label.slice(0, 13) + '\\u2026' : node.label;
      var flagTxt = svgEl('text', {
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: 'white',
        'font-size': '7',
        'pointer-events': 'none',
      });
      flagTxt.textContent = flagLabelStr;
      g.appendChild(flagTxt);
      var dot = svgEl('circle', {
        cx: '30', cy: '0', r: '5',
        fill: node.value ? '#4ade80' : '#f87171',
        'data-flag-dot': node.id,
      });
      g.appendChild(dot);
    }

    layer.appendChild(g);
  }
}

function applyTransform() {
  var root = document.getElementById('graph-root');
  root.setAttribute('transform', 'translate(' + S.tx + ',' + S.ty + ') scale(' + S.tk + ')');
}

function statusClassName(status) {
  return 'is-' + String(status || 'pending').replace(/[^a-z_]/gi, '_');
}

function stageProgress(stageValue) {
  var stage = String(stageValue || '').toUpperCase();
  if (stage === 'A') return 20;
  if (stage === 'B') return 35;
  if (stage === 'C') return 55;
  if (stage === 'D') return 80;
  if (stage === 'E') return 100;
  return 10;
}

function laneStatusByStage(stageValue, laneId) {
  var stage = String(stageValue || '').toUpperCase();
  var order = ['A', 'B', 'C', 'D', 'E'];
  var currentIndex = Math.max(order.indexOf(stage), 0);
  var laneThresholds = {
    'control-intake': 0,
    'control-planning': 1,
    'control-execution': 2,
    'control-validation': 3,
    'control-complete': 4,
    'control-module': 1,
  };
  var threshold = laneThresholds[laneId];
  if (laneId === 'control-module') {
    return currentIndex >= 1 ? 'ready' : 'pending';
  }
  if (currentIndex > threshold) return 'completed';
  if (currentIndex === threshold) return 'in_progress';
  return 'pending';
}

function statusLabel(status) {
  var value = String(status || 'pending');
  return value === 'completed' ? '완료'
    : value === 'in_progress' ? '진행 중'
      : value === 'ready' ? '준비'
        : value === 'blocked' ? '차단'
          : '대기';
}

function renderMasterStatus() {
  var goalEl = document.getElementById('master-goal');
  var stageEl = document.getElementById('master-stage');
  var progressEl = document.getElementById('master-progress');
  var blockerEl = document.getElementById('master-blocker');
  var nextEl = document.getElementById('master-next');
  var autoSendEl = document.getElementById('master-auto-send');
  var branchEl = document.getElementById('master-branch');
  var guardEl = document.getElementById('master-guard');
  var actionEl = document.getElementById('master-action-history');
  var topbarBadgeEl = document.getElementById('topbar-auto-send-badge');
  var topbarBranchEl = document.getElementById('topbar-branch-readiness');
  var topbarGuardEl = document.getElementById('topbar-commit-guard-badge');
  var topbarActionEl = document.getElementById('topbar-operator-action-badge');
  if (!goalEl) return;

  var branchState = operatorCockpitBranchState();
  var guardState = operatorCockpitGuardState();
  var actionState = recentOperatorActionState();

  goalEl.textContent = S.statusSummary.goal || '현재 목표 미정';
  stageEl.textContent = S.statusSummary.currentStage || '-';
  progressEl.textContent = String(S.statusSummary.progress || 0) + '%';
  blockerEl.textContent = S.statusSummary.blocker || '정상';
  blockerEl.className = 'master-value ' + (
    String(S.statusSummary.blocker || '').includes('정상') ? 'status-ok'
      : String(S.statusSummary.blocker || '').includes('차단') ? 'status-blocked'
        : 'status-attention'
  );
  nextEl.textContent = S.statusSummary.nextTask || 'NONE';

  var autoOn = S.execution.runtimeAvailable
    ? S.execution.schedulerRunning === true
    : S.statusSummary.autoSendEnabled === true;
  if (autoSendEl) {
    autoSendEl.textContent = autoOn ? 'ON' : 'OFF';
    autoSendEl.className = autoOn ? 'master-auto-on' : 'master-auto-off';
  }
  if (branchEl) {
    branchEl.textContent = branchState.summary;
    branchEl.className = 'master-value ' + operatorCockpitStatusClass(branchState.tone);
  }
  if (guardEl) {
    guardEl.textContent = guardState.summary;
    guardEl.className = 'master-value ' + operatorCockpitStatusClass(guardState.tone);
  }
  if (actionEl) {
    actionEl.textContent = actionState.summary;
    actionEl.className = 'master-value ' + operatorCockpitStatusClass(actionState.tone);
  }
  if (topbarBadgeEl) {
    topbarBadgeEl.textContent = autoOn ? '자동전송 ON' : '자동전송 OFF';
    topbarBadgeEl.className = 'tb-auto-badge ' + (autoOn ? 'tb-auto-on' : 'tb-auto-off');
  }
  if (topbarBranchEl) {
    topbarBranchEl.textContent = branchState.label;
    topbarBranchEl.className = 'tb-status-badge ' + topbarBadgeClass(branchState.tone);
    topbarBranchEl.title = branchState.summary;
  }
  if (topbarGuardEl) {
    topbarGuardEl.textContent = guardState.label;
    topbarGuardEl.className = 'tb-status-badge ' + topbarBadgeClass(guardState.tone);
    topbarGuardEl.title = guardState.summary;
  }
  if (topbarActionEl) {
    topbarActionEl.textContent = actionState.label;
    topbarActionEl.className = 'tb-status-badge ' + topbarBadgeClass(actionState.tone);
    topbarActionEl.title = actionState.summary;
  }
}

function currentExecutionActivity() {
  return S.execution.lastError || S.execution.currentActivity || S.execution.lastActivity || null;
}

function selectedExecutionSession() {
  var selected = String(S.execution.selectedPts || '').trim();
  var sessions = Array.isArray(S.execution.sessions) ? S.execution.sessions : [];
  for (var i = 0; i < sessions.length; i++) {
    if (String(sessions[i].pts || '') === selected) {
      return sessions[i];
    }
  }
  return null;
}

function executionSummaryTone() {
  var activity = currentExecutionActivity();
  if (activity && activity.error) return 'error';
  if (S.execution.schedulerRunning) return 'success';
  if (selectedExecutionSession()) return 'idle';
  return 'warning';
}

function executionSummaryTitle() {
  var activity = currentExecutionActivity();
  if (activity && activity.error) return '실행 실패 감지';
  if (S.execution.schedulerRunning) return '자동 전송 실행 중';
  if (selectedExecutionSession()) return '수동 제어 대기';
  return S.execution.runtimeAvailable ? '터미널 선택 필요' : '브리지 오프라인';
}

function executionNextActionBase() {
  if (String(S.execution.nextActionHint || '').trim()) {
    return String(S.execution.nextActionHint || '').trim();
  }
  var activity = currentExecutionActivity();
  if (activity && activity.error) {
    return '실패 원인을 확인한 뒤 이전 내용 다시 실행 또는 프롬프트 전송을 누르세요.';
  }
  if (S.execution.schedulerRunning) {
    return '중지가 필요하면 자동 전송 중지를 누르고, 즉시 진행은 다음 단계 엔터를 사용하세요.';
  }
  if (selectedExecutionSession()) {
    return '추천 프롬프트를 채우거나 직접 입력한 뒤 전송 또는 자동 전송 시작을 누르세요.';
  }
  return 'PTY 세션을 먼저 선택하거나 브리지를 연결하세요.';
}

function executionNextAction() {
  var message = executionNextActionBase();
  var failureActivity = S.execution.lastError || currentExecutionActivity();
  if (!failureActivity || !failureActivity.error) {
    return executionSummaryWithIndexedWorker(message, failureActivity);
  }
  var failureLocation = executionFailureLocationSummary(
    (S.execution.operatorBrief && S.execution.operatorBrief.blockedAt) || '',
    failureActivity
  );
  if (!failureLocation || failureLocation === '없음') {
    return executionSummaryWithIndexedWorker(message, failureActivity);
  }
  var indexedMessage = executionSummaryWithIndexedWorker(message, failureActivity);
  if (indexedMessage.indexOf(failureLocation) >= 0) {
    return indexedMessage;
  }
  return '실패 위치: ' + failureLocation + ' · ' + indexedMessage;
}

function executionFailureLocation(activity) {
  if (!activity || !activity.error) {
    return '없음';
  }
  return [
    activity.action || 'action 없음',
    executionActivityWorkerLabel(activity) || activity.worker || 'worker 없음',
    activity.pts || 'pts 없음',
  ].join(' / ');
}

function executionWorkerIndexValue(worker, fallbackIndex) {
  if (worker && Number.isInteger(worker.worker_index)) {
    return worker.worker_index;
  }
  return Number.isInteger(fallbackIndex) ? fallbackIndex : 0;
}

function executionWorkerLabel(worker, fallbackIndex) {
  var indexValue = executionWorkerIndexValue(worker, fallbackIndex);
  var name = String((worker && worker.name) || ('Worker ' + (indexValue + 1)));
  return '[' + String(indexValue) + '] ' + name;
}

function executionMatchesWorker(activityWorkerName, worker, fallbackIndex) {
  var activityName = String(activityWorkerName || '').trim();
  if (!activityName) {
    return false;
  }
  return activityName === executionWorkerLabel(worker, fallbackIndex)
    || activityName === String((worker && worker.name) || '').trim();
}

function executionActivityWorkerLabel(activity) {
  if (!activity || typeof activity !== 'object') {
    return '';
  }
  var workerIndex = Number.isInteger(activity.worker_index) ? activity.worker_index : null;
  if (Number.isInteger(workerIndex) && Array.isArray(S.execution.schedulerWorkers) && S.execution.schedulerWorkers[workerIndex]) {
    return executionWorkerLabel(S.execution.schedulerWorkers[workerIndex], workerIndex);
  }
  var workerName = String(activity.worker || '').trim();
  if (!workerName) {
    return '';
  }
  if (/^[[][0-9]+][ \t\r\n\f\v]/.test(workerName)) {
    return workerName;
  }
  if (Array.isArray(S.execution.schedulerWorkers)) {
    for (var index = 0; index < S.execution.schedulerWorkers.length; index += 1) {
      var worker = S.execution.schedulerWorkers[index];
      if (executionMatchesWorker(workerName, worker, index)) {
        return executionWorkerLabel(worker, index);
      }
    }
  }
  return workerName;
}

function executionSummaryWithIndexedWorker(summary, activity) {
  var message = String(summary || '').trim();
  if (!message) {
    return '';
  }
  var workerName = String((activity && activity.worker) || '').trim();
  var indexedLabel = executionActivityWorkerLabel(activity);
  if (!indexedLabel || indexedLabel === workerName || message.indexOf(indexedLabel) >= 0) {
    return message;
  }
  if (workerName && message.indexOf(workerName) >= 0) {
    return message.replace(workerName, indexedLabel);
  }
  return message + ' / ' + indexedLabel;
}

function executionActivitySummary(activity, fallback) {
  if (!activity) {
    return fallback || '없음';
  }
  return [
    activity.action || 'action 없음',
    activity.worker || 'worker 없음',
    activity.pts || 'pts 없음',
    activity.packet_id || 'packet 없음',
  ].filter(Boolean).join(' / ');
}

function executionCurrentSummary() {
  var brief = S.execution.operatorBrief || {};
  if (String(brief.currentExecution || '').trim()) {
    return executionSummaryWithIndexedWorker(String(brief.currentExecution).trim(), S.execution.currentActivity);
  }
  if (!S.execution.schedulerRunning) {
    return '중지됨';
  }
  return executionActivitySummary(S.execution.currentActivity, '실행 중인 worker 없음');
}

function executionLastDispatchSummary() {
  var brief = S.execution.operatorBrief || {};
  var dispatchActivity = S.execution.lastError || S.execution.lastActivity;
  if (String(brief.lastDispatch || '').trim()) {
    return executionSummaryWithIndexedWorker(String(brief.lastDispatch).trim(), dispatchActivity);
  }
  return executionActivitySummary(dispatchActivity, '최근 전송 없음');
}

function executionFailureLocationSummary(summary, activity) {
  var message = String(summary || '').trim();
  if (!message) {
    return executionFailureLocation(activity);
  }
  return executionSummaryWithIndexedWorker(message, activity);
}

function executionFailureReasonSummary(summary, activity) {
  var message = String(summary || '').trim();
  if (!message || message === '없음') {
    return '없음';
  }
  var indexedLabel = executionActivityWorkerLabel(activity);
  if (!indexedLabel || message.indexOf(indexedLabel) >= 0) {
    return message;
  }
  return indexedLabel + ' · ' + message;
}

function refreshExecutionSelectionUi() {
  var selectedWorkerIndex = Number.isInteger(S.execution.selectedWorkerIndex) ? S.execution.selectedWorkerIndex : 0;
  var selectedWorker = Array.isArray(S.execution.schedulerWorkers) ? S.execution.schedulerWorkers[selectedWorkerIndex] || null : null;
  var rollbackTarget = selectedRollbackDomain();
  var nextAction = executionNextAction();
  var context = [];
  if (selectedWorker) {
    context.push('선택 worker: ' + executionWorkerLabel(selectedWorker, selectedWorkerIndex));
  }
  if (rollbackTarget) {
    context.push('롤백 대상: ' + String(rollbackTarget.label || rollbackTarget.id || '없음'));
  }
  S.execution.statusTone = executionSummaryTone();
  S.execution.statusTitle = executionSummaryTitle();
  S.execution.statusDetail = context.length > 0 ? context.join(' · ') + ' · ' + nextAction : nextAction;
  renderExecutionConsole();
  refreshRollbackModalContext();
  refreshRollbackModalValidation();
}

function executionAvailableControlsSummary() {
  var brief = S.execution.operatorBrief || {};
  if (String(brief.availableControlsSummary || '').trim()) {
    return String(brief.availableControlsSummary).trim();
  }
  var controlMatrix = normalizeExecutionControlMatrix(S.execution.controlMatrix);
  var controlLabels = {
    send_prompt: '프롬프트 전송',
    auto_send_toggle: '자동 전송',
    stop: '중지',
    retry_last_prompt: '재시도',
    rollback: '롤백',
  };
  var enabled = Object.keys(controlLabels).filter(function(id) {
    return controlMatrix[id] && controlMatrix[id].enabled === true;
  }).map(function(id) {
    return controlLabels[id];
  });
  return enabled.length > 0 ? enabled.join(', ') : '즉시 가능한 제어 없음';
}

function executionOperatorCockpitStatus() {
  var cockpit = S.execution.operatorCockpit || null;
  if (!cockpit) {
    return '로딩 중';
  }
  var guard = cockpit.commitGuard || {};
  if (guard.canApply) {
    return 'apply 가능';
  }
  if (guard.validationsPassed) {
    return '검증 통과';
  }
  return String(guard.nextAction || '검증 대기').trim() || '검증 대기';
}

function executionOperatorCockpitBranchSummary() {
  var cockpit = S.execution.operatorCockpit || null;
  if (!cockpit || !cockpit.branch) {
    return '없음';
  }
  return String(cockpit.branch.recommendedBranch || cockpit.branch.currentBranch || '없음').trim() || '없음';
}

function executionOperatorCockpitCommitSummary() {
  var cockpit = S.execution.operatorCockpit || null;
  if (!cockpit || !cockpit.commitGuard) {
    return '없음';
  }
  return String(cockpit.commitGuard.commitSubject || '없음').trim() || '없음';
}

function executionOperatorCockpitValidationSummary() {
  var cockpit = S.execution.operatorCockpit || null;
  if (!cockpit || !cockpit.validationProfile) {
    return '없음';
  }
  var profile = cockpit.validationProfile;
  var commands = Array.isArray(profile.commands) && profile.commands.length > 0
    ? profile.commands.join(', ')
    : '명령 없음';
  return [profile.packetType || 'UNKNOWN', profile.stage || 'UNKNOWN', commands].filter(Boolean).join(' / ');
}

function executionOperatorCockpitGuardSummary() {
  var cockpit = S.execution.operatorCockpit || null;
  if (!cockpit || !cockpit.commitGuard) {
    return '없음';
  }
  var guard = cockpit.commitGuard;
  var reasons = Array.isArray(guard.reasons) ? guard.reasons.filter(Boolean) : [];
  var prefix = executionOperatorCockpitStatus();
  return reasons.length > 0 ? prefix + ' / ' + reasons.join(' / ') : prefix;
}

function executionOperatorCockpitActionsSummary() {
  var cockpit = S.execution.operatorCockpit || null;
  var fallbackActions = [
    'npm run operator:cockpit',
    'npm run session:bootstrap',
    'npm run branch:bootstrap',
    'npm run commit:guard',
  ];
  if (!cockpit) {
    return fallbackActions.join(', ');
  }
  return Array.isArray(cockpit.operatorActions) && cockpit.operatorActions.length > 0
    ? cockpit.operatorActions.join(', ')
    : fallbackActions.join(', ');
}

function operatorCockpitBranchState() {
  var cockpit = S.execution.operatorCockpit || null;
  if (!cockpit || !cockpit.branch) {
    return {
      label: '브랜치 대기',
      tone: 'info',
      summary: '브랜치 정보 없음',
    };
  }
  var currentBranch = String(cockpit.branch.currentBranch || '').trim();
  var recommendedBranch = String(cockpit.branch.recommendedBranch || '').trim();
  var dirty = Boolean(cockpit.git && cockpit.git.dirty);

  if (dirty) {
    return {
      label: '브랜치 점검',
      tone: 'warn',
      summary: recommendedBranch || currentBranch || '브랜치 정보 없음',
    };
  }
  if (recommendedBranch && currentBranch && recommendedBranch !== currentBranch) {
    return {
      label: '브랜치 전환 권장',
      tone: 'warn',
      summary: recommendedBranch,
    };
  }
  return {
    label: '브랜치 준비',
    tone: 'ready',
    summary: recommendedBranch || currentBranch || '브랜치 정보 없음',
  };
}

function operatorCockpitGuardState() {
  var cockpit = S.execution.operatorCockpit || null;
  var guard = cockpit && cockpit.commitGuard ? cockpit.commitGuard : null;
  if (!guard) {
    return {
      label: '가드 대기',
      tone: 'info',
      summary: '커밋 가드 정보 없음',
    };
  }
  if (guard.canApply) {
    return {
      label: '커밋 가능',
      tone: 'ready',
      summary: 'apply 가능',
    };
  }
  if (guard.validationsPassed) {
    return {
      label: '검증 통과',
      tone: 'info',
      summary: String(guard.nextAction || '검증 통과').trim() || '검증 통과',
    };
  }
  if (guard.protectedBranch) {
    return {
      label: '가드 차단',
      tone: 'blocked',
      summary: 'protected branch',
    };
  }
  return {
    label: '커밋 대기',
    tone: 'warn',
    summary: String(guard.nextAction || 'verify 대기').trim() || 'verify 대기',
  };
}

function operatorCockpitStatusClass(tone) {
  return tone === 'ready' ? 'status-ok'
    : tone === 'blocked' ? 'status-blocked'
      : tone === 'warn' ? 'status-attention'
        : '';
}

function topbarBadgeClass(tone) {
  return tone === 'ready' ? 'tb-ready'
    : tone === 'blocked' ? 'tb-blocked'
      : tone === 'warn' ? 'tb-warn'
        : 'tb-info';
}

function kanbanLaneOperatorBrief(laneId) {
  if (laneId === 'control-validation') {
    return {
      label: '검증 루프',
      summary: executionOperatorCockpitGuardSummary(),
    };
  }
  if (laneId === 'control-complete') {
    return {
      label: '브랜치 준비도',
      summary: executionOperatorCockpitBranchSummary(),
    };
  }
  return null;
}

function operatorCockpitValidationCommands() {
  var cockpit = S.execution.operatorCockpit || null;
  var commands = cockpit && cockpit.validationProfile && Array.isArray(cockpit.validationProfile.commands)
    ? cockpit.validationProfile.commands.filter(Boolean)
    : [];
  if (commands.length > 0) {
    return commands;
  }
  return [
    'npm run operator:cockpit',
    'npm run commit:guard',
    'npm run commit:guard:verify',
  ];
}

function operatorCockpitBranchActionSummary() {
  var cockpit = S.execution.operatorCockpit || null;
  if (!cockpit || !cockpit.branch) {
    return '권장 브랜치 정보 없음';
  }
  var currentBranch = String(cockpit.branch.currentBranch || '').trim();
  var recommendedBranch = String(cockpit.branch.recommendedBranch || '').trim();
  var createCommand = String(cockpit.branch.createCommand || '').trim();
  if (recommendedBranch && currentBranch && recommendedBranch !== currentBranch) {
    return recommendedBranch + ' / ' + (createCommand || 'git checkout -b ' + recommendedBranch);
  }
  return recommendedBranch || currentBranch || '권장 브랜치 정보 없음';
}

function operatorCockpitCommitGuardNextActionSummary() {
  var cockpit = S.execution.operatorCockpit || null;
  var guard = cockpit && cockpit.commitGuard ? cockpit.commitGuard : null;
  if (!guard) {
    return '커밋 가드 정보 없음';
  }
  var reasons = Array.isArray(guard.reasons) ? guard.reasons.filter(Boolean) : [];
  var nextAction = String(guard.nextAction || '').trim() || '다음 행동 없음';
  return reasons.length > 0 ? nextAction + ' / ' + reasons.join(' / ') : nextAction;
}

function operatorCockpitGuideForNode(nodeId) {
  var normalizedId = String(nodeId || '').trim();
  var commands = operatorCockpitValidationCommands();
  var validationSummary = commands.join('\n');
  var branchSummary = operatorCockpitBranchActionSummary();
  var guardSummary = operatorCockpitCommitGuardNextActionSummary();

  if (normalizedId === 'control-validation') {
    return {
      title: '운영 가이드',
      cards: [
        renderCommandActionCard('검증 명령', validationSummary, '현재 packet 기준 최소 검증 루프입니다. 실패 시 이 묶음부터 다시 실행합니다.', 'validation'),
        renderCommandActionCard('커밋 가드 다음 행동', 'npm run commit:guard\nnpm run commit:guard:verify', 'verify/apply 가능 상태를 판단하는 즉시 기준입니다.', 'guard'),
        renderCommandActionCard('브랜치 액션', branchSummary, '검증 후 이어질 브랜치/커밋 흐름입니다.', 'branch'),
      ],
    };
  }

  if (normalizedId === 'control-complete') {
    return {
      title: '운영 가이드',
      cards: [
        renderCommandActionCard('브랜치 액션', branchSummary, '완료 보고 직전 권장 브랜치와 생성 명령입니다.', 'branch'),
        renderCommandActionCard('커밋 가드 다음 행동', 'npm run commit:guard\nnpm run commit:guard:verify', '커밋 후보를 열기 전에 해소해야 할 조건입니다.', 'guard'),
        renderCommandActionCard('검증 명령', validationSummary, '완료 직전 다시 확인할 검증 묶음입니다.', 'validation'),
      ],
    };
  }

  if (normalizedId === 'control-planning' || normalizedId === 'control-execution') {
    return {
      title: '운영 가이드',
      cards: [
        renderCommandActionCard('브랜치 액션', branchSummary, '실행 전후로 유지할 브랜치 기준입니다.', 'branch'),
        renderCommandActionCard('커밋 가드 다음 행동', 'npm run commit:guard\nnpm run commit:guard:verify', '지금 단계에서 필요한 readiness 판단입니다.', 'guard'),
      ],
    };
  }

  return null;
}

function renderOperatorGuideSection(guide) {
  if (!guide || !Array.isArray(guide.cards) || guide.cards.length < 1) {
    return '';
  }
  return '<section class="detail-section">' +
    '<div class="detail-section-title">' + escHtml(guide.title || '운영 가이드') + '</div>' +
    '<div class="detail-grid-cards">' + guide.cards.join('') + '</div>' +
    '</section>';
}

function normalizeOperatorActionHistory(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map(function(entry) {
    return {
      id: String(entry && entry.id || ''),
      action: String(entry && entry.action || 'unknown'),
      label: String(entry && entry.label || '명령'),
      scope: String(entry && entry.scope || ''),
      command: String(entry && entry.command || ''),
      delivery_status: String(entry && entry.delivery_status || 'unsent'),
      delivery_message: String(entry && entry.delivery_message || ''),
      delivery_ts: String(entry && entry.delivery_ts || ''),
      ts: String(entry && entry.ts || ''),
    };
  }).filter(function(entry) {
    return entry.id && entry.label && entry.command;
  }).slice(0, 6);
}

function loadOperatorActionHistory() {
  try {
    if (!window.sessionStorage) {
      return [];
    }
    var raw = window.sessionStorage.getItem(OPERATOR_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return normalizeOperatorActionHistory(JSON.parse(raw));
  } catch (error) {
    return [];
  }
}

function saveOperatorActionHistory(entries) {
  try {
    if (!window.sessionStorage) {
      return;
    }
    window.sessionStorage.setItem(OPERATOR_HISTORY_STORAGE_KEY, JSON.stringify(normalizeOperatorActionHistory(entries)));
  } catch (error) {
    return;
  }
}

function normalizeDeepLinkContext(context) {
  return {
    focus: String(context && context.focus || '').trim(),
    reason: String(context && context.reason || '').trim(),
    command: String(context && context.command || '').trim(),
    label: String(context && context.label || '').trim(),
    source: String(context && context.source || '').trim(),
  };
}

function hasDeepLinkContext(context) {
  var normalized = normalizeDeepLinkContext(context);
  return !!(normalized.focus || normalized.reason || normalized.command || normalized.label || normalized.source);
}

function loadStoredDeepLinkContext() {
  try {
    if (!window.sessionStorage) {
      return normalizeDeepLinkContext(null);
    }
    var raw = window.sessionStorage.getItem(DEEP_LINK_CONTEXT_STORAGE_KEY);
    if (!raw) {
      return normalizeDeepLinkContext(null);
    }
    return normalizeDeepLinkContext(JSON.parse(raw));
  } catch (error) {
    return normalizeDeepLinkContext(null);
  }
}

function saveDeepLinkContext(context) {
  try {
    if (!window.sessionStorage) {
      return;
    }
    var normalized = normalizeDeepLinkContext(context);
    if (!hasDeepLinkContext(normalized)) {
      window.sessionStorage.removeItem(DEEP_LINK_CONTEXT_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(DEEP_LINK_CONTEXT_STORAGE_KEY, JSON.stringify(normalized));
  } catch (error) {
    return;
  }
}

function syncRecentOperatorAction(payload) {
  var normalized = payload && typeof payload === 'object' ? payload : null;
  if (!normalized || !String(normalized.command || '').trim() || !String(normalized.label || '').trim()) {
    return Promise.resolve(null);
  }

  return fetchJson('/api/ui/operator-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: String(normalized.id || ''),
      action: String(normalized.action || 'unknown'),
      label: String(normalized.label || ''),
      scope: String(normalized.scope || ''),
      command: String(normalized.command || ''),
      delivery_status: String(normalized.delivery_status || 'unsent'),
      delivery_message: String(normalized.delivery_message || ''),
      delivery_ts: String(normalized.delivery_ts || ''),
      ts: String(normalized.ts || ''),
    }),
  }).catch(function() {
    return null;
  });
}

function rememberOperatorAction(action, payload) {
  var nextEntry = {
    id: String(Date.now()) + ':' + Math.random().toString(16).slice(2),
    action: String(action || 'unknown'),
    label: String(payload && payload.title || '명령'),
    scope: String(payload && payload.scope || ''),
    command: String(payload && payload.command || '').trim(),
    delivery_status: 'unsent',
    delivery_message: '실제 전송 전',
    delivery_ts: '',
    ts: new Date().toISOString(),
  };
  S.execution.operatorActionHistory = [nextEntry].concat(normalizeOperatorActionHistory(S.execution.operatorActionHistory)).slice(0, 6);
  saveOperatorActionHistory(S.execution.operatorActionHistory);
  syncRecentOperatorAction(nextEntry);
}

function markOperatorActionDelivery(commandText, deliveryStatus, deliveryMessage) {
  var command = String(commandText || '').trim();
  if (!command) {
    return;
  }
  var nextStatus = String(deliveryStatus || 'unsent').trim() || 'unsent';
  var nextMessage = String(deliveryMessage || '').trim();
  var updated = false;
  var nextHistory = normalizeOperatorActionHistory(S.execution.operatorActionHistory).map(function(entry) {
    if (updated || String(entry.command || '').trim() !== command) {
      return entry;
    }
    updated = true;
    return Object.assign({}, entry, {
      delivery_status: nextStatus,
      delivery_message: nextMessage,
      delivery_ts: new Date().toISOString(),
    });
  });
  if (!updated) {
    return;
  }
  S.execution.operatorActionHistory = nextHistory;
  saveOperatorActionHistory(S.execution.operatorActionHistory);
  syncRecentOperatorAction(nextHistory[0]);
}

function operatorActionDeliveryTone(status) {
  var value = String(status || 'unsent').trim();
  if (value === 'success') return 'pass';
  if (value === 'failed') return 'fail';
  return 'info';
}

function operatorActionDeliveryLabel(status) {
  var value = String(status || 'unsent').trim();
  if (value === 'success') return '성공';
  if (value === 'failed') return '실패';
  return '미전송';
}

function recentOperatorActionState() {
  var history = normalizeOperatorActionHistory(S.execution.operatorActionHistory);
  var latest = history[0] || null;
  if (!latest) {
    return {
      label: 'Action 대기',
      tone: 'info',
      summary: '최근 operator action 없음',
    };
  }
  var deliveryLabel = operatorActionDeliveryLabel(latest.delivery_status);
  var label = latest.delivery_status === 'success'
    ? 'Action 성공'
    : latest.delivery_status === 'failed'
      ? 'Action 실패'
      : 'Action 미전송';
  var summary = deliveryLabel + ' / ' + String(latest.label || '명령');
  if (String(latest.delivery_message || '').trim()) {
    summary += ' / ' + String(latest.delivery_message || '').trim();
  }
  return {
    label: label,
    tone: latest.delivery_status === 'success' ? 'ready' : latest.delivery_status === 'failed' ? 'blocked' : 'warn',
    summary: summary,
  };
}

function renderOperatorActionHistory() {
  var history = normalizeOperatorActionHistory(S.execution.operatorActionHistory);
  if (history.length < 1) {
    return '<div class="execution-operator-history-empty">아직 기록된 operator action 이력 없음</div>';
  }
  return '<div class="execution-operator-history">' + history.map(function(entry) {
    var tone = entry.action === 'copied' ? 'info' : 'focus';
    var meta = [entry.scope || 'scope 없음', entry.ts ? entry.ts.replace('T', ' ').slice(0, 16) : '시각 없음'].join(' / ');
    var deliveryMeta = operatorActionDeliveryLabel(entry.delivery_status)
      + (entry.delivery_ts ? ' / ' + entry.delivery_ts.replace('T', ' ').slice(0, 16) : '')
      + (entry.delivery_message ? ' / ' + entry.delivery_message : '');
    return '<div class="execution-operator-history-item">' +
      '<div class="execution-operator-history-head">' +
        '<strong>' + escHtml(entry.label) + '</strong>' +
        '<span class="execution-history-pill is-' + escHtml(tone) + '">' + escHtml(entry.action === 'copied' ? '복사' : '패널 반영') + '</span>' +
      '</div>' +
      '<div class="execution-operator-history-meta">' + escHtml(meta) + '</div>' +
      '<div class="execution-operator-history-meta"><span class="execution-history-pill is-' + escHtml(operatorActionDeliveryTone(entry.delivery_status)) + '">' + escHtml(operatorActionDeliveryLabel(entry.delivery_status)) + '</span> ' + escHtml(deliveryMeta) + '</div>' +
      '<div class="execution-operator-history-meta">' + escHtml(entry.command) + '</div>' +
      '<div class="execution-operator-history-actions">' +
        '<button type="button" class="detail-card-action secondary" onclick="replayOperatorActionCopy(\\'' + escHtml(entry.id) + '\\')">다시 복사</button>' +
        '<button type="button" class="detail-card-action primary" onclick="replayOperatorActionLoad(\\'' + escHtml(entry.id) + '\\')">다시 채우기</button>' +
      '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function mergeRecentOperatorActionFromRuntime(action) {
  if (!action || typeof action !== 'object') {
    return;
  }
  var normalized = normalizeOperatorActionHistory([action]);
  if (normalized.length < 1) {
    return;
  }
  var nextEntry = normalized[0];
  var history = normalizeOperatorActionHistory(S.execution.operatorActionHistory);
  var exists = history.some(function(entry) {
    return entry.id === nextEntry.id
      || (
        String(entry.command || '').trim() === String(nextEntry.command || '').trim()
        && String(entry.ts || '') === String(nextEntry.ts || '')
      );
  });
  if (exists) {
    return;
  }
  S.execution.operatorActionHistory = [nextEntry].concat(history).slice(0, 6);
  saveOperatorActionHistory(S.execution.operatorActionHistory);
}

function findOperatorActionHistoryEntry(entryId) {
  var targetId = String(entryId || '').trim();
  var history = normalizeOperatorActionHistory(S.execution.operatorActionHistory);
  for (var i = 0; i < history.length; i += 1) {
    if (history[i].id === targetId) {
      return history[i];
    }
  }
  return null;
}

function replayOperatorActionCopy(entryId) {
  var entry = findOperatorActionHistoryEntry(entryId);
  if (!entry) {
    showToast('재적용할 operator action 이력이 없습니다.');
    return;
  }
  copyTextToClipboard(entry.command)
    .then(function() {
      rememberOperatorAction('copied', {
        title: entry.label,
        scope: entry.scope,
        command: entry.command,
      });
      renderExecutionConsole();
      if (S.selected) renderPanel(S.selected);
      showToast(entry.label + ' 다시 복사 완료');
    })
    .catch(function() {
      showToast(entry.label + ' 다시 복사 실패');
    });
}

function replayOperatorActionLoad(entryId) {
  var entry = findOperatorActionHistoryEntry(entryId);
  if (!entry) {
    showToast('재적용할 operator action 이력이 없습니다.');
    return;
  }
  S.execution.promptText = entry.command;
  if (!String(S.execution.selectedPts || '').trim()) {
    var sessions = Array.isArray(S.execution.sessions) ? S.execution.sessions : [];
    if (sessions.length > 0) {
      S.execution.selectedPts = String(sessions[0].pts || '').trim();
    }
  }
  rememberOperatorAction('loaded', {
    title: entry.label,
    scope: entry.scope,
    command: entry.command,
  });
  setExecutionStatus('idle', entry.label + ' 다시 준비 완료', '이전 operator action 명령을 실행 패널에 다시 채웠습니다. 전송 전에 세션과 명령을 확인하세요.');
  renderExecutionConsole();
  if (S.selected) renderPanel(S.selected);
  showToast(entry.label + ' 다시 채우기 완료');
}

function deriveExecutionControlMatrix() {
  var sessionCount = Array.isArray(S.execution.sessions) ? S.execution.sessions.length : 0;
  var hasSessions = sessionCount > 0;
  var schedulerRunning = S.execution.schedulerRunning === true;
  var hasLastPrompt = Boolean(String(S.execution.lastPromptText || '').trim());
  var failureVisible = Boolean(S.execution.lastError && S.execution.lastError.error);

  return {
    send_prompt: {
      enabled: hasSessions,
      reason: hasSessions ? '연결된 PTY 세션으로 즉시 전송할 수 있습니다.' : '연결된 PTY 세션이 없어 전송할 수 없습니다.',
    },
    auto_send_toggle: {
      enabled: hasSessions,
      reason: hasSessions
        ? (schedulerRunning ? '자동 전송이 실행 중이며 중지로 전환할 수 있습니다.' : '선택한 세션과 프롬프트로 자동 전송을 시작할 수 있습니다.')
        : '연결된 PTY 세션이 없어 자동 전송을 제어할 수 없습니다.',
    },
    stop: {
      enabled: schedulerRunning,
      reason: schedulerRunning ? '현재 자동 전송이 실행 중이라 즉시 중지할 수 있습니다.' : '실행 중인 자동 전송이 없어 중지할 대상이 없습니다.',
    },
    retry_last_prompt: {
      enabled: hasLastPrompt,
      reason: hasLastPrompt ? '마지막 프롬프트가 기록되어 다시 실행할 수 있습니다.' : '마지막 프롬프트가 없어 재시도할 수 없습니다.',
    },
    rollback: {
      enabled: S.rollbackEnabled === true,
      reason: S.rollbackEnabled === true ? '도메인 롤백 UI가 활성화되어 있습니다.' : 'system_api.rollback_ui.enabled=false 상태라 롤백 UI가 비활성화되어 있습니다.',
    },
    terminal_status_visible: {
      enabled: true,
      reason: '현재 터미널, worker, 최근 실행 상태를 화면에 표시합니다.',
    },
    failure_reason_visible: {
      enabled: failureVisible,
      reason: failureVisible ? '최근 실패 원인을 바로 확인할 수 있습니다.' : '최근 실패가 없어 표시할 실패 원인이 없습니다.',
    },
  };
}

function normalizeExecutionControlMatrix(controlMatrix) {
  var fallback = deriveExecutionControlMatrix();
  if (!controlMatrix || typeof controlMatrix !== 'object') {
    return fallback;
  }

  var normalized = {};
  Object.keys(fallback).forEach(function(key) {
    var incoming = controlMatrix[key] || {};
    normalized[key] = {
      enabled: incoming.enabled === true,
      reason: String(incoming.reason || fallback[key].reason),
    };
  });
  return normalized;
}

function executionControlSummary() {
  var matrix = normalizeExecutionControlMatrix(S.execution.controlMatrix);
  return [
    '프롬프트 전송: ' + (matrix.send_prompt.enabled ? '가능' : '대기') + ' / ' + matrix.send_prompt.reason,
    '자동 전송: ' + (matrix.auto_send_toggle.enabled ? '가능' : '대기') + ' / ' + matrix.auto_send_toggle.reason,
    '중지: ' + (matrix.stop.enabled ? '가능' : '대기') + ' / ' + matrix.stop.reason,
    '재시도: ' + (matrix.retry_last_prompt.enabled ? '가능' : '대기') + ' / ' + matrix.retry_last_prompt.reason,
    '롤백: ' + (matrix.rollback.enabled ? '가능' : '대기') + ' / ' + matrix.rollback.reason,
  ].join('\n');
}

function normalizeStageRunReport(report) {
  if (!report || typeof report !== 'object') {
    return null;
  }

  var commandResults = Array.isArray(report.command_results) ? report.command_results : [];
  var failingCommand = commandResults.find(function(item) { return item && item.ok === false; }) || null;
  var unmetPrerequisites = Array.isArray(report.unmet_prerequisites) ? report.unmet_prerequisites : [];
  var recommendedCommands = Array.isArray(report.recommended_commands) ? report.recommended_commands : [];

  return {
    requested_stage: String(report.requested_stage || ''),
    requested_module: String(report.requested_module || ''),
    execution_mode: String(report.execution_mode || 'dry-run-only'),
    status: String(report.status || 'unknown'),
    quality_gate_result: String(report.quality_gate_result || ''),
    summary: String(report.summary || ''),
    docs_ref: String(report.docs_ref || ''),
    unmet_prerequisites: unmetPrerequisites,
    recommended_commands: recommendedCommands,
    failed_command: failingCommand ? String(failingCommand.command || '') : '',
    failed_detail: failingCommand ? String(failingCommand.stderr || failingCommand.stdout || '') : '',
    executed_command_count: Number(report.executed_command_count || 0),
    failed_command_count: Number(report.failed_command_count || 0),
    requirements_stage: String(report.requirements_stage || ''),
    recorded_at: String(report.recorded_at || ''),
  };
}

function sameStageRunReport(left, right) {
  if (!left || !right) {
    return false;
  }
  return String(left.requested_stage || '') === String(right.requested_stage || '')
    && String(left.requested_module || '') === String(right.requested_module || '')
    && String(left.execution_mode || '') === String(right.execution_mode || '')
    && String(left.recorded_at || '') === String(right.recorded_at || '');
}

function normalizeStageRunHistory(reports) {
  if (!Array.isArray(reports)) {
    return [];
  }
  var normalized = [];
  reports.forEach(function(report) {
    var entry = normalizeStageRunReport(report);
    if (!entry) {
      return;
    }
    var duplicated = normalized.some(function(existing) { return sameStageRunReport(existing, entry); });
    if (!duplicated) {
      normalized.push(entry);
    }
  });
  return normalized.slice(0, 5);
}

function rememberStageRunReport(report) {
  var entry = normalizeStageRunReport(report);
  if (!entry) {
    return;
  }
  var nextHistory = [entry].concat(normalizeStageRunHistory(S.stageRun.history).filter(function(existing) {
    return !sameStageRunReport(existing, entry);
  }));
  S.stageRun.history = nextHistory.slice(0, 5);
}

function deriveStageRunNextAction(report) {
  if (!report) {
    return 'Stage를 고른 뒤 dry-run으로 현재 경로를 먼저 확인하세요.';
  }
  if (report.status === 'blocked' && report.unmet_prerequisites.length > 0) {
    return '선행 Stage ' + report.unmet_prerequisites.join(', ') + '를 먼저 PASS 상태로 만든 뒤 다시 실행하세요.';
  }
  if (report.status === 'out-of-route') {
    return 'requirements stage 경로와 현재 packet 단계를 확인한 뒤 다시 dry-run 하세요.';
  }
  if (report.execution_mode === 'execute' && report.status === 'fail') {
    return report.failed_command
      ? '실패 명령을 수정한 뒤 마지막 stage 재실행을 누르세요.'
      : '실패 원인을 해소한 뒤 마지막 stage 재실행을 누르세요.';
  }
  if (report.execution_mode === 'execute' && report.status === 'pass') {
    return '품질 게이트 결과를 확인하고 다음 Stage 또는 운영 증거 생성으로 이동하세요.';
  }
  if (report.status === 'ready') {
    return 'dry-run 결과를 검토한 뒤 execute 실행 여부를 결정하세요.';
  }
  return '현재 결과를 검토하고 필요한 Stage를 다시 실행하세요.';
}

function stageRunSummaryText(report) {
  if (!report) {
    return '최근 stage 실행 없음';
  }
  return [
    'Stage ' + (report.requested_stage || '-'),
    report.execution_mode === 'execute' ? 'execute' : 'dry-run',
    report.status || 'unknown',
    report.quality_gate_result || 'gate 미실행',
  ].join(' / ');
}

function stageRunFailureLocation(report) {
  if (!report) {
    return '없음';
  }
  var stage = String(report.requested_stage || '-');
  var moduleId = String(report.requested_module || '').trim() || '전체';
  return 'Stage ' + stage + ' / module ' + moduleId;
}

function stageRunFailureReason(report) {
  if (!report) {
    return '없음';
  }
  if (String(report.failed_detail || '').trim()) {
    return String(report.failed_detail || '').trim();
  }
  if (String(report.summary || '').trim()) {
    return String(report.summary || '').trim();
  }
  if (report.status === 'blocked') {
    return '선행 조건 미충족';
  }
  if (report.status === 'out-of-route') {
    return '요구사항 stage 경로 불일치';
  }
  return '원인 기록 없음';
}

function stageRunFailureBadgeMarkup(report, historyIndex) {
  if (!report) {
    return '';
  }
  return stageRunFailureBadgeMarkupWithHandler(report, historyIndex, 'focusStageRunFailureSignal');
}

function stageRunFailureBadgeMarkupWithHandler(report, historyIndex, handlerName) {
  if (!report) {
    return '';
  }
  var badges = [];
  var entryIndex = Number.isInteger(historyIndex) ? historyIndex : -1;
  var clickHandlerName = String(handlerName || 'focusStageRunFailureSignal').trim() || 'focusStageRunFailureSignal';
  if (String(report.failed_command || '').trim()) {
    badges.push('<button type="button" class="execution-history-pill is-fail is-action" onclick="' + clickHandlerName + "('failed_command'," + entryIndex + ')">실패 명령: ' + escHtml(String(report.failed_command || '').trim()) + '</button>');
  }
  if (Array.isArray(report.unmet_prerequisites) && report.unmet_prerequisites.length > 0) {
    badges.push('<button type="button" class="execution-history-pill is-blocked is-action" onclick="' + clickHandlerName + "('prerequisites'," + entryIndex + ')">선행 조건: ' + escHtml(report.unmet_prerequisites.join(', ')) + '</button>');
  }
  if (badges.length < 1) {
    return '';
  }
  return '<div class="execution-failure-badges">' + badges.join('') + '</div>';
}

function stageRunSignalValue(report, signalType) {
  if (!report) {
    return '';
  }
  if (signalType === 'failed_command') {
    return String(report.failed_command || '').trim();
  }
  if (signalType === 'prerequisites') {
    return Array.isArray(report.unmet_prerequisites) ? report.unmet_prerequisites.join(', ') : '';
  }
  return '';
}

function matchingStageRunHistoryIndexes(signalType, signalValue) {
  var expectedValue = String(signalValue || '').trim();
  if (!expectedValue) {
    return [];
  }
  return normalizeStageRunHistory(S.stageRun.history).map(function(report, index) {
    return {
      index: index,
      value: stageRunSignalValue(report, signalType),
    };
  }).filter(function(entry) {
    return String(entry.value || '').trim() === expectedValue;
  }).map(function(entry) {
    return entry.index;
  });
}

function focusStageRunFailureSignal(signalType, historyIndex) {
  S.stageRun.historyFilter = 'failures';
  S.stageRun.historySort = 'risk-first';
  if (Number.isInteger(historyIndex) && historyIndex >= 0) {
    var history = normalizeStageRunHistory(S.stageRun.history);
    var report = history[historyIndex] || null;
    if (report) {
      var signalValue = stageRunSignalValue(report, signalType);
      var matchedIndexes = matchingStageRunHistoryIndexes(signalType, signalValue);
      S.stageRun.focusedSignalType = String(signalType || '');
      S.stageRun.focusedSignalValue = signalValue;
      S.stageRun.historySignalView = 'all';
      S.stageRun.historySignalCollapsed = false;
      S.stageRun.matchedHistoryIndexes = matchedIndexes;
      S.stageRun.matchedHistoryCursor = matchedIndexes.indexOf(historyIndex);
      restoreStageRunHistorySelection(report);
      setStageRunHistoryHighlight(historyIndex);
      return;
    }
  }
  S.stageRun.focusedSignalType = String(signalType || '');
  S.stageRun.focusedSignalValue = '';
  S.stageRun.historySignalView = 'all';
  S.stageRun.historySignalCollapsed = false;
  S.stageRun.matchedHistoryIndexes = [];
  S.stageRun.matchedHistoryCursor = -1;
  setExecutionStatus(
    'idle',
    signalType === 'prerequisites' ? '선행 조건 기준으로 실패 이력 집중' : '실패 명령 기준으로 실패 이력 집중',
    '실패/차단 이력만 보이도록 좁혔습니다. 필요한 항목을 선택해 dry-run 또는 execute를 다시 실행하세요.',
  );
}

function focusPinnedStageRunFailureSignal(signalType, historyIndex) {
  focusStageRunFailureSignal(signalType, historyIndex);
  if (!Number.isInteger(historyIndex) || historyIndex < 0) {
    return;
  }
  var indexes = Array.isArray(S.stageRun.matchedHistoryIndexes) ? S.stageRun.matchedHistoryIndexes : [];
  if (indexes.length < 1 || indexes.indexOf(historyIndex) < 0) {
    return;
  }
  S.stageRun.historySignalView = 'matched';
  S.stageRun.historySignalCollapsed = true;
  setExecutionStatus(
    'idle',
    signalType === 'prerequisites' ? '헤더 선행 조건 기준 단일 고정' : '헤더 실패 명령 기준 단일 고정',
    '현재 포커스 카드 헤더에서 선택한 실패 신호만 남기고 단일 이력으로 고정했습니다. 필요하면 같은 신호 펼치기로 나머지 이력을 다시 확인하세요.',
  );
}

function focusFailedCommandSignal(historyIndex) {
  focusStageRunFailureSignal('failed_command', historyIndex);
}

function focusPrerequisitesSignal(historyIndex) {
  focusStageRunFailureSignal('prerequisites', historyIndex);
}

function pinFailedCommandSignal(historyIndex) {
  focusPinnedStageRunFailureSignal('failed_command', historyIndex);
}

function pinPrerequisitesSignal(historyIndex) {
  focusPinnedStageRunFailureSignal('prerequisites', historyIndex);
}

function stepStageRunFailureMatch(direction) {
  var indexes = Array.isArray(S.stageRun.matchedHistoryIndexes) ? S.stageRun.matchedHistoryIndexes : [];
  if (indexes.length < 2) {
    setExecutionStatus('warning', '매칭 이력 부족', '같은 실패 신호를 가진 다른 이력이 없어 이동할 수 없습니다.');
    return;
  }
  var cursor = Number.isInteger(S.stageRun.matchedHistoryCursor) ? S.stageRun.matchedHistoryCursor : 0;
  var nextCursor = cursor + (direction === 'prev' ? -1 : 1);
  if (nextCursor < 0) {
    nextCursor = indexes.length - 1;
  } else if (nextCursor >= indexes.length) {
    nextCursor = 0;
  }
  var nextIndex = indexes[nextCursor];
  var history = normalizeStageRunHistory(S.stageRun.history);
  var report = history[nextIndex] || null;
  if (!report) {
    setExecutionStatus('warning', '매칭 이력 이동 실패', '다음으로 이동할 이력을 찾을 수 없습니다.');
    return;
  }
  S.stageRun.matchedHistoryCursor = nextCursor;
  restoreStageRunHistorySelection(report);
  setExecutionStatus('idle', direction === 'prev' ? '이전 매칭 이력으로 이동' : '다음 매칭 이력으로 이동', '같은 실패 신호를 가진 다른 이력으로 이동했습니다.');
  setStageRunHistoryHighlight(nextIndex);
}

function setStageRunHistoryHighlight(historyIndex) {
  S.stageRun.highlightedHistoryIndex = Number.isInteger(historyIndex) ? historyIndex : -1;
  renderExecutionConsole();
  if (!Number.isInteger(historyIndex) || historyIndex < 0 || typeof document === 'undefined') {
    return;
  }
  setTimeout(function() {
    var target = document.getElementById('execution-history-item-' + historyIndex);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, 0);
}

function stageRunHistoryTone(report) {
  if (!report) {
    return 'unknown';
  }
  if (report.status === 'pass') {
    return 'pass';
  }
  if (report.status === 'fail') {
    return 'fail';
  }
  if (report.status === 'blocked') {
    return 'blocked';
  }
  if (report.status === 'out-of-route') {
    return 'out-of-route';
  }
  return 'ready';
}

function matchesStageRunHistoryFilter(report, filter) {
  if (!report) {
    return false;
  }
  if (filter === 'failures') {
    return report.status === 'fail' || report.status === 'blocked' || report.status === 'out-of-route';
  }
  if (filter === 'execute') {
    return report.execution_mode === 'execute';
  }
  return true;
}

function stageRunHistoryPriority(report) {
  if (!report) {
    return 99;
  }
  if (report.status === 'fail') {
    return 0;
  }
  if (report.status === 'blocked' || report.status === 'out-of-route') {
    return 1;
  }
  if (report.execution_mode === 'execute') {
    return 2;
  }
  if (report.status === 'ready') {
    return 3;
  }
  if (report.status === 'pass') {
    return 4;
  }
  return 5;
}

function compareStageRunHistoryEntries(left, right, sortMode) {
  var leftReport = left && left.report ? left.report : null;
  var rightReport = right && right.report ? right.report : null;
  if (sortMode === 'recent-first') {
    return String(rightReport && rightReport.recorded_at || '').localeCompare(String(leftReport && leftReport.recorded_at || ''));
  }
  var priorityDiff = stageRunHistoryPriority(leftReport) - stageRunHistoryPriority(rightReport);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  return String(rightReport && rightReport.recorded_at || '').localeCompare(String(leftReport && leftReport.recorded_at || ''));
}

function firstStageRunFailureEntry(entries) {
  if (!Array.isArray(entries)) {
    return null;
  }
  var failureEntries = entries.filter(function(entry) {
    return stageRunHistoryPriority(entry && entry.report) <= 1;
  });
  if (failureEntries.length < 1) {
    return null;
  }
  return failureEntries.sort(function(left, right) {
    return compareStageRunHistoryEntries(left, right, 'risk-first');
  })[0] || null;
}

function stageRunMatchedSignalSummary() {
  var indexes = Array.isArray(S.stageRun.matchedHistoryIndexes) ? S.stageRun.matchedHistoryIndexes : [];
  var cursor = Number.isInteger(S.stageRun.matchedHistoryCursor) ? S.stageRun.matchedHistoryCursor : -1;
  if (indexes.length < 2 || cursor < 0) {
    return '';
  }
  return (cursor + 1) + ' / ' + indexes.length;
}

function stageRunMatchedCountLabel() {
  var indexes = Array.isArray(S.stageRun.matchedHistoryIndexes) ? S.stageRun.matchedHistoryIndexes : [];
  if (indexes.length < 2) {
    return '';
  }
  return '매칭 ' + indexes.length + '건';
}

function stageRunSecondaryMatchCountLabel() {
  var indexes = Array.isArray(S.stageRun.matchedHistoryIndexes) ? S.stageRun.matchedHistoryIndexes : [];
  if (indexes.length < 2) {
    return '';
  }
  return Math.max(0, indexes.length - 1) + '건';
}

function stageRunQualityGateTone(report) {
  var gate = String(report && report.quality_gate_result || '').trim().toLowerCase();
  if (!gate) {
    return 'info';
  }
  if (gate.indexOf('pass') >= 0) {
    return 'pass';
  }
  if (gate.indexOf('fail') >= 0) {
    return 'fail';
  }
  return 'info';
}

function stageRunFocusedSignalLabel() {
  if (S.stageRun.focusedSignalType === 'failed_command' && String(S.stageRun.focusedSignalValue || '').trim()) {
    return '실패 명령 / ' + String(S.stageRun.focusedSignalValue || '').trim();
  }
  if (S.stageRun.focusedSignalType === 'prerequisites' && String(S.stageRun.focusedSignalValue || '').trim()) {
    return '선행 조건 / ' + String(S.stageRun.focusedSignalValue || '').trim();
  }
  return '';
}

function pinStageRunFocusedEntry(entries) {
  if (!Array.isArray(entries) || entries.length < 2 || !Number.isInteger(S.stageRun.highlightedHistoryIndex) || S.stageRun.highlightedHistoryIndex < 0) {
    return Array.isArray(entries) ? entries : [];
  }
  var pinned = entries.find(function(entry) {
    return entry.index === S.stageRun.highlightedHistoryIndex;
  }) || null;
  if (!pinned) {
    return entries;
  }
  return [pinned].concat(entries.filter(function(entry) {
    return entry.index !== pinned.index;
  }));
}

function renderStageRunWorkbench() {
  var report = normalizeStageRunReport(S.stageRun.lastReport);
  var history = normalizeStageRunHistory(S.stageRun.history);
  var historyFilter = String(S.stageRun.historyFilter || 'all').trim() || 'all';
  var historySignalView = String(S.stageRun.historySignalView || 'all').trim() || 'all';
  var historySignalCollapsed = S.stageRun.historySignalCollapsed === true;
  var historySort = String(S.stageRun.historySort || 'risk-first').trim() || 'risk-first';
  var historyEntries = history.map(function(item, index) {
    return { report: item, index: index };
  });
  var filteredHistory = historyEntries.filter(function(entry) {
    return matchesStageRunHistoryFilter(entry.report, historyFilter);
  }).filter(function(entry) {
    if (historySignalView !== 'matched') {
      return true;
    }
    return Array.isArray(S.stageRun.matchedHistoryIndexes) && S.stageRun.matchedHistoryIndexes.indexOf(entry.index) >= 0;
  }).filter(function(entry) {
    if (historySignalView !== 'matched' || historySignalCollapsed !== true) {
      return true;
    }
    return entry.index === S.stageRun.highlightedHistoryIndex;
  }).sort(function(left, right) {
    return compareStageRunHistoryEntries(left, right, historySort);
  });
  if (historySignalView === 'matched' && historySignalCollapsed !== true) {
    filteredHistory = pinStageRunFocusedEntry(filteredHistory);
  }
  var failureFocusEntry = firstStageRunFailureEntry(historyEntries);
  var stages = Array.isArray(S.stageRun.supportedStages) && S.stageRun.supportedStages.length > 0
    ? S.stageRun.supportedStages
    : ['A', 'B', 'C', 'D', 'E'];
  var stageOptions = stages.map(function(stage) {
    return '<option value="' + escHtml(stage) + '"' + (String(S.stageRun.selectedStage || '') === stage ? ' selected' : '') + '>'
      + escHtml('Stage ' + stage) + '</option>';
  }).join('');
  var retryDisabled = !S.stageRun.lastRequest;
  var failedCommandLabel = report && report.failed_command ? report.failed_command : '없음';
  var unmetLabel = report && report.unmet_prerequisites.length > 0 ? report.unmet_prerequisites.join(', ') : '없음';
  var commandsLabel = report && report.recommended_commands.length > 0 ? report.recommended_commands.join('\n') : '없음';
  var nextActionLabel = deriveStageRunNextAction(report);
  var moduleLabel = report && report.requested_module ? report.requested_module : (String(S.stageRun.selectedModule || '').trim() || '전체');
  var recordedAtLabel = report && report.recorded_at ? report.recorded_at : '없음';
  var historyFilterMarkup = '<div class="execution-actions">' +
      '<button type="button" class="execution-button secondary' + (historyFilter === 'all' ? ' is-active' : '') + '" onclick="setStageRunHistoryFilter(' + "'all'" + ')">전체 보기</button>' +
      '<button type="button" class="execution-button secondary' + (historyFilter === 'failures' ? ' is-active' : '') + '" onclick="setStageRunHistoryFilter(' + "'failures'" + ')">실패/차단만</button>' +
      '<button type="button" class="execution-button secondary' + (historyFilter === 'execute' ? ' is-active' : '') + '" onclick="setStageRunHistoryFilter(' + "'execute'" + ')">execute만</button>' +
    '</div>';
  var historySortMarkup = '<div class="execution-actions">' +
      '<button type="button" class="execution-button secondary' + (historySort === 'risk-first' ? ' is-active' : '') + '" onclick="setStageRunHistorySort(' + "'risk-first'" + ')">실패 우선 정렬</button>' +
      '<button type="button" class="execution-button secondary' + (historySort === 'recent-first' ? ' is-active' : '') + '" onclick="setStageRunHistorySort(' + "'recent-first'" + ')">최신순 정렬</button>' +
    '</div>';
  var highlightedHistoryEntry = historyEntries.find(function(entry) {
    return entry.index === S.stageRun.highlightedHistoryIndex;
  }) || null;
  var highlightedHistoryReport = highlightedHistoryEntry && highlightedHistoryEntry.report ? highlightedHistoryEntry.report : null;
  var pinnedHistoryHeaderMarkup = '';
  if (historySignalView === 'matched' && historySignalCollapsed !== true && highlightedHistoryReport) {
    var pinnedSecondaryLabel = stageRunSecondaryMatchCountLabel();
    var pinnedExecutionModeLabel = highlightedHistoryReport.execution_mode === 'execute' ? 'execute' : 'dry-run';
    var pinnedQualityGateLabel = highlightedHistoryReport.quality_gate_result || '미실행';
    pinnedHistoryHeaderMarkup = '<div class="execution-history-anchor">' +
      '<div class="execution-failure-badges">' +
        '<span class="execution-history-pill is-focus">현재 포커스 카드</span>' +
        '<span class="execution-history-pill is-info">상단 고정</span>' +
        '<span class="execution-history-pill is-info">' + escHtml(pinnedExecutionModeLabel) + '</span>' +
        '<span class="execution-history-pill is-' + escHtml(stageRunQualityGateTone(highlightedHistoryReport)) + '">gate ' + escHtml(pinnedQualityGateLabel) + '</span>' +
        (pinnedSecondaryLabel ? '<span class="execution-history-pill is-info">보조 이력 ' + escHtml(pinnedSecondaryLabel) + '</span>' : '') +
      '</div>' +
      '<strong>' + escHtml(stageRunSummaryText(highlightedHistoryReport)) + '</strong>' +
      stageRunFailureBadgeMarkupWithHandler(highlightedHistoryReport, highlightedHistoryEntry.index, 'focusPinnedStageRunFailureSignal') +
      '<div class="execution-history-meta">' + escHtml('같은 신호 그룹에서 현재 포커스 이력을 최상단에 고정했습니다.') + '</div>' +
      '<div class="execution-history-actions">' +
        '<button type="button" class="execution-button secondary" onclick="rerunStageHistory(' + highlightedHistoryEntry.index + ', false)">현재 포커스 dry-run</button>' +
        '<button type="button" class="execution-button warn" onclick="rerunStageHistory(' + highlightedHistoryEntry.index + ', true)">현재 포커스 execute</button>' +
      '</div>' +
    '</div>';
  }
  var failureFocusMarkup = '';
  if (failureFocusEntry && failureFocusEntry.report) {
    var focusReport = failureFocusEntry.report;
    var matchedSignalSummary = stageRunMatchedSignalSummary();
    var matchedCountLabel = stageRunMatchedCountLabel();
    var secondaryMatchCountLabel = stageRunSecondaryMatchCountLabel();
    var focusedSignalLabel = stageRunFocusedSignalLabel();
    var highlightedEntry = historyEntries.find(function(entry) {
      return entry.index === S.stageRun.highlightedHistoryIndex;
    }) || null;
    var highlightedReport = highlightedEntry && highlightedEntry.report ? highlightedEntry.report : null;
    var focusSummary = stageRunSummaryText(focusReport);
    var focusMeta = [
      'module: ' + (focusReport.requested_module || '전체'),
      '기록 시각: ' + (focusReport.recorded_at || '없음'),
      '실패 명령: ' + (focusReport.failed_command || '없음'),
      '다음 행동: ' + deriveStageRunNextAction(focusReport),
    ].join('\n');
    failureFocusMarkup = '<div class="execution-failure-focus">' +
      '<div class="execution-failure-badges">' +
        '<span class="execution-history-pill is-' + escHtml(stageRunHistoryTone(focusReport)) + '">최근 실패 우선</span>' +
        (matchedCountLabel ? '<span class="execution-history-pill is-info">' + escHtml(matchedCountLabel) + '</span>' : '') +
        (matchedSignalSummary && highlightedReport ? '<span class="execution-history-pill is-focus">현재 포커스</span>' : '') +
      '</div>' +
      '<strong>' + escHtml(focusSummary) + '</strong>' +
      stageRunFailureBadgeMarkup(focusReport, failureFocusEntry.index) +
      (matchedSignalSummary ? '<div class="execution-row"><span>같은 신호 탐색</span><strong>' + escHtml(matchedSignalSummary) + '</strong></div>' : '') +
      (focusedSignalLabel ? '<div class="execution-row"><span>탐색 기준</span><strong>' + escHtml(focusedSignalLabel) + '</strong></div>' : '') +
      (matchedSignalSummary && highlightedReport ? '<div class="execution-row"><span>현재 포커스 이력</span><strong>' + escHtml(stageRunSummaryText(highlightedReport)) + '</strong></div>' : '') +
      (matchedSignalSummary && highlightedReport ? '<div class="execution-row"><span>현재 포커스 배치</span><strong>' + escHtml(historySignalCollapsed ? '단일 고정' : '상단 고정') + '</strong></div>' : '') +
      (secondaryMatchCountLabel ? '<div class="execution-row"><span>보조 이력</span><strong>' + escHtml(secondaryMatchCountLabel) + '</strong></div>' : '') +
      (matchedSignalSummary ? '<div class="execution-actions">' +
        '<button type="button" class="execution-button secondary' + (historySignalView === 'matched' ? ' is-active' : '') + '" onclick="setStageRunSignalHistoryView(' + "'matched'" + ')">같은 신호만 보기</button>' +
        '<button type="button" class="execution-button secondary' + (historySignalView === 'all' ? ' is-active' : '') + '" onclick="setStageRunSignalHistoryView(' + "'all'" + ')">전체 이력 복원</button>' +
      '</div>' : '') +
      (matchedSignalSummary ? '<div class="execution-actions">' +
        '<button type="button" class="execution-button secondary' + (historySignalCollapsed ? ' is-active' : '') + '" onclick="setStageRunSignalGroupCollapsed(true)">같은 신호 접기</button>' +
        '<button type="button" class="execution-button secondary' + (!historySignalCollapsed ? ' is-active' : '') + '" onclick="setStageRunSignalGroupCollapsed(false)">같은 신호 펼치기</button>' +
      '</div>' : '') +
      '<div class="execution-actions">' +
        '<button type="button" class="execution-button secondary" onclick="focusFailedCommandSignal(' + failureFocusEntry.index + ')">실패 명령 기준</button>' +
        '<button type="button" class="execution-button secondary" onclick="focusPrerequisitesSignal(' + failureFocusEntry.index + ')">선행 조건 기준</button>' +
        '<button type="button" class="execution-button secondary" onclick="pinFailedCommandSignal(' + failureFocusEntry.index + ')">핀 실패 명령</button>' +
        '<button type="button" class="execution-button secondary" onclick="pinPrerequisitesSignal(' + failureFocusEntry.index + ')">핀 선행 조건</button>' +
      '</div>' +
      '<div class="execution-row"><span>실패 위치</span><strong>' + escHtml(stageRunFailureLocation(focusReport)) + '</strong></div>' +
      '<div class="execution-row"><span>실패 원인</span><strong>' + escHtml(stageRunFailureReason(focusReport)) + '</strong></div>' +
      '<div class="execution-row"><span>가능한 다음 행동</span><strong>' + escHtml(deriveStageRunNextAction(focusReport)) + '</strong></div>' +
      '<div class="execution-history-meta">' + escHtml(focusMeta) + '</div>' +
      (matchedSignalSummary ? '<div class="execution-history-actions">' +
        '<button type="button" class="execution-button secondary" onclick="stepStageRunFailureMatch(' + "'prev'" + ')">이전 매칭</button>' +
        '<button type="button" class="execution-button secondary" onclick="stepStageRunFailureMatch(' + "'next'" + ')">다음 매칭</button>' +
      '</div>' : '') +
      '<div class="execution-history-actions">' +
        '<button type="button" class="execution-button secondary" onclick="reuseStageRunHistory(' + failureFocusEntry.index + ')">첫 실패 불러오기</button>' +
        '<button type="button" class="execution-button secondary" onclick="rerunStageHistory(' + failureFocusEntry.index + ', false)">첫 실패 dry-run</button>' +
        '<button type="button" class="execution-button warn" onclick="rerunStageHistory(' + failureFocusEntry.index + ', true)">첫 실패 execute</button>' +
      '</div>' +
    '</div>';
  }
  var historySummaryLabel = '표시 ' + filteredHistory.length + ' / 전체 ' + history.length + ' / 정렬 ' + (historySort === 'risk-first' ? '실패 우선' : '최신순') + (historySignalView === 'matched' ? ' / 같은 신호만' : '') + (historySignalView === 'matched' && historySignalCollapsed ? ' / 그룹 접힘' : '');
  var historyMarkup = history.length > 0
    ? failureFocusMarkup + historyFilterMarkup + historySortMarkup + '<div class="execution-row"><span>표시 개수</span><strong>' + escHtml(historySummaryLabel) + '</strong></div>' + pinnedHistoryHeaderMarkup
      + (filteredHistory.length > 0
        ? '<div class="execution-history-list">' + filteredHistory.map(function(entry) {
      var item = entry.report;
      var itemSummary = stageRunSummaryText(item);
      var itemTone = stageRunHistoryTone(item);
      var itemNextAction = deriveStageRunNextAction(item);
      var isHighlightedEntry = S.stageRun.highlightedHistoryIndex === entry.index;
      var isMatchedEntry = Array.isArray(S.stageRun.matchedHistoryIndexes) && S.stageRun.matchedHistoryIndexes.indexOf(entry.index) >= 0;
      var itemMeta = [
        'module: ' + (item.requested_module || '전체'),
        '기록 시각: ' + (item.recorded_at || '없음'),
        '실패 명령: ' + (item.failed_command || '없음'),
        '다음 행동: ' + itemNextAction,
      ].join('\n');
      return '<div id="execution-history-item-' + entry.index + '" class="execution-history-item is-' + escHtml(itemTone) + (isHighlightedEntry ? ' is-highlighted' : '') + '">' +
        '<div class="execution-failure-badges">' +
          '<span class="execution-history-pill is-' + escHtml(itemTone) + '">' + escHtml(item.status || 'ready') + '</span>' +
          (isMatchedEntry ? '<span class="execution-history-pill is-info">같은 신호</span>' : '') +
          (isHighlightedEntry ? '<span class="execution-history-pill is-focus">현재 포커스</span>' : '') +
        '</div>' +
        '<strong>' + escHtml(itemSummary) + '</strong>' +
        '<div class="execution-history-meta">' + escHtml(itemMeta) + '</div>' +
        '<div class="execution-history-actions">' +
          '<button type="button" class="execution-button secondary" onclick="reuseStageRunHistory(' + entry.index + ')">이 기록 불러오기</button>' +
          '<button type="button" class="execution-button secondary" onclick="rerunStageHistory(' + entry.index + ', false)">dry-run 재실행</button>' +
          '<button type="button" class="execution-button warn" onclick="rerunStageHistory(' + entry.index + ', true)">execute 재실행</button>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>'
        : '<strong>현재 필터에 맞는 최근 stage 이력 없음</strong>')
    : '<strong>최근 stage 이력 없음</strong>';

  return '<div class="execution-row">' +
      '<span>Stage 실행</span>' +
      '<div class="execution-grid">' +
        '<div class="execution-row"><span>선택 Stage</span><select id="execution-stage-select" class="execution-select" onchange="syncStageRunInputs()">' + stageOptions + '</select></div>' +
        '<div class="execution-row"><span>대상 module</span><input id="execution-stage-module" class="execution-select" value="' + escHtml(S.stageRun.selectedModule || '') + '" placeholder="예: billing 또는 task-management" oninput="syncStageRunInputs()"></div>' +
        '<div class="execution-actions">' +
          '<button type="button" class="execution-button secondary" onclick="runSelectedStage(false)">Stage dry-run</button>' +
          '<button type="button" class="execution-button warn" onclick="runSelectedStage(true)">Stage execute</button>' +
          '<button type="button" class="execution-button secondary" onclick="retryLastStageRun()"' + htmlDisabled(retryDisabled) + '>마지막 stage 재실행</button>' +
        '</div>' +
        '<div class="execution-row"><span>최근 결과</span><strong>' + escHtml(stageRunSummaryText(report)) + '</strong></div>' +
        '<div class="execution-row"><span>기록 module</span><strong>' + escHtml(moduleLabel) + '</strong></div>' +
        '<div class="execution-row"><span>기록 시각</span><strong>' + escHtml(recordedAtLabel) + '</strong></div>' +
        '<div class="execution-row"><span>품질 게이트</span><strong>' + escHtml(report ? (report.quality_gate_result || '미실행') : '미실행') + '</strong></div>' +
        '<div class="execution-row"><span>선행 조건 미충족</span><strong>' + escHtml(unmetLabel) + '</strong></div>' +
        '<div class="execution-row"><span>실패 명령</span><strong>' + escHtml(failedCommandLabel) + '</strong></div>' +
        '<div class="execution-row"><span>권장 명령</span><strong>' + escHtml(commandsLabel) + '</strong></div>' +
        '<div class="execution-row"><span>다음 행동</span><strong>' + escHtml(nextActionLabel) + '</strong></div>' +
        '<div class="execution-row"><span>최근 이력</span>' + historyMarkup + '</div>' +
        '<div class="execution-row"><span>참조 문서</span><strong>' + escHtml(report ? (report.docs_ref || '없음') : '없음') + '</strong></div>' +
        '<div class="execution-row"><span>상세</span><strong>' + escHtml(report ? (report.failed_detail || report.summary || '상세 없음') : (S.stageRun.statusDetail || '상세 없음')) + '</strong></div>' +
      '</div>' +
    '</div>';
}

function rollbackDomainNodes() {
  return S.nodes.filter(function(node) { return node.type === 'domain'; });
}

function selectedRollbackDomain() {
  var domainId = String(S.execution.rollbackTargetDomain || '').trim();
  if (!domainId) {
    return null;
  }
  var nodes = rollbackDomainNodes();
  for (var i = 0; i < nodes.length; i++) {
    if (String(nodes[i].id || '') === domainId) {
      return nodes[i];
    }
  }
  return null;
}

function selectedExecutionWorkerLabel() {
  var selectedWorkerIndex = Number.isInteger(S.execution.selectedWorkerIndex) ? S.execution.selectedWorkerIndex : 0;
  var selectedWorker = Array.isArray(S.execution.schedulerWorkers) ? S.execution.schedulerWorkers[selectedWorkerIndex] || null : null;
  return selectedWorker ? executionWorkerLabel(selectedWorker, selectedWorkerIndex) : '없음';
}

function rollbackModalSummary(domainNode) {
  var domainLabel = domainNode ? String(domainNode.label || domainNode.id || '없음') : '없음';
  var currentExecution = executionCurrentSummary();
  var parts = [
    '선택 도메인: ' + domainLabel,
    '선택 worker: ' + selectedExecutionWorkerLabel(),
  ];
  if (currentExecution && currentExecution !== '없음') {
    parts.push('현재 실행: ' + currentExecution);
  }
  return parts.join(' · ') + '. 이 도메인의 모든 피처 플래그를 비활성화합니다. 이 작업은 즉시 적용됩니다.';
}

function rollbackModalContextEntries(domainNode) {
  var domainLabel = domainNode ? String(domainNode.label || domainNode.id || '없음') : '없음';
  return [
    { label: '선택 도메인', value: domainLabel },
    { label: '선택 worker', value: selectedExecutionWorkerLabel() },
    { label: '현재 실행', value: executionCurrentSummary() || '없음' },
  ];
}

function rollbackModalMarkup(domainNode) {
  var entries = rollbackModalContextEntries(domainNode);
  return '<div class="modal-warning-box">이 롤백은 즉시 적용되며 되돌리기 전까지 유지됩니다.</div>'
    + '<div class="modal-context-list">'
    + entries.map(function(entry) {
      return '<div class="modal-context-row">'
        + '<span class="modal-context-label">' + escHtml(entry.label || '') + '</span>'
        + '<strong class="modal-context-value">' + escHtml(entry.value || '없음') + '</strong>'
        + '</div>';
    }).join('')
    + '</div>'
    + '<div class="modal-warning-note">' + escHtml(rollbackModalSummary(domainNode)) + '</div>';
}

function rollbackModalValidationState() {
  var modal = document.getElementById('confirm-modal');
  var modalTargetId = modal && modal.dataset ? String(modal.dataset.target || '').trim() : '';
  if (!modalTargetId) {
    return { ok: false, message: '롤백 대상이 없어 확인할 수 없습니다.' };
  }
  var modalTarget = S.byId[modalTargetId];
  if (!modalTarget || modalTarget.type !== 'domain') {
    return { ok: false, message: '롤백 대상 도메인이 더 이상 유효하지 않습니다.' };
  }
  var selectedTarget = selectedRollbackDomain();
  if (!selectedTarget) {
    return { ok: false, message: '현재 화면에서 롤백 대상이 선택되지 않아 확인 버튼을 잠급니다.' };
  }
  if (String(selectedTarget.id || '') !== modalTargetId) {
    return {
      ok: false,
      message: '현재 선택된 롤백 대상과 확인 대상이 달라 다시 선택 확인이 필요합니다.',
    };
  }
  return {
    ok: true,
    message: '현재 선택 컨텍스트가 확인되었습니다. 롤백 사유를 검토한 뒤 확인을 진행하세요.',
  };
}

function refreshRollbackModalContext() {
  var modal = document.getElementById('confirm-modal');
  if (!modal || modal.style.display === 'none') {
    return;
  }
  var modalTargetId = modal.dataset ? String(modal.dataset.target || '').trim() : '';
  if (!modalTargetId) {
    return;
  }
  var modalTarget = S.byId[modalTargetId];
  if (!modalTarget || modalTarget.type !== 'domain') {
    return;
  }
  var body = modal.querySelector('.modal-body');
  if (!body) {
    return;
  }
  body.innerHTML = rollbackModalMarkup(modalTarget);
}

function refreshRollbackModalValidation() {
  var modal = document.getElementById('confirm-modal');
  if (!modal) {
    return;
  }
  var note = modal.querySelector('.modal-validation-state');
  var confirmButton = modal.querySelector('.btn-confirm-rollback');
  if (!note || !confirmButton) {
    return;
  }
  if (modal.style.display === 'none') {
    note.textContent = '';
    note.className = 'modal-validation-state';
    confirmButton.disabled = false;
    confirmButton.setAttribute('aria-disabled', 'false');
    confirmButton.removeAttribute('title');
    return;
  }
  var state = rollbackModalValidationState();
  note.textContent = state.message;
  note.className = 'modal-validation-state ' + (state.ok ? 'is-ready' : 'is-blocked');
  confirmButton.disabled = !state.ok;
  confirmButton.setAttribute('aria-disabled', state.ok ? 'false' : 'true');
  if (state.ok) {
    confirmButton.removeAttribute('title');
  } else {
    confirmButton.setAttribute('title', state.message);
  }
}

function htmlDisabled(disabled) {
  return disabled ? ' disabled aria-disabled="true"' : '';
}

function applyControlCenterRuntimeState(runtimePayload) {
  var runtimeState = runtimePayload && runtimePayload.runtime_state ? runtimePayload.runtime_state : null;
  if (!runtimeState) {
    return null;
  }

  var execution = runtimeState.execution || {};
  var scheduler = runtimeState.scheduler || {};
  var controls = runtimeState.user_controls || {};

  S.execution.runtimeAvailable = execution.runtime_available === true;
  S.execution.schedulerRunning = scheduler.running === true;
  S.execution.schedulerWorkers = Array.isArray(scheduler.workers) ? scheduler.workers : [];
  S.execution.currentWorkerIndex = Number.isInteger(execution.current_worker_index)
    ? execution.current_worker_index
    : (Number.isInteger(scheduler.current_worker_index) ? scheduler.current_worker_index : null);
  S.execution.activeWorkerIndex = Number.isInteger(scheduler.active_worker_index)
    ? scheduler.active_worker_index
    : S.execution.currentWorkerIndex;
  S.execution.currentActivity = execution.current_activity || scheduler.current_activity || null;
  S.execution.lastActivity = execution.last_activity || scheduler.last_activity || null;
  S.execution.lastError = execution.last_error || null;
  S.execution.operatorBrief = execution.operator_brief ? {
    autoSendStatus: String(execution.operator_brief.auto_send_status || '').trim(),
    currentExecution: String(execution.operator_brief.current_execution || '').trim(),
    lastDispatch: String(execution.operator_brief.last_dispatch || '').trim(),
    blockedAt: String(execution.operator_brief.blocked_at || '').trim(),
    failureReason: String(execution.operator_brief.failure_reason || '').trim(),
    nextAction: String(execution.operator_brief.next_action || '').trim(),
    availableControlsSummary: String(execution.operator_brief.available_controls_summary || '').trim(),
    availableControls: Array.isArray(execution.operator_brief.available_controls) ? execution.operator_brief.available_controls : [],
  } : null;
  S.execution.operatorCockpit = runtimeState.operator_cockpit && typeof runtimeState.operator_cockpit === 'object' ? {
    currentWp: runtimeState.operator_cockpit.current_wp ? {
      id: String(runtimeState.operator_cockpit.current_wp.id || 'UNKNOWN').trim(),
      goal: String(runtimeState.operator_cockpit.current_wp.goal || 'UNKNOWN').trim(),
      stage: String(runtimeState.operator_cockpit.current_wp.stage || 'UNKNOWN').trim(),
      type: String(runtimeState.operator_cockpit.current_wp.type || 'UNKNOWN').trim(),
    } : null,
    nextWp: String(runtimeState.operator_cockpit.next_wp || 'NONE').trim(),
    git: runtimeState.operator_cockpit.git ? {
      branch: String(runtimeState.operator_cockpit.git.branch || 'unknown').trim(),
      dirty: runtimeState.operator_cockpit.git.dirty === true,
      dirtyCount: Number.isInteger(runtimeState.operator_cockpit.git.dirty_count) ? runtimeState.operator_cockpit.git.dirty_count : 0,
    } : null,
    validationProfile: runtimeState.operator_cockpit.validation_profile ? {
      packetType: String(runtimeState.operator_cockpit.validation_profile.packet_type || 'UNKNOWN').trim(),
      stage: String(runtimeState.operator_cockpit.validation_profile.stage || 'UNKNOWN').trim(),
      commands: Array.isArray(runtimeState.operator_cockpit.validation_profile.commands) ? runtimeState.operator_cockpit.validation_profile.commands : [],
    } : null,
    branch: runtimeState.operator_cockpit.branch ? {
      currentBranch: String(runtimeState.operator_cockpit.branch.current_branch || 'unknown').trim(),
      recommendedBranch: String(runtimeState.operator_cockpit.branch.recommended_branch || '').trim(),
      createCommand: String(runtimeState.operator_cockpit.branch.create_command || '').trim(),
      commitSubject: String(runtimeState.operator_cockpit.branch.commit_subject || '').trim(),
    } : null,
    commitGuard: runtimeState.operator_cockpit.commit_guard ? {
      nextAction: String(runtimeState.operator_cockpit.commit_guard.next_action || '').trim(),
      protectedBranch: runtimeState.operator_cockpit.commit_guard.protected_branch === true,
      hasDirtyChanges: runtimeState.operator_cockpit.commit_guard.has_dirty_changes === true,
      validationsPassed: runtimeState.operator_cockpit.commit_guard.validations_passed === true,
      canApply: runtimeState.operator_cockpit.commit_guard.can_apply === true,
      reasons: Array.isArray(runtimeState.operator_cockpit.commit_guard.reasons) ? runtimeState.operator_cockpit.commit_guard.reasons : [],
      commitSubject: String(runtimeState.operator_cockpit.commit_guard.commit_subject || '').trim(),
    } : null,
    operatorActions: Array.isArray(runtimeState.operator_cockpit.operator_actions) ? runtimeState.operator_cockpit.operator_actions : [],
    asOf: String(runtimeState.operator_cockpit.as_of || '').trim(),
  } : null;
  mergeRecentOperatorActionFromRuntime(runtimeState.recent_operator_action || null);
  S.execution.nextActionHint = String(execution.next_action || '').trim();
  S.execution.controls = {
    sendPrompt: controls.send_prompt === true,
    autoSendToggle: controls.auto_send_toggle === true,
    stop: controls.stop === true,
    retryLastPrompt: controls.retry_last_prompt === true,
    rollback: controls.rollback === true,
    terminalStatusVisible: controls.terminal_status_visible !== false,
    failureReasonVisible: controls.failure_reason_visible === true,
  };
  S.execution.controlMatrix = normalizeExecutionControlMatrix(controls.control_matrix);
  S.rollbackEnabled = controls.rollback === true;
  S.statusSummary.autoSendEnabled = scheduler.running === true;

  if (String(execution.last_prompt_text || '').trim()) {
    S.execution.lastPromptText = String(execution.last_prompt_text || '').trim();
  }

  return runtimeState;
}

function renderExecutionConsole() {
  var container = document.getElementById('execution-console');
  if (!container) return;

  var sessions = Array.isArray(S.execution.sessions) ? S.execution.sessions : [];
  var selectedSession = selectedExecutionSession();
  var activity = currentExecutionActivity();
  var lastDispatchActivity = S.execution.lastError || S.execution.lastActivity || null;
  var currentExecutionSummary = executionCurrentSummary();
  var lastDispatchSummary = executionLastDispatchSummary();
  var promptValue = S.execution.promptText || S.execution.optimizedPrompt || '';
  var lastPrompt = (lastDispatchActivity && lastDispatchActivity.prompt_preview) || S.execution.lastPromptText || '없음';
  var errorText = executionFailureReasonSummary(
    (S.execution.operatorBrief && S.execution.operatorBrief.failureReason) || (activity && activity.error ? String(activity.error) : '없음'),
    S.execution.lastError || activity
  );
  var failureLocation = executionFailureLocationSummary(
    (S.execution.operatorBrief && S.execution.operatorBrief.blockedAt) || '',
    S.execution.lastError || activity
  );
  var summaryTone = executionSummaryTone();
  var runtimeBadgeClass = 'execution-badge '
    + (activity && activity.error ? 'is-error' : (S.execution.runtimeAvailable ? 'is-live' : ''));
  var sendDisabled = !S.execution.controls.sendPrompt;
  var retryDisabled = !S.execution.controls.retryLastPrompt;
  var autoToggleDisabled = !(S.execution.controls.autoSendToggle || S.execution.controls.stop);
  var immediateDispatchDisabled = !Array.isArray(S.execution.schedulerWorkers) || S.execution.schedulerWorkers.length < 1;
  var rollbackTarget = selectedRollbackDomain();
  var rollbackDisabled = !(S.rollbackEnabled && rollbackTarget);
  var selectedWorkerIndex = Number.isInteger(S.execution.selectedWorkerIndex) ? S.execution.selectedWorkerIndex : 0;
  var selectedWorker = immediateDispatchDisabled ? null : (S.execution.schedulerWorkers[selectedWorkerIndex] || null);
  var selectedWorkerSummary = selectedWorker
    ? executionWorkerLabel(selectedWorker, selectedWorkerIndex)
      + (String(selectedWorker.pts || '').trim() ? ' / ' + String(selectedWorker.pts || '').trim() : '')
      + (String(selectedWorker.plan_id || '').trim() ? ' / ' + String(selectedWorker.plan_id || '').trim() : '')
    : '없음';
  var runtimeWorkerActivity = S.execution.currentActivity || S.execution.lastActivity || null;
  var runtimeWorkerError = S.execution.lastError || null;
  var workerRosterSummary = immediateDispatchDisabled
    ? '등록된 worker 없음'
    : S.execution.schedulerWorkers.map(function(worker, index) {
      var label = executionWorkerLabel(worker, index);
      var pts = String((worker && worker.pts) || '').trim();
      return label + (pts ? ' [' + pts + ']' : '');
    }).join(', ');
  var workerActivitySummary = immediateDispatchDisabled
    ? '활동 중인 worker 없음'
    : S.execution.schedulerWorkers.map(function(worker, index) {
      var label = executionWorkerLabel(worker, index);
      var pts = String((worker && worker.pts) || '').trim();
      var isErrorWorker = runtimeWorkerError && executionMatchesWorker(runtimeWorkerError.worker, worker, index);
      var isActiveWorker = runtimeWorkerActivity && executionMatchesWorker(runtimeWorkerActivity.worker, worker, index);
      var workerStatus = '대기';
      if (isErrorWorker) {
        workerStatus = '실패: ' + String(runtimeWorkerError.error || runtimeWorkerError.action || '원인 미상');
      } else if (isActiveWorker) {
        workerStatus = (runtimeWorkerActivity.action === 'running' ? '실행 중' : '최근 ' + String(runtimeWorkerActivity.action || 'activity'));
      }
      return label + (pts ? ' [' + pts + ']' : '') + ' - ' + workerStatus;
    }).join(', ');
  var workerBadgeSummary = immediateDispatchDisabled
    ? '표시할 worker 배지 없음'
    : S.execution.schedulerWorkers.map(function(worker, index) {
      var label = executionWorkerLabel(worker, index);
      var pts = String((worker && worker.pts) || '').trim();
      var preview = String((worker && worker.prompt_preview) || '').trim();
      var isErrorWorker = runtimeWorkerError && executionMatchesWorker(runtimeWorkerError.worker, worker, index);
      var isActiveWorker = runtimeWorkerActivity && executionMatchesWorker(runtimeWorkerActivity.worker, worker, index);
      var badge = isErrorWorker
        ? 'ERR ' + String(runtimeWorkerError.error || runtimeWorkerError.action || '원인 미상')
        : isActiveWorker
          ? String(runtimeWorkerActivity.action === 'running' ? 'RUN' : String(runtimeWorkerActivity.action || 'RECENT').toUpperCase())
          : 'IDLE';
      var detail = isErrorWorker
        ? String(runtimeWorkerError.prompt_preview || preview || '').trim()
        : isActiveWorker
          ? String(runtimeWorkerActivity.prompt_preview || preview || '').trim()
          : preview;
      return label
        + (pts ? ' [' + pts + ']' : '')
        + ' {' + badge + '}'
        + (detail ? ' ' + detail : '');
    }).join(' | ');
  var workerCardMarkup = immediateDispatchDisabled
    ? ''
    : '<div class="execution-worker-cards">' + S.execution.schedulerWorkers.map(function(worker, index) {
      var label = executionWorkerLabel(worker, index);
      var pts = String((worker && worker.pts) || '').trim();
      var planId = String((worker && worker.plan_id) || '').trim();
      var preview = String((worker && worker.prompt_preview) || '').trim();
      var isErrorWorker = runtimeWorkerError && executionMatchesWorker(runtimeWorkerError.worker, worker, index);
      var isActiveWorker = runtimeWorkerActivity && executionMatchesWorker(runtimeWorkerActivity.worker, worker, index);
      var isSelectedWorker = index === selectedWorkerIndex;
      var statusLabel = isErrorWorker
        ? '실패'
        : isActiveWorker
          ? (runtimeWorkerActivity.action === 'running' ? '실행 중' : '최근 ' + String(runtimeWorkerActivity.action || 'activity'))
          : '대기';
      var detail = isErrorWorker
        ? String(runtimeWorkerError.error || '원인 미상')
        : isActiveWorker
          ? String(runtimeWorkerActivity.prompt_preview || preview || '최근 프롬프트 없음')
          : (preview || '대기 중');
      var cardClass = 'execution-worker-card'
        + (isSelectedWorker ? ' is-selected' : '')
        + (isErrorWorker ? ' is-error' : '');
      var pillClass = 'execution-worker-pill'
        + (isSelectedWorker ? ' is-selected' : '')
        + (isErrorWorker ? ' is-error' : '');
      var selectButtonLabel = isSelectedWorker ? '선택됨' : '이 worker 선택';
      return '<div class="' + cardClass + '">' +
        '<div class="execution-worker-card-head">' +
          '<strong class="execution-worker-card-title">' + escHtml(label) + '</strong>' +
          '<span class="' + pillClass + '">' + escHtml(statusLabel) + '</span>' +
        '</div>' +
        '<div class="execution-worker-meta">' + escHtml((pts ? pts : 'pts 없음') + (planId ? ' / ' + planId : '')) + '</div>' +
        '<div class="execution-worker-detail">' + escHtml(detail) + '</div>' +
        '<div class="execution-worker-actions">' +
          '<button type="button" class="execution-worker-action secondary" onclick="focusExecutionWorker(' + String(index) + ')"' + htmlDisabled(isSelectedWorker) + '>' + escHtml(selectButtonLabel) + '</button>' +
          '<button type="button" class="execution-worker-action primary" onclick="sendExecutionWorkerNow(' + String(index) + ')">이 worker 즉시 전송</button>' +
          (isErrorWorker ? '<button type="button" class="execution-worker-action warn" onclick="retryExecutionWorker(' + String(index) + ')">이 worker 재시도</button>' : '') +
          (isErrorWorker && S.execution.schedulerRunning ? '<button type="button" class="execution-worker-action warn" onclick="stopAutoSendFromWorkerCard(' + String(index) + ')">이 worker에서 자동 전송 중지</button>' : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  var sessionOptions = sessions.length
    ? sessions.map(function(session) {
      var selected = String(session.pts || '') === String(S.execution.selectedPts || '');
      return '<option value="' + escHtml(session.pts || '') + '"' + (selected ? ' selected' : '') + '>'
        + escHtml(session.label || session.pts || 'unknown pts') + '</option>';
    }).join('')
    : '<option value="">연결된 PTY 세션 없음</option>';
  var workerOptions = immediateDispatchDisabled
    ? '<option value="0">사용 가능한 worker 없음</option>'
    : S.execution.schedulerWorkers.map(function(worker, index) {
      var selected = index === selectedWorkerIndex;
      var label = executionWorkerLabel(worker, index);
      var pts = String((worker && worker.pts) || '').trim();
      return '<option value="' + String(index) + '"' + (selected ? ' selected' : '') + '>'
        + escHtml(label + (pts ? ' [' + pts + ']' : '')) + '</option>';
    }).join('');
  var rollbackOptions = '<option value="">도메인 선택</option>' + rollbackDomainNodes().map(function(node) {
    var selected = String(node.id || '') === String(S.execution.rollbackTargetDomain || '');
    return '<option value="' + escHtml(node.id || '') + '"' + (selected ? ' selected' : '') + '>'
      + escHtml(node.label + ' (' + node.id + ')') + '</option>';
  }).join('');
  var operatorHistoryMarkup = renderOperatorActionHistory();

  container.innerHTML = '<div class="sidebar-console">' +
    '<div class="execution-summary is-' + escHtml(summaryTone) + '">' +
      '<span class="' + runtimeBadgeClass + '">' + escHtml(S.execution.schedulerRunning ? '자동 전송 실행 중' : (S.execution.runtimeAvailable ? '수동 제어 가능' : '브리지 오프라인')) + '</span>' +
      '<strong>' + escHtml(S.execution.statusTitle || executionSummaryTitle()) + '</strong>' +
      '<p>' + escHtml(S.execution.statusDetail || executionNextAction()) + '</p>' +
    '</div>' +
    '<div class="execution-grid">' +
      '<div class="execution-row"><span>선택 터미널</span><strong>' + escHtml(selectedSession ? selectedSession.label : '없음') + '</strong></div>' +
      '<div class="execution-row"><span>자동 전송</span><strong>' + escHtml(S.execution.schedulerRunning ? '실행 중' : '중지됨') + '</strong></div>' +
      '<div class="execution-row"><span>활성 worker</span><strong>' + escHtml(String(Array.isArray(S.execution.schedulerWorkers) ? S.execution.schedulerWorkers.length : 0)) + '</strong></div>' +
      '<div class="execution-row"><span>선택 worker</span><strong>' + escHtml(selectedWorkerSummary) + '</strong></div>' +
      '<div class="execution-row"><span>worker 배치</span><strong>' + escHtml(workerRosterSummary) + '</strong></div>' +
      '<div class="execution-row"><span>worker 상태 요약</span><strong>' + escHtml(workerActivitySummary) + '</strong></div>' +
      '<div class="execution-row"><span>worker 최근 배지</span><strong>' + escHtml(workerBadgeSummary) + '</strong></div>' +
      '<div class="execution-row"><span>현재 실행</span><strong>' + escHtml(currentExecutionSummary) + '</strong></div>' +
      '<div class="execution-row"><span>마지막 전송</span><strong>' + escHtml(lastDispatchSummary) + '</strong></div>' +
      '<div class="execution-row"><span>마지막 프롬프트</span><strong>' + escHtml(lastPrompt) + '</strong></div>' +
      '<div class="execution-row"><span>실패 위치</span><strong>' + escHtml(failureLocation) + '</strong></div>' +
      '<div class="execution-row"><span>실패 원인</span><strong>' + escHtml(errorText) + '</strong></div>' +
      '<div class="execution-row"><span>즉시 가능 제어</span><strong>' + escHtml(executionAvailableControlsSummary()) + '</strong></div>' +
      '<div class="execution-row"><span>지금 할 일</span><strong>' + escHtml(executionNextAction()) + '</strong></div>' +
      '<div class="execution-row"><span>Operator Cockpit</span><strong>' + escHtml(executionOperatorCockpitStatus()) + '</strong></div>' +
      '<div class="execution-row"><span>권장 브랜치</span><strong>' + escHtml(executionOperatorCockpitBranchSummary()) + '</strong></div>' +
      '<div class="execution-row"><span>커밋 후보</span><strong>' + escHtml(executionOperatorCockpitCommitSummary()) + '</strong></div>' +
      '<div class="execution-row"><span>커밋 가드</span><strong>' + escHtml(executionOperatorCockpitGuardSummary()) + '</strong></div>' +
      '<div class="execution-row"><span>검증 프로파일</span><strong>' + escHtml(executionOperatorCockpitValidationSummary()) + '</strong></div>' +
      '<div class="execution-row"><span>운영 액션</span><strong>' + escHtml(executionOperatorCockpitActionsSummary()) + '</strong></div>' +
      '<div class="execution-row"><span>Operator Action History</span>' + operatorHistoryMarkup + '</div>' +
    '</div>' +
    workerCardMarkup +
    renderStageRunWorkbench() +
    '<div class="execution-row">' +
      '<span>전송 대상</span>' +
      '<select id="execution-pts-select" class="execution-select" onchange="syncExecutionInputs()"' + htmlDisabled(sendDisabled) + '>' + sessionOptions + '</select>' +
    '</div>' +
    '<div class="execution-row">' +
      '<span>프롬프트 입력</span>' +
      '<textarea id="execution-prompt" class="execution-textarea" placeholder="여기에 직접 프롬프트를 입력하거나 추천 프롬프트를 불러오세요." oninput="syncExecutionInputs()"' + htmlDisabled(sendDisabled) + '>' + escHtml(promptValue) + '</textarea>' +
    '</div>' +
    '<div class="execution-row">' +
      '<span>즉시 제어 worker</span>' +
      '<select id="execution-worker-select" class="execution-select" onchange="syncExecutionInputs()"' + htmlDisabled(immediateDispatchDisabled) + '>' + workerOptions + '</select>' +
    '</div>' +
    '<div class="execution-row">' +
      '<span>롤백 대상</span>' +
      '<select id="execution-rollback-target" class="execution-select" onchange="syncExecutionInputs()"' + htmlDisabled(!S.rollbackEnabled) + '>' + rollbackOptions + '</select>' +
    '</div>' +
    '<div class="execution-actions">' +
      '<button type="button" class="execution-button primary" onclick="sendPromptNow()"' + htmlDisabled(sendDisabled) + '>프롬프트 전송</button>' +
      '<button type="button" class="execution-button secondary" onclick="loadRecommendedPrompt()">추천 프롬프트</button>' +
      '<button type="button" class="execution-button secondary" onclick="sendEnterNow()"' + htmlDisabled(sendDisabled) + '>다음 단계 엔터</button>' +
      '<button type="button" class="execution-button secondary" onclick="dispatchSchedulerPromptNow()"' + htmlDisabled(immediateDispatchDisabled) + '>현재 worker 즉시 전송</button>' +
      '<button type="button" class="execution-button secondary" onclick="dispatchSchedulerEnterNow()"' + htmlDisabled(immediateDispatchDisabled) + '>전체 worker 즉시 엔터</button>' +
      '<button type="button" class="execution-button secondary" onclick="retryLastPrompt()"' + htmlDisabled(retryDisabled) + '>이전 내용 다시 실행</button>' +
      '<button type="button" class="execution-button warn" onclick="toggleAutoSendRuntime()"' + htmlDisabled(autoToggleDisabled) + '>' + escHtml(S.execution.schedulerRunning ? '자동 전송 중지' : '자동 전송 시작') + '</button>' +
      '<button type="button" class="execution-button warn" onclick="openExecutionRollbackModal()"' + htmlDisabled(rollbackDisabled) + '>선택 domain 롤백</button>' +
    '</div>' +
    '<div class="execution-note">실행 중지, 재시도, 자동 전송 on/off, worker 즉시 전송, 롤백 대상 선택, 현재 실패 원인, 다음 행동, 브랜치 readiness와 커밋 가드를 한 카드에 모았습니다.</div>' +
  '</div>';
}

function syncExecutionInputs() {
  var selectEl = document.getElementById('execution-pts-select');
  var promptEl = document.getElementById('execution-prompt');
  var workerEl = document.getElementById('execution-worker-select');
  var rollbackEl = document.getElementById('execution-rollback-target');
  var previousWorkerIndex = S.execution.selectedWorkerIndex;
  var previousRollbackTarget = String(S.execution.rollbackTargetDomain || '').trim();
  if (selectEl) S.execution.selectedPts = selectEl.value;
  if (promptEl) S.execution.promptText = promptEl.value;
  if (workerEl) S.execution.selectedWorkerIndex = Math.max(0, Number.parseInt(workerEl.value, 10) || 0);
  if (rollbackEl) S.execution.rollbackTargetDomain = String(rollbackEl.value || '').trim();
  if ((workerEl && previousWorkerIndex !== S.execution.selectedWorkerIndex) || (rollbackEl && previousRollbackTarget !== S.execution.rollbackTargetDomain)) {
    refreshExecutionSelectionUi();
  }
}

function syncStageRunInputs() {
  var stageEl = document.getElementById('execution-stage-select');
  var moduleEl = document.getElementById('execution-stage-module');
  if (stageEl) S.stageRun.selectedStage = String(stageEl.value || 'D').trim().toUpperCase();
  if (moduleEl) S.stageRun.selectedModule = String(moduleEl.value || '').trim();
}

function applyStageCapabilities(runtimePayload) {
  var capabilities = runtimePayload && runtimePayload.data ? runtimePayload.data.stage_capabilities : null;
  if (!capabilities || typeof capabilities !== 'object') {
    return;
  }

  S.stageRun.runEndpoint = String(capabilities.run_endpoint || S.stageRun.runEndpoint || '/api/planning-studio/stage-run');
  S.stageRun.supportedStages = Array.isArray(capabilities.supported_stages) && capabilities.supported_stages.length > 0
    ? capabilities.supported_stages.map(function(stage) { return String(stage || '').trim().toUpperCase(); }).filter(Boolean)
    : S.stageRun.supportedStages;

  if (!String(S.stageRun.selectedStage || '').trim()) {
    S.stageRun.selectedStage = String(capabilities.default_stage || S.stageRun.supportedStages[0] || 'D').trim().toUpperCase();
  }
}

function focusExecutionWorker(index) {
  if (!Array.isArray(S.execution.schedulerWorkers) || index < 0 || index >= S.execution.schedulerWorkers.length) {
    setExecutionStatus('warning', 'worker 선택 확인 필요', '선택할 worker가 유효하지 않습니다.');
    return;
  }
  S.execution.selectedWorkerIndex = index;
  refreshExecutionSelectionUi();
}

function sendExecutionWorkerNow(index) {
  if (!Array.isArray(S.execution.schedulerWorkers) || index < 0 || index >= S.execution.schedulerWorkers.length) {
    setExecutionStatus('warning', '즉시 전송 비활성화', '즉시 전송할 worker가 유효하지 않습니다.');
    return;
  }
  S.execution.selectedWorkerIndex = index;
  renderExecutionConsole();
  dispatchSchedulerPromptNow();
}

function retryExecutionWorker(index) {
  if (!Array.isArray(S.execution.schedulerWorkers) || index < 0 || index >= S.execution.schedulerWorkers.length) {
    setExecutionStatus('warning', '재시도 비활성화', '재시도할 worker가 유효하지 않습니다.');
    return;
  }
  S.execution.selectedWorkerIndex = index;
  renderExecutionConsole();
  dispatchSchedulerPromptNow();
}

function stopAutoSendFromWorkerCard(index) {
  if (!Array.isArray(S.execution.schedulerWorkers) || index < 0 || index >= S.execution.schedulerWorkers.length) {
    setExecutionStatus('warning', '자동 전송 중지 비활성화', '자동 전송을 중지할 worker가 유효하지 않습니다.');
    return;
  }
  S.execution.selectedWorkerIndex = index;
  renderExecutionConsole();
  if (!S.execution.schedulerRunning) {
    setExecutionStatus('warning', '자동 전송 중지 비활성화', '이미 자동 전송이 중지되어 있습니다.');
    return;
  }
  toggleAutoSendRuntime();
}

function openExecutionRollbackModal() {
  syncExecutionInputs();
  if (!S.rollbackEnabled) {
    setExecutionStatus('warning', '롤백 비활성화', 'system_api.rollback_ui.enabled 플래그가 비활성화되어 있어 롤백할 수 없습니다.');
    return;
  }
  var rollbackTarget = selectedRollbackDomain();
  if (!rollbackTarget) {
    setExecutionStatus('warning', '롤백 대상 필요', '먼저 롤백할 도메인을 선택하세요.');
    return;
  }
  selectNode(rollbackTarget.id);
  openRollbackModal(rollbackTarget.id);
}

function applyStageRunReport(report) {
  var normalized = normalizeStageRunReport(report);
  S.stageRun.lastReport = normalized;
  rememberStageRunReport(normalized);
  if (normalized && normalized.requested_stage) {
    S.stageRun.selectedStage = normalized.requested_stage;
  }
  if (normalized && normalized.requested_module) {
    S.stageRun.selectedModule = normalized.requested_module;
  }
  S.stageRun.lastRequest = normalized ? {
    stage: normalized.requested_stage,
    module: String(normalized.requested_module || S.stageRun.selectedModule || '').trim(),
    execute: normalized.execution_mode === 'execute',
  } : null;
  renderExecutionConsole();
}

function applyStageRunHistory(reports) {
  S.stageRun.history = normalizeStageRunHistory(reports);
}

function setStageRunHistoryFilter(filter) {
  var nextFilter = String(filter || 'all').trim();
  if (nextFilter !== 'all' && nextFilter !== 'failures' && nextFilter !== 'execute') {
    nextFilter = 'all';
  }
  S.stageRun.historyFilter = nextFilter;
  renderExecutionConsole();
}

function setStageRunHistorySort(sortMode) {
  var nextSort = String(sortMode || 'risk-first').trim();
  if (nextSort !== 'risk-first' && nextSort !== 'recent-first') {
    nextSort = 'risk-first';
  }
  S.stageRun.historySort = nextSort;
  renderExecutionConsole();
}

function setStageRunSignalHistoryView(mode) {
  var indexes = Array.isArray(S.stageRun.matchedHistoryIndexes) ? S.stageRun.matchedHistoryIndexes : [];
  var nextMode = String(mode || 'all').trim();
  if (nextMode !== 'matched' || indexes.length < 2) {
    nextMode = 'all';
  }
  S.stageRun.historySignalView = nextMode;
  if (nextMode !== 'matched') {
    S.stageRun.historySignalCollapsed = false;
  }
  renderExecutionConsole();
}

function setStageRunSignalGroupCollapsed(collapsed) {
  var indexes = Array.isArray(S.stageRun.matchedHistoryIndexes) ? S.stageRun.matchedHistoryIndexes : [];
  if (indexes.length < 2 || String(S.stageRun.historySignalView || 'all') !== 'matched') {
    S.stageRun.historySignalCollapsed = false;
    renderExecutionConsole();
    return;
  }
  S.stageRun.historySignalCollapsed = collapsed === true;
  renderExecutionConsole();
}

function restoreStageRunHistorySelection(report) {
  if (!report) {
    return false;
  }
  S.stageRun.selectedStage = String(report.requested_stage || S.stageRun.selectedStage || 'D').trim().toUpperCase();
  S.stageRun.selectedModule = String(report.requested_module || '').trim();
  S.stageRun.lastReport = report;
  S.stageRun.lastRequest = {
    stage: S.stageRun.selectedStage,
    module: S.stageRun.selectedModule,
    execute: report.execution_mode === 'execute',
  };
  return true;
}

function reuseStageRunHistory(index) {
  var history = normalizeStageRunHistory(S.stageRun.history);
  var report = history[index] || null;
  if (!report) {
    setExecutionStatus('warning', '기록 불러오기 실패', '선택한 최근 stage 기록을 찾을 수 없습니다.');
    return;
  }
  restoreStageRunHistorySelection(report);
  setExecutionStatus('idle', '최근 stage 기록 불러오기 완료', '선택값을 복원했습니다. 필요하면 마지막 stage 재실행 또는 dry-run/execute를 누르세요.');
  setStageRunHistoryHighlight(index);
}

function rerunStageHistory(index, executeMode) {
  var history = normalizeStageRunHistory(S.stageRun.history);
  var report = history[index] || null;
  if (!report || !restoreStageRunHistorySelection(report)) {
    setExecutionStatus('warning', '최근 stage 재실행 실패', '재실행할 stage 기록을 찾을 수 없습니다.');
    return;
  }
  setStageRunHistoryHighlight(index);
  runSelectedStage(executeMode === true);
}

function runSelectedStage(executeMode) {
  syncStageRunInputs();
  var stage = String(S.stageRun.selectedStage || '').trim().toUpperCase();
  var moduleId = String(S.stageRun.selectedModule || '').trim();
  if (!stage) {
    setExecutionStatus('warning', 'Stage 선택 필요', '먼저 실행할 Stage를 선택하세요.');
    return;
  }

  var payload = { stage: stage };
  if (moduleId) payload.module = moduleId;
  if (executeMode === true) payload.execute = true;

  renderExecutionConsole();
  setExecutionStatus('idle', executeMode ? 'Stage execute 실행 중' : 'Stage dry-run 실행 중', 'planning studio stage-run 결과를 수집하는 중입니다.');
  fetchJson(S.stageRun.runEndpoint || '/api/planning-studio/stage-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    idempotencyScope: 'planning-stage-run:' + (executeMode ? 'execute' : 'dry-run'),
    idempotencyPayload: payload,
    body: JSON.stringify(payload),
  })
    .then(function(r) { return r.json().then(function(body) { return { ok: r.ok, body: body }; }); })
    .then(function(result) {
      if (!result.ok || result.body.ok === false) {
        throw new Error(String(result.body.detail || result.body.message || result.body.error || 'stage run failed'));
      }
      applyStageRunReport(result.body.data);
      showToast('Stage ' + stage + ' ' + (executeMode ? 'execute' : 'dry-run') + ' 완료');
      if (executeMode) {
        hydratePlanningSnapshot();
      }
    })
    .catch(function(error) {
      S.stageRun.lastRequest = payload;
      S.stageRun.lastReport = null;
      setExecutionStatus('error', executeMode ? 'Stage execute 실패' : 'Stage dry-run 실패', String(error && error.message || '원인을 확인한 뒤 다시 시도하세요.'));
      renderExecutionConsole();
    });
}

function retryLastStageRun() {
  if (!S.stageRun.lastRequest) {
    setExecutionStatus('warning', '재실행 비활성화', '이전에 실행한 stage 요청이 없어 다시 실행할 수 없습니다.');
    return;
  }
  S.stageRun.selectedStage = String(S.stageRun.lastRequest.stage || S.stageRun.selectedStage || 'D').trim().toUpperCase();
  S.stageRun.selectedModule = String(S.stageRun.lastRequest.module || '').trim();
  renderExecutionConsole();
  runSelectedStage(S.stageRun.lastRequest.execute === true);
}

function setExecutionStatus(tone, title, detail) {
  S.execution.statusTone = tone;
  S.execution.statusTitle = title;
  S.execution.statusDetail = detail;
  renderExecutionConsole();
}

function resolveCurrentPacketId() {
  var snapshotPacketId = String((((S.planningSnapshot || {}).current_wp || {}).id) || '').trim();
  if (snapshotPacketId) return snapshotPacketId;
  return String(((RAW.meta.report || {}).current_wp) || 'NONE');
}

function loadRecommendedPrompt() {
  var prompt = String(S.execution.optimizedPrompt || '').trim();
  if (!prompt) {
    prompt = '[실행 지시]\\n현재 목표: ' + String(S.statusSummary.goal || '목표 미정') + '\\n다음 작업: ' + String(S.statusSummary.nextTask || 'NONE');
  }
  S.execution.promptText = prompt;
  setExecutionStatus('idle', '추천 프롬프트 적용 완료', '내용을 검토한 뒤 프롬프트 전송 또는 자동 전송 시작을 누르세요.');
  showToast('추천 프롬프트를 실행 패널에 채웠습니다.');
}

function hydrateExecutionRuntime() {
  Promise.all([
    fetchJson('/api/pty/sessions').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
    fetchJson('/ui/control-center-runtime').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
    fetchJson('/api/automation/optimize-prompt').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
  ]).then(function(results) {
    var sessionsPayload = results[0];
    var runtimePayload = results[1];
    var optimizedPromptPayload = results[2];
    var sessions = Array.isArray(sessionsPayload && sessionsPayload.sessions) ? sessionsPayload.sessions : [];
    var runtimeState = applyControlCenterRuntimeState(runtimePayload);
    applyStageCapabilities(runtimePayload);
    var preferredPts = String(S.execution.selectedPts || '').trim()
      || String((((runtimeState || {}).execution || {}).selected_pts_hint) || '').trim()
      || String((((runtimeState || {}).execution || {}).current_activity || {}).pts || '').trim()
      || String((((runtimeState || {}).execution || {}).last_activity || {}).pts || '').trim();

    S.execution.sessions = sessions;
    if (!runtimeState) {
      S.execution.runtimeAvailable = Boolean(sessionsPayload);
      S.execution.schedulerRunning = false;
      S.execution.schedulerWorkers = [];
      S.execution.currentWorkerIndex = null;
      S.execution.activeWorkerIndex = null;
      S.execution.currentActivity = null;
      S.execution.lastActivity = null;
      S.execution.lastError = null;
      S.execution.operatorBrief = null;
      S.execution.operatorCockpit = null;
      S.execution.nextActionHint = '';
      S.execution.controls = {
        sendPrompt: sessions.length > 0,
        autoSendToggle: sessions.length > 0,
        stop: false,
        retryLastPrompt: Boolean(String(S.execution.lastPromptText || '').trim()),
        rollback: S.rollbackEnabled === true,
        terminalStatusVisible: true,
        failureReasonVisible: false,
      };
    }
    S.execution.controlMatrix = normalizeExecutionControlMatrix(S.execution.controlMatrix);
    S.execution.optimizedPrompt = String((optimizedPromptPayload && optimizedPromptPayload.prompt) || S.execution.optimizedPrompt || '');

    if (preferredPts && sessions.some(function(session) { return String(session.pts || '') === preferredPts; })) {
      S.execution.selectedPts = preferredPts;
    } else if (sessions.length > 0) {
      S.execution.selectedPts = String(sessions[0].pts || '');
    } else {
      S.execution.selectedPts = '';
    }
    var runtimeWorkerIndex = Number.isInteger(S.execution.currentWorkerIndex)
      ? S.execution.currentWorkerIndex
      : (Number.isInteger(S.execution.activeWorkerIndex) ? S.execution.activeWorkerIndex : null);
    if (!Array.isArray(S.execution.schedulerWorkers) || S.execution.schedulerWorkers.length < 1) {
      S.execution.selectedWorkerIndex = 0;
    } else if (Number.isInteger(runtimeWorkerIndex) && runtimeWorkerIndex >= 0 && runtimeWorkerIndex < S.execution.schedulerWorkers.length) {
      S.execution.selectedWorkerIndex = runtimeWorkerIndex;
    } else if (!Number.isInteger(S.execution.selectedWorkerIndex) || S.execution.selectedWorkerIndex < 0 || S.execution.selectedWorkerIndex >= S.execution.schedulerWorkers.length) {
      S.execution.selectedWorkerIndex = 0;
    }

    if (!String(S.execution.promptText || '').trim()) {
      S.execution.promptText = S.execution.optimizedPrompt || String(S.statusSummary.goal || '');
    }

    S.execution.statusTone = executionSummaryTone();
    S.execution.statusTitle = executionSummaryTitle();
    S.execution.statusDetail = executionNextAction();
    renderExecutionConsole();
    renderMasterStatus();
  });
}

function sendPromptNow() {
  if (!S.execution.controls.sendPrompt) {
    setExecutionStatus('warning', '프롬프트 전송 비활성화', '현재 상태에서는 전송 가능한 터미널이 없습니다.');
    return;
  }
  syncExecutionInputs();
  var pts = String(S.execution.selectedPts || '').trim();
  var prompt = String(S.execution.promptText || '').trim();
  if (!pts) {
    setExecutionStatus('warning', '전송 대상 필요', '먼저 PTY 세션을 선택하세요.');
    return;
  }
  if (!prompt) {
    setExecutionStatus('warning', '프롬프트 입력 필요', '추천 프롬프트를 불러오거나 직접 입력하세요.');
    return;
  }

  setExecutionStatus('idle', '프롬프트 전송 중', '선택한 터미널로 프롬프트를 보내는 중입니다.');
  fetchJson('/api/pty/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    idempotencyScope: 'pty-send:' + pts + ':prompt',
    idempotencyPayload: {
      pts: pts,
      prompt: prompt,
      action: 'prompt',
      packet_id: resolveCurrentPacketId(),
    },
    body: JSON.stringify({
      pts: pts,
      text: prompt.endsWith('\r') ? prompt : prompt + '\r',
      prompt: prompt,
      action: 'prompt',
      name: 'Control Center',
      packet_id: resolveCurrentPacketId(),
    }),
  })
    .then(function(r) { return r.json().then(function(body) { return { ok: r.ok, body: body }; }); })
    .then(function(result) {
      if (!result.ok || result.body.ok === false) {
        throw new Error(String(result.body.detail || result.body.message || result.body.error || 'prompt send failed'));
      }
      markOperatorActionDelivery(prompt, 'success', 'PTY prompt 전송 완료');
      renderExecutionConsole();
      if (S.selected) renderPanel(S.selected);
      S.execution.lastPromptText = prompt;
      showToast('프롬프트 전송 완료');
      hydrateExecutionRuntime();
    })
    .catch(function(error) {
      markOperatorActionDelivery(prompt, 'failed', String(error && error.message || 'prompt send failed'));
      renderExecutionConsole();
      if (S.selected) renderPanel(S.selected);
      setExecutionStatus('error', '프롬프트 전송 실패', String(error && error.message || '원인을 확인한 뒤 다시 시도하세요.'));
    });
}

function sendEnterNow() {
  if (!S.execution.controls.sendPrompt) {
    setExecutionStatus('warning', '엔터 전송 비활성화', '현재 상태에서는 엔터를 보낼 터미널이 없습니다.');
    return;
  }
  syncExecutionInputs();
  var pts = String(S.execution.selectedPts || '').trim();
  if (!pts) {
    setExecutionStatus('warning', '전송 대상 필요', '엔터를 보낼 PTY 세션을 먼저 선택하세요.');
    return;
  }

  setExecutionStatus('idle', '다음 단계 엔터 전송 중', '선택한 터미널에 엔터를 보내는 중입니다.');
  fetchJson('/api/pty/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    idempotencyScope: 'pty-send:' + pts + ':enter',
    idempotencyPayload: {
      pts: pts,
      prompt: String(S.execution.lastPromptText || S.execution.promptText || '').trim(),
      action: 'enter',
      packet_id: resolveCurrentPacketId(),
    },
    body: JSON.stringify({
      pts: pts,
      text: '\r',
      prompt: String(S.execution.lastPromptText || S.execution.promptText || '').trim(),
      action: 'enter',
      name: 'Control Center',
      packet_id: resolveCurrentPacketId(),
    }),
  })
    .then(function(r) { return r.json().then(function(body) { return { ok: r.ok, body: body }; }); })
    .then(function(result) {
      if (!result.ok || result.body.ok === false) {
        throw new Error(String(result.body.detail || result.body.message || result.body.error || 'enter send failed'));
      }
      showToast('다음 단계 엔터 전송 완료');
      hydrateExecutionRuntime();
    })
    .catch(function(error) {
      setExecutionStatus('error', '엔터 전송 실패', String(error && error.message || '원인을 확인한 뒤 다시 시도하세요.'));
    });
}

function dispatchSchedulerPromptNow() {
  if (!Array.isArray(S.execution.schedulerWorkers) || S.execution.schedulerWorkers.length < 1) {
    setExecutionStatus('warning', '즉시 전송 비활성화', '즉시 전송할 scheduler worker가 아직 없습니다.');
    return;
  }
  syncExecutionInputs();
  var workerIndex = Number.isInteger(S.execution.selectedWorkerIndex) ? S.execution.selectedWorkerIndex : 0;
  var worker = S.execution.schedulerWorkers[workerIndex];
  if (!worker) {
    setExecutionStatus('warning', 'worker 선택 확인 필요', '즉시 전송할 worker를 다시 선택하세요.');
    return;
  }
  var workerName = String(worker.name || ('Worker ' + (workerIndex + 1)));

  setExecutionStatus('idle', '현재 worker 즉시 전송 중', workerName + ' 프롬프트를 즉시 전송하는 중입니다.');
  fetchJson('/api/pty/send-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    idempotencyScope: 'pty-scheduler:send-now',
    idempotencyPayload: { worker_index: workerIndex },
    body: JSON.stringify({ worker_index: workerIndex }),
  })
    .then(function(r) { return r.json().then(function(body) { return { ok: r.ok, body: body }; }); })
    .then(function(result) {
      var firstResult = Array.isArray(result.body.results) ? result.body.results[0] : null;
      if (!result.ok || !firstResult || firstResult.ok !== true) {
        throw new Error(String((firstResult && firstResult.error) || result.body.detail || result.body.message || 'scheduler send-now failed'));
      }
      showToast(workerName + ' 즉시 전송 완료');
      hydrateExecutionRuntime();
    })
    .catch(function(error) {
      setExecutionStatus('error', '현재 worker 즉시 전송 실패', workerName + ': ' + String(error && error.message || '원인을 확인한 뒤 다시 시도하세요.'));
    });
}

function dispatchSchedulerEnterNow() {
  if (!Array.isArray(S.execution.schedulerWorkers) || S.execution.schedulerWorkers.length < 1) {
    setExecutionStatus('warning', '즉시 엔터 비활성화', '즉시 엔터를 보낼 scheduler worker가 아직 없습니다.');
    return;
  }

  setExecutionStatus('idle', '전체 worker 즉시 엔터 전송 중', '현재 scheduler worker 전체에 즉시 엔터를 보내는 중입니다.');
  fetchJson('/api/pty/enter-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    idempotencyScope: 'pty-scheduler:enter-now',
    idempotencyPayload: {},
    body: JSON.stringify({}),
  })
    .then(function(r) { return r.json().then(function(body) { return { ok: r.ok, body: body }; }); })
    .then(function(result) {
      var results = Array.isArray(result.body.results) ? result.body.results : [];
      var failed = results.find(function(item) { return !item || item.ok !== true; });
      if (!result.ok || results.length < 1 || failed) {
        throw new Error(String((failed && failed.error) || result.body.detail || result.body.message || 'scheduler enter-now failed'));
      }
      showToast('전체 worker 즉시 엔터 전송 완료');
      hydrateExecutionRuntime();
    })
    .catch(function(error) {
      setExecutionStatus('error', '전체 worker 즉시 엔터 실패', String(error && error.message || '원인을 확인한 뒤 다시 시도하세요.'));
    });
}

function retryLastPrompt() {
  if (!S.execution.controls.retryLastPrompt) {
    setExecutionStatus('warning', '재시도 비활성화', '마지막 프롬프트가 기록되기 전에는 다시 실행할 수 없습니다.');
    return;
  }
  if (!String(S.execution.lastPromptText || '').trim()) {
    setExecutionStatus('warning', '재시도할 내용 없음', '먼저 한 번이라도 프롬프트를 전송해야 다시 실행할 수 있습니다.');
    return;
  }
  S.execution.promptText = S.execution.lastPromptText;
  renderExecutionConsole();
  sendPromptNow();
}

function buildSchedulerWorkers() {
  var snapshot = S.planningSnapshot || {};
  var automation = snapshot.automation || snapshot.automation_config || {};
  var selectedPts = String(S.execution.selectedPts || '').trim();
  var basePrompt = String(S.execution.promptText || S.execution.lastPromptText || S.execution.optimizedPrompt || '계속').trim();
  var cycleMinutes = Number(automation.cycle_minutes || 30);
  var enterSeconds = Number(automation.enter_seconds || 10);
  var configuredWorkers = Array.isArray(automation.workers) ? automation.workers : [];
  var workers = configuredWorkers.map(function(worker, index) {
    return {
      name: String(worker.name || 'Worker ' + (index + 1)),
      plan_id: String(worker.plan_id || resolveCurrentPacketId()),
      pts: String(worker.pts || selectedPts),
      prompt: String(worker.prompt || basePrompt),
      use_home_operator_prompt: worker.use_home_operator_prompt === true,
      cycle_minutes: Number(worker.cycle_minutes || cycleMinutes),
      enter_seconds: Number(worker.enter_seconds || enterSeconds),
    };
  }).filter(function(worker) { return String(worker.pts || '').trim(); });

  if (!workers.length && selectedPts) {
    workers.push({
      name: 'Control Center Worker',
      plan_id: resolveCurrentPacketId(),
      pts: selectedPts,
      prompt: basePrompt || '계속',
      use_home_operator_prompt: false,
      cycle_minutes: cycleMinutes,
      enter_seconds: enterSeconds,
    });
  }

  return {
    cycle_minutes: cycleMinutes,
    enter_seconds: enterSeconds,
    workers: workers,
  };
}

function toggleAutoSendRuntime() {
  if (!(S.execution.controls.autoSendToggle || S.execution.controls.stop)) {
    setExecutionStatus('warning', '자동 전송 비활성화', '세션과 실행 상태를 확인한 뒤 다시 시도하세요.');
    return;
  }
  syncExecutionInputs();
  if (S.execution.schedulerRunning) {
    setExecutionStatus('warning', '자동 전송 중지 중', '현재 실행 중인 자동 전송을 중지하는 중입니다.');
    fetchJson('/api/pty/scheduler/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      idempotencyScope: 'pty-scheduler:stop',
      idempotencyPayload: {},
      body: JSON.stringify({}),
    })
      .then(function(r) { return r.json().then(function(body) { return { ok: r.ok, body: body }; }); })
      .then(function(result) { if (!result.ok) { throw new Error(String(result.body.detail || result.body.message || result.body.error || 'scheduler stop failed')); } return result.body; })
      .then(function() {
        showToast('자동 전송 중지 완료');
        hydrateExecutionRuntime();
      })
      .catch(function(error) {
        setExecutionStatus('error', '자동 전송 중지 실패', String(error && error.message || '원인을 확인한 뒤 다시 시도하세요.'));
      });
    return;
  }

  var schedulerPayload = buildSchedulerWorkers();
  if (!schedulerPayload.workers.length) {
    setExecutionStatus('warning', '자동 전송 시작 불가', '세션을 선택하고 전송할 프롬프트를 준비해야 자동 전송을 시작할 수 있습니다.');
    return;
  }

  setExecutionStatus('idle', '자동 전송 시작 중', '선택한 세션과 프롬프트로 자동 전송을 시작하는 중입니다.');
  fetchJson('/api/pty/scheduler/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    idempotencyScope: 'pty-scheduler:start',
    idempotencyPayload: schedulerPayload,
    body: JSON.stringify(schedulerPayload),
  })
    .then(function(r) { return r.json().then(function(body) { return { ok: r.ok, body: body }; }); })
    .then(function(result) { if (!result.ok) { throw new Error(String(result.body.detail || result.body.message || result.body.error || 'scheduler start failed')); } return result.body; })
    .then(function() {
      S.execution.lastPromptText = String(S.execution.promptText || S.execution.lastPromptText || '').trim();
      showToast('자동 전송 시작 완료');
      hydrateExecutionRuntime();
    })
    .catch(function(error) {
      setExecutionStatus('error', '자동 전송 시작 실패', String(error && error.message || '원인을 확인한 뒤 다시 시도하세요.'));
    });
}

function renderSidebar() {
  var controlList = document.getElementById('control-sidebar-list');
  var domainList = document.getElementById('domain-sidebar-list');
  if (!controlList || !domainList) return;

  controlList.innerHTML = S.controlNodes.map(function(item) {
    return '<button type="button" class="control-entry ' + (S.selected === item.id ? 'active' : '') + '" data-control-id="' + escHtml(item.id) + '" onclick="selectControlNode(\\'' + escHtml(item.id) + '\\')">' +
      '<div class="control-pill ' + statusClassName(item.status) + '">' + statusLabel(item.status) + '</div>' +
      '<strong>' + escHtml(item.label) + '</strong>' +
      '<span>' + escHtml(item.purpose || '') + '</span>' +
      '</button>';
  }).join('');

  var domains = S.nodes.filter(function(node) { return node.type === 'domain'; });
  domainList.innerHTML = domains.map(function(item) {
    return '<button type="button" class="control-entry ' + (S.selected === item.id ? 'active' : '') + '" data-domain-id="' + escHtml(item.id) + '" onclick="selectControlNode(\\'' + escHtml(item.id) + '\\')">' +
      '<div class="control-pill ' + statusClassName(item.flagActive === false ? 'blocked' : 'ready') + '">' + (item.flagActive === false ? '비활성' : '도메인') + '</div>' +
      '<strong>' + escHtml(item.label) + '</strong>' +
      '<span>헬스 ' + escHtml(String(item.healthScore || 0)) + ' / stage ' + escHtml(String(item.stageStatus || 'UNKNOWN')) + '</span>' +
      '</button>';
  }).join('');
}

function renderPlanBoard() {
  S.kanbanLanes = buildClientKanbanLanes();
  renderKanbanBoard();
  var table = document.getElementById('plan-table-body');
  if (!table) return;
  table.innerHTML = S.planRows.map(function(row) {
    return '<tr class="plan-row ' + (S.selected === row.nodeId ? 'active' : '') + '" data-node-id="' + escHtml(row.nodeId || '') + '" onclick="selectControlNode(\\'' + escHtml(row.nodeId || 'root') + '\\')">' +
      '<td>' + escHtml(row.step || '') + '</td>' +
      '<td>' + escHtml(row.task || '') + '</td>' +
      '<td class="plan-cell-wrap">' + escHtml(row.purpose || '') + '</td>' +
      '<td class="plan-cell-wrap">' + escHtml(row.input || '') + '</td>' +
      '<td class="plan-cell-wrap">' + escHtml(row.output || '') + '</td>' +
      '<td><span class="status-chip ' + statusClassName(row.status) + '">' + statusLabel(row.status) + '</span></td>' +
      '<td>' + escHtml(row.priority || '') + '</td>' +
      '<td>' + escHtml(row.owner || '') + '</td>' +
      '<td class="plan-cell-wrap">' + escHtml(row.nextAction || '') + '</td>' +
      '</tr>';
  }).join('');
}

function buildClientKanbanLanes() {
  var laneOrder = [
    'control-intake',
    'control-planning',
    'control-execution',
    'control-validation',
    'control-complete',
    'control-module',
  ];
  var nodeById = {};
  S.controlNodes.forEach(function(node) {
    nodeById[node.id] = node;
  });
  var currentLaneId = String(S.statusSummary.currentLaneId || '').trim();

  return laneOrder.map(function(laneId) {
    var node = nodeById[laneId] || {};
    var cards = S.planRows.filter(function(row) {
      return String(row.nodeId || '') === laneId;
    }).map(function(row) {
      return {
        id: String(row.id || laneId),
        title: String(row.task || node.label || laneId),
        purpose: String(row.purpose || ''),
        input: String(row.input || ''),
        output: String(row.output || ''),
        next_action: String(row.nextAction || ''),
        owner: String(row.owner || node.owner || ''),
        priority: String(row.priority || ''),
        status: String(row.status || node.status || 'pending'),
      };
    });

    return {
      id: laneId,
      label: String(node.label || laneId),
      owner: String(node.owner || ''),
      status: String((cards[0] && cards[0].status) || node.status || 'pending'),
      purpose: String(node.purpose || ''),
      is_current: laneId === currentLaneId,
      operator_brief: kanbanLaneOperatorBrief(laneId),
      cards: cards,
    };
  });
}

function renderKanbanBoard() {
  var board = document.getElementById('kanban-board');
  if (!board) return;
  board.innerHTML = S.kanbanLanes.map(function(lane) {
    var currentBadge = lane.is_current ? '<span class="status-chip is-in_progress">현재 lane</span>' : '';
    var operatorBrief = lane.operator_brief && lane.operator_brief.summary
      ? '<div class="kanban-lane-brief"><span>' + escHtml(lane.operator_brief.label || '운영 요약') + '</span><strong>' + escHtml(lane.operator_brief.summary || '') + '</strong></div>'
      : '';
    var cardsMarkup = Array.isArray(lane.cards) && lane.cards.length > 0
      ? lane.cards.map(function(card) {
        return '<article class="kanban-card">' +
          '<div class="kanban-card-title">' +
            '<strong>' + escHtml(card.title || '') + '</strong>' +
            '<span class="status-chip ' + statusClassName(card.status) + '">' + statusLabel(card.status) + '</span>' +
          '</div>' +
          '<div class="kanban-card-copy"><b>목적</b> ' + escHtml(card.purpose || '') + '</div>' +
          '<div class="kanban-card-copy"><b>입력</b> ' + escHtml(card.input || '') + '</div>' +
          '<div class="kanban-card-copy"><b>출력</b> ' + escHtml(card.output || '') + '</div>' +
          '<div class="kanban-card-copy"><b>다음</b> ' + escHtml(card.next_action || '') + '</div>' +
        '</article>';
      }).join('')
      : '<article class="kanban-card"><div class="kanban-card-copy">할당된 카드 없음</div></article>';

    return '<section class="kanban-lane ' + (lane.is_current ? 'is-current' : '') + '" data-lane-id="' + escHtml(lane.id || '') + '">' +
      '<div class="kanban-lane-head">' +
        '<div class="kanban-lane-meta">' +
          '<div><div class="kanban-lane-title">' + escHtml(lane.label || '') + '</div><div class="kanban-lane-owner">' + escHtml(lane.owner || '') + '</div></div>' +
          (currentBadge || '<span class="status-chip ' + statusClassName(lane.status) + '">' + statusLabel(lane.status) + '</span>') +
        '</div>' +
        '<div class="kanban-card-copy">' + escHtml(lane.purpose || '') + '</div>' +
        operatorBrief +
      '</div>' +
      '<div class="kanban-card-stack">' + cardsMarkup + '</div>' +
      '</section>';
  }).join('');
}

function selectControlNode(id) {
  selectNode(id);
}

// ─── Fit view ─────────────────────────────────────────────────────────────────
function fitView() {
  var svg = document.getElementById('mindmap-svg');
  var W = parseFloat(svg.getAttribute('width')) || window.innerWidth;
  var H = parseFloat(svg.getAttribute('height')) || (window.innerHeight - 96);

  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  S.nodes.forEach(function(n) {
    var r = nodeRadius(n.type) + 10;
    minX = Math.min(minX, n.x - r);
    minY = Math.min(minY, n.y - r);
    maxX = Math.max(maxX, n.x + r);
    maxY = Math.max(maxY, n.y + r);
  });

  var pw = maxX - minX, ph = maxY - minY;
  if (pw <= 0 || ph <= 0) return;

  var scale = Math.min(0.95, Math.min(W / pw, H / ph));
  S.tk = scale;
  S.tx = (W - pw * scale) / 2 - minX * scale;
  S.ty = (H - ph * scale) / 2 - minY * scale;
  applyTransform();
  updateZoomDisplay();
}

// ─── Pan & Zoom ───────────────────────────────────────────────────────────────
function setupPanZoom() {
  var svg = document.getElementById('mindmap-svg');

  svg.addEventListener('wheel', function(e) {
    e.preventDefault();
    var delta = e.deltaY > 0 ? 0.85 : 1.15;
    var rect = svg.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var newK = Math.max(0.2, Math.min(4, S.tk * delta));
    S.tx = mx - (mx - S.tx) * (newK / S.tk);
    S.ty = my - (my - S.ty) * (newK / S.tk);
    S.tk = newK;
    applyTransform();
    updateZoomDisplay();
  }, { passive: false });

  svg.addEventListener('pointerdown', function(e) {
    var target = e.target;
    var edgesLayer = document.getElementById('edges-layer');
    var graphRoot = document.getElementById('graph-root');
    if (target === svg || target === graphRoot || target === edgesLayer) {
      S.isPanning = true;
      S.panStart = { x: e.clientX, y: e.clientY, tx: S.tx, ty: S.ty };
      svg.setPointerCapture(e.pointerId);
    }
  });

  svg.addEventListener('pointermove', function(e) {
    if (S.isPanning && S.panStart) {
      S.tx = S.panStart.tx + (e.clientX - S.panStart.x);
      S.ty = S.panStart.ty + (e.clientY - S.panStart.y);
      applyTransform();
    }
  });

  svg.addEventListener('pointerup', function() {
    S.isPanning = false;
    S.panStart = null;
  });

  svg.addEventListener('dblclick', function() { fitView(); });
}

// ─── Node drag & click ────────────────────────────────────────────────────────
function setupNodeInteractions() {
  var layer = document.getElementById('nodes-layer');

  layer.addEventListener('pointerdown', function(e) {
    var g = e.target.closest('[data-id]');
    if (!g) return;
    e.stopPropagation();
    var id = g.dataset.id;
    var n = S.byId[id];
    if (!n) return;

    var svg = document.getElementById('mindmap-svg');
    var rect = svg.getBoundingClientRect();
    var mx = (e.clientX - rect.left - S.tx) / S.tk;
    var my = (e.clientY - rect.top - S.ty) / S.tk;

    S.dragging = { id: id, ox: mx - n.x, oy: my - n.y, moved: false };
    g.setPointerCapture(e.pointerId);
  });

  layer.addEventListener('pointermove', function(e) {
    if (!S.dragging) return;
    S.dragging.moved = true;
    var n = S.byId[S.dragging.id];
    if (!n) return;
    var svg = document.getElementById('mindmap-svg');
    var rect = svg.getBoundingClientRect();
    var mx = (e.clientX - rect.left - S.tx) / S.tk;
    var my = (e.clientY - rect.top - S.ty) / S.tk;
    n.x = mx - S.dragging.ox;
    n.y = my - S.dragging.oy;
    updateNodePosition(S.dragging.id);
  });

  layer.addEventListener('pointerup', function() {
    if (!S.dragging) return;
    if (!S.dragging.moved) {
      selectNode(S.dragging.id);
    }
    S.dragging = null;
  });
}

function updateNodePosition(id) {
  var n = S.byId[id];
  if (!n) return;

  var g = document.querySelector('[data-id="' + id + '"]');
  if (g) g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');

  var edgeLayer = document.getElementById('edges-layer');
  var edgeEls = edgeLayer.querySelectorAll('[data-edge-id]');
  edgeEls.forEach(function(el) {
    var edgeId = el.dataset.edgeId;
    var edge = null;
    for (var i = 0; i < S.edges.length; i++) {
      if (S.edges[i].id === edgeId) { edge = S.edges[i]; break; }
    }
    if (!edge) return;
    if (edge.source !== id && edge.target !== id) return;
    var src = S.byId[edge.source];
    var tgt = S.byId[edge.target];
    if (!src || !tgt) return;

    if (el.tagName.toLowerCase() === 'line') {
      el.setAttribute('x1', src.x); el.setAttribute('y1', src.y);
      el.setAttribute('x2', tgt.x); el.setAttribute('y2', tgt.y);
    } else if (el.tagName.toLowerCase() === 'path') {
      var mx = (src.x + tgt.x) / 2;
      var my = (src.y + tgt.y) / 2 - 40;
      el.setAttribute('d', 'M' + src.x + ' ' + src.y + ' Q' + mx + ' ' + my + ' ' + tgt.x + ' ' + tgt.y);
    }
  });
}

// ─── Selection ────────────────────────────────────────────────────────────────
function selectNode(id) {
  S.selected = id;
  var selectedNode = S.byId[id];
  if (selectedNode && selectedNode.type === 'domain') {
    S.execution.rollbackTargetDomain = selectedNode.id;
    refreshExecutionSelectionUi();
  }
  document.querySelectorAll('.node').forEach(function(el) {
    var isSelected = el.dataset.id === id;
    el.classList.toggle('node-selected', isSelected);
    var circle = el.querySelector('circle:not([data-health-badge])');
    if (circle) {
      circle.setAttribute('stroke', isSelected ? 'white' : 'rgba(255,255,255,0.3)');
      circle.setAttribute('stroke-width', isSelected ? '3' : '1.5');
    }
  });
  renderSidebar();
  renderPlanBoard();
  openPanel(id);
}

function deselectNode() {
  S.selected = null;
  document.querySelectorAll('.node').forEach(function(el) {
    el.classList.remove('node-selected');
    var circle = el.querySelector('circle:not([data-health-badge])');
    if (circle) {
      circle.setAttribute('stroke', 'rgba(255,255,255,0.3)');
      circle.setAttribute('stroke-width', '1.5');
    }
  });
  renderSidebar();
  renderPlanBoard();
  closePanel();
}

// ─── Detail Panel ──────────────────────────────────────────────────────────────
function openPanel(id) {
  document.getElementById('detail-panel').classList.remove('panel-closed');
  S.panelTab = 'overview';
  renderPanel(id);
}

function closePanel() {
  document.getElementById('detail-panel').classList.add('panel-closed');
}

function renderPanel(id) {
  var n = S.byId[id];
  if (!n) return;

  var typeLabels = { root: '\\ub8e8\\ud2b8', domain: '\\ub3c4\\uba54\\uc778', stage: '\\uc2a4\\ud14c\\uc774\\uc9c0', contract: '\\uacc4\\uc57d', flag: '\\ud53c\\uc2a4\\uccb4 \\ud50c\\ub798\\uadf8', control: '\\ud1b5\\uc81c \\ub178\\ub4dc' };
  document.getElementById('panel-header').innerHTML =
    '<div class="ph-type">' + (typeLabels[n.type] || n.type) + '</div>' +
    '<div class="ph-title">' + escHtml(n.label) + '</div>' +
    '<button class="ph-close" onclick="deselectNode()" aria-label="\\ub2eb\\uae30">\\u2715</button>';

  var showTabs = n.type === 'domain' || n.type === 'root';
  var tabsEl = document.getElementById('panel-tabs');
  if (showTabs) {
    var tabLabels = { overview: '\\uac1c\\uc694', flags: '\\ud50c\\ub798\\uadf8', audit: '\\uac10\\uc0ac', quality: '\\ud488\\uc9c8' };
    tabsEl.innerHTML = ['overview', 'flags', 'audit', 'quality'].map(function(tab) {
      return '<button class="tab-btn ' + (S.panelTab === tab ? 'tab-active' : '') +
        '" onclick="switchTab(\\'' + escHtml(id) + '\\',\\'' + tab + '\\')">' +
        tabLabels[tab] + '</button>';
    }).join('');
  } else {
    tabsEl.innerHTML = '';
  }

  renderPanelTab(n, S.panelTab);
}

function switchTab(id, tab) {
  S.panelTab = tab;
  var tabMap = { overview: '\\uac1c\\uc694', flags: '\\ud50c\\ub798\\uadf8', audit: '\\uac10\\uc0ac', quality: '\\ud488\\uc9c8' };
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.classList.toggle('tab-active', btn.textContent.trim() === (tabMap[tab] || tab));
  });
  renderPanelTab(S.byId[id], tab);
}

function renderPanelTab(n, tab) {
  if (!n) return;
  var body = document.getElementById('panel-body');

  if (tab === 'overview' || (n.type !== 'domain' && n.type !== 'root')) {
    body.innerHTML = renderOverviewTab(n);
  } else if (tab === 'flags') {
    body.innerHTML = renderFlagsTab(n);
  } else if (tab === 'audit') {
    body.innerHTML = '<div class="tab-loading">\\uac10\\uc0ac \\ub85c\\uadf8 \\ub85c\\ub529 \\uc911...</div>';
    fetchAuditLog(n.id);
  } else if (tab === 'quality') {
    body.innerHTML = renderQualityTab(n);
  }
}

function renderOverviewTab(n) {
  if (n.type === 'root') {
    return '<div class="detail-grid-cards">' +
      renderDetailCard('\\ud604\\uc7ac \\ubaa9\\ud45c', S.statusSummary.goal || '\\ud604\\uc7ac \\ubaa9\\ud45c \\ubbf8\\uc815', '\\ud1b5\\ud569 \\ud1b5\\uc81c \\uc13c\\ud130\\uc758 \\uae30\\uc900 \\ubaa9\\ud45c\\ub97c \\uace0\\uc815\\ud569\\ub2c8\\ub2e4.') +
      renderDetailCard('\\ud604\\uc7ac \\uc791\\uc5c5', 'Stage ' + escHtml(S.statusSummary.currentStage || '-') + ' / packet ' + escHtml(String((RAW.meta.report || {}).current_wp || 'NONE')), '\\ud604\\uc7ac packet \\uae30\\uc900 \\ud3ec\\ucee4\\uc2a4\\ub97c \\ubcf4\\uc5ec\\uc90d\\ub2c8\\ub2e4.') +
      renderDetailCard('\\uacb0\\uacfc \\ubbf8\\ub9ac\\ubcf4\\uae30', S.passingTests + ' / ' + S.totalTests + ' PASS', 'system API, planning snapshot, quality gate\\ub97c \\ud569\\uce5c \\uae30\\uc900 \\uac12\\uc785\\ub2c8\\ub2e4.') +
      renderDetailCard('\\ubb38\\uc81c\\uc810', S.statusSummary.blocker || '\\uc815\\uc0c1', 'drift, known issues, \\ud655\\uc778 \\ud544\\uc694 \\ud56d\\ubaa9\\uc744 \\ud55c \\uc904\\ub85c \\ubd84\\ub9ac\\ud569\\ub2c8\\ub2e4.') +
      renderDetailCard('\\ub2e4\\uc74c \\ud589\\ub3d9', S.statusSummary.nextTask || 'NONE', '\\ub2e4\\uc74c packet \\ub610\\ub294 module preview \\uc2e4\\ud589\\uc73c\\ub85c \\uc774\\uc5b4\\uc9d1\\ub2c8\\ub2e4.') +
      '</div>' +
      renderOperatorGuideSection({
        title: '운영 가이드',
        cards: [
          renderCommandActionCard('Operator Cockpit', 'npm run operator:cockpit', '세션 시작 요약과 readiness를 한 번에 다시 확인합니다.', 'cockpit'),
          renderCommandActionCard('검증 명령', operatorCockpitValidationCommands().join('\n'), '현재 세션에서 가장 먼저 다시 확인할 검증 루프입니다.', 'validation'),
          renderCommandActionCard('브랜치 액션', operatorCockpitBranchActionSummary(), '권장 브랜치와 전환 명령을 함께 봅니다.', 'branch'),
          renderCommandActionCard('커밋 가드 다음 행동', 'npm run commit:guard\nnpm run commit:guard:verify', '커밋 readiness를 여는 현재 기준입니다.', 'guard'),
        ],
      });
  }
  if (n.type === 'control') {
    return renderControlOverview(n);
  }
  if (n.type === 'flag') {
    return '<div class="ov-section">' +
      '<div class="ov-label">\\ud50c\\ub798\\uadf8 ID</div>' +
      '<div class="ov-mono">' + escHtml(n.id.replace('flag-', '')) + '</div>' +
      '<div class="ov-label mt8">\\ud604\\uc7ac \\uac12</div>' +
      '<div class="ov-value ' + (n.value ? 'ov-pass' : 'ov-fail') + '">' + (n.value ? 'true (\\ud65c\\uc131)' : 'false (\\ube44\\ud65c\\uc131)') + '</div>' +
      '<div class="ov-label mt8">\\uadf8\\ub8f9</div>' +
      '<div class="ov-value">' + escHtml(n.group || '-') + '</div>' +
      (!S.flagToggleEnabled ? '<div class="ov-warn mt8">\\u26a0 \\ud50c\\ub798\\uadf8 \\ud1a0\\uae00 UI \\ube44\\ud65c\\uc131 (system_api.flag_toggle_ui.enabled = false)</div>' : '') +
      '</div>';
  }
  if (n.type === 'stage') {
    return '<div class="ov-section">' +
      '<div class="ov-label">\\uc2a4\\ud14c\\uc774\\uc9c0</div>' +
      '<div class="ov-value">' + escHtml(n.label) + '</div>' +
      '<div class="ov-label mt8">\\uc0c1\\ud0dc</div>' +
      '<div class="ov-value ' + (n.status === 'PASS' ? 'ov-pass' : n.status === 'FAIL' ? 'ov-fail' : 'ov-idle') + '">' + escHtml(n.status || 'NOT_STARTED') + '</div>' +
      '<div class="ov-label mt8">\\uc18c\\uc18d \\ub3c4\\uba54\\uc778</div>' +
      '<div class="ov-value">' + escHtml(n.parentId || '-') + '</div>' +
      '</div>';
  }
  if (n.type === 'contract') {
    return '<div class="ov-section">' +
      '<div class="ov-label">\\uacc4\\uc57d \\ud30c\\uc77c</div>' +
      '<div class="ov-mono">' + escHtml(n.path || '-') + '</div>' +
      '</div>';
  }

  // Domain overview
  var score = n.healthScore || 0;
  var scoreColor = score >= 90 ? '#0f766e' : score >= 70 ? '#b45309' : '#dc2626';
  var stageLetters = ['A', 'B', 'C', 'D', 'E'];
  var stageHtml = stageLetters.map(function(s, idx) {
    var stageNode = S.byId[n.id + '-' + s];
    var status = stageNode ? stageNode.status : 'NOT_STARTED';
    var cls = status === 'PASS' ? 'step-pass' : status === 'FAIL' ? 'step-fail' : 'step-idle';
    return (idx > 0 ? '<div class="step-line"></div>' : '') + '<div class="step ' + cls + '">' + s + '</div>';
  }).join('');

  var rollbackBtn = S.rollbackEnabled
    ? '<button class="btn-rollback" onclick="openRollbackModal(\\'' + escHtml(n.id) + '\\')">\\u26a0 \\ub864\\ubc31 \\ud2b8\\ub9ac\\uac70</button>'
    : '<div class="ov-warn mt8">\\ub864\\ubc31 UI \\ube44\\ud65c\\uc131 (system_api.rollback_ui.enabled = false)</div>';

  var circumference = 2 * Math.PI * 32;
  var dashLen = (circumference * score / 100).toFixed(1);

  return '<div class="ov-section">' +
    '<div class="health-ring-wrap">' +
    '<svg width="80" height="80" viewBox="0 0 80 80">' +
    '<circle cx="40" cy="40" r="32" fill="none" stroke="#e5e7eb" stroke-width="8"/>' +
    '<circle cx="40" cy="40" r="32" fill="none" stroke="' + scoreColor + '" stroke-width="8"' +
    ' stroke-dasharray="' + dashLen + ' ' + circumference.toFixed(1) + '"' +
    ' stroke-linecap="round" transform="rotate(-90 40 40)"/>' +
    '<text x="40" y="40" text-anchor="middle" dominant-baseline="central" fill="' + scoreColor + '" font-size="16" font-weight="700">' + score + '</text>' +
    '</svg>' +
    '<div class="health-label">\\ud5ec\\uc2a4 \\uc2a4\\ucf54\\uc5b4</div>' +
    '</div>' +
    '<div class="ov-label mt8">\\uc2a4\\ud14c\\uc774\\uc9c0 \\uc9c4\\ud589</div>' +
    '<div class="stage-stepper">' + stageHtml + '</div>' +
    '<div class="ov-label mt8">Ejectable</div>' +
    '<div class="ov-value">' + (n.ejectable ? '\\u2713 \\uac00\\ub2a5' : '\\u2717 \\ubd88\\uac00') + '</div>' +
    '<div class="mt8">' + rollbackBtn + '</div>' +
    '</div>';
}

function renderDetailCard(title, strongValue, description) {
  return '<article class="detail-card">' +
    '<span>' + escHtml(title) + '</span>' +
    '<strong>' + escHtml(strongValue || '') + '</strong>' +
    '<p>' + escHtml(description || '') + '</p>' +
    '</article>';
}

function renderCommandActionCard(title, commandText, description, actionScope) {
  var command = String(commandText || '').trim();
  return '<article class="detail-card">' +
    '<span>' + escHtml(title) + '</span>' +
    '<strong>' + escHtml(command || '명령 없음') + '</strong>' +
    '<p>' + escHtml(description || '') + '</p>' +
    '<div class="detail-card-actions">' +
      '<button type="button" class="detail-card-action secondary" onclick="copyOperatorCommand(\\'' + escHtml(actionScope) + '\\')">명령 복사</button>' +
      '<button type="button" class="detail-card-action primary" onclick="loadOperatorCommandPrompt(\\'' + escHtml(actionScope) + '\\')">실행 패널에 채우기</button>' +
    '</div>' +
    '</article>';
}

function getOperatorCommandPayload(actionScope) {
  var scope = String(actionScope || '').trim();
  if (scope === 'validation') {
    return {
      title: '검증 명령',
      command: operatorCockpitValidationCommands().join('\n'),
      scope: scope,
      toast: '검증 명령을 준비했습니다.',
    };
  }
  if (scope === 'branch') {
    var cockpit = S.execution.operatorCockpit || null;
    var branch = cockpit && cockpit.branch ? cockpit.branch : null;
    return {
      title: '브랜치 액션',
      command: branch && branch.createCommand
        ? branch.createCommand
        : operatorCockpitBranchActionSummary(),
      scope: scope,
      toast: '브랜치 액션을 준비했습니다.',
    };
  }
  if (scope === 'guard') {
    return {
      title: '커밋 가드',
      command: 'npm run commit:guard\nnpm run commit:guard:verify',
      scope: scope,
      toast: '커밋 가드 명령을 준비했습니다.',
    };
  }
  if (scope === 'cockpit') {
    return {
      title: 'Operator Cockpit',
      command: 'npm run operator:cockpit',
      scope: scope,
      toast: 'operator cockpit 명령을 준비했습니다.',
    };
  }
  if (scope === 'deep-link') {
    return {
      title: 'Deep Link Command',
      command: String((S.deepLinkContext && S.deepLinkContext.command) || '').trim(),
      scope: scope,
      toast: 'deep-link 권장 명령을 준비했습니다.',
    };
  }
  return {
    title: '명령',
    command: '',
    scope: scope,
    toast: '준비할 명령이 없습니다.',
  };
}

function copyTextToClipboard(text) {
  var value = String(text || '');
  if (!value.trim()) {
    return Promise.reject(new Error('empty command'));
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(value);
  }
  return new Promise(function(resolve, reject) {
    var textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      var ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) {
        resolve();
      } else {
        reject(new Error('copy failed'));
      }
    } catch (error) {
      document.body.removeChild(textarea);
      reject(error);
    }
  });
}

function copyOperatorCommand(actionScope) {
  var payload = getOperatorCommandPayload(actionScope);
  copyTextToClipboard(payload.command)
    .then(function() {
      rememberOperatorAction('copied', payload);
      renderExecutionConsole();
      if (S.selected) renderPanel(S.selected);
      showToast(payload.title + ' 복사 완료');
    })
    .catch(function() {
      showToast(payload.title + ' 복사 실패');
    });
}

function loadOperatorCommandPrompt(actionScope) {
  var payload = getOperatorCommandPayload(actionScope);
  if (!String(payload.command || '').trim()) {
    showToast('채울 명령이 없습니다.');
    return;
  }
  S.execution.promptText = payload.command;
  if (!String(S.execution.selectedPts || '').trim()) {
    var sessions = Array.isArray(S.execution.sessions) ? S.execution.sessions : [];
    if (sessions.length > 0) {
      S.execution.selectedPts = String(sessions[0].pts || '').trim();
    }
  }
  rememberOperatorAction('loaded', payload);
  setExecutionStatus('idle', payload.title + ' 준비 완료', payload.toast + ' 전송 전에 세션과 명령을 확인하세요.');
  renderExecutionConsole();
  if (S.selected) renderPanel(S.selected);
  showToast(payload.title + ' 실행 패널 반영 완료');
}

function renderControlOverview(n) {
  var inputs = Array.isArray(n.inputs) ? n.inputs.join(' / ') : '';
  var outputs = Array.isArray(n.outputs) ? n.outputs.join(' / ') : '';
  var issues = Array.isArray(n.issues) ? n.issues.join('\\n') : '';
  var operatorGuide = operatorCockpitGuideForNode(n.id);
  var cards = [
    renderDetailCard('\\ubaa9\\ud45c', n.purpose || '', '\\uc774 \\ub178\\ub4dc\\uac00 \\ub2f4\\ub2f9\\ud558\\ub294 \\ucc45\\uc784\\uc744 \\uc124\\uba85\\ud569\\ub2c8\\ub2e4.'),
    renderDetailCard('\\ud604\\uc7ac \\uc791\\uc5c5', statusLabel(n.status), '\\uc9c0\\uae08 \\uc5b4\\ub514\\uae4c\\uc9c0 \\uc9c4\\ud589\\ub410\\ub294\\uc9c0 \\ubcf4\\uc5ec\\uc90d\\ub2c8\\ub2e4.'),
    renderDetailCard('\\uc785\\ub825 \\uc870\\uac74', inputs || '\\uc785\\ub825 \\uc815\\uc758 \\uc5c6\\uc74c', '\\uc774 \\ub2e8\\uacc4\\uac00 \\ucc38\\uc870\\ud558\\ub294 \\uc18c\\uc2a4\\ub97c \\uc694\\uc57d\\ud569\\ub2c8\\ub2e4.'),
    renderDetailCard('\\uacb0\\uacfc \\ubbf8\\ub9ac\\ubcf4\\uae30', outputs || '\\ucd9c\\ub825 \\uc815\\uc758 \\uc5c6\\uc74c', '\\ub2e8\\uacc4\\uac00 \\ub05d\\ub098\\uba74 \\uc5bb\\uc5b4\\uc57c \\ud560 \\uc0b0\\ucd9c\\ubb3c\\uc785\\ub2c8\\ub2e4.'),
    renderDetailCard('\\ubb38\\uc81c\\uc810', issues || '\\ubb38\\uc81c\\uc810 \\uc5c6\\uc74c', '\\ucc28\\ub2e8 \\uc0ac\\uc720\\ub098 \\uc8fc\\uc758\\ud560 \\uc810\\uc744 \\ubd84\\ub9ac\\ud569\\ub2c8\\ub2e4.'),
    renderDetailCard('\\ub2e4\\uc74c \\ud589\\ub3d9', n.nextAction || '', '\\ub2e4\\uc74c \\ub178\\ub4dc\\ub85c \\uc5b4\\ub5bb\\uac8c \\ub118\\uc5b4\\uac00\\ub294\\uc9c0 \\ubc14\\ub85c \\ubcf4\\uc5ec\\uc90d\\ub2c8\\ub2e4.'),
  ];

  return '<div class="detail-grid-cards">' +
    cards.join('') +
    '</div>' +
    renderOperatorGuideSection(operatorGuide) +
    (n.controlKind === 'module' ? renderModuleWorkbench() : '');
}

function selectedBlueprint() {
  var list = Array.isArray(S.scaffoldCatalog.blueprints) ? S.scaffoldCatalog.blueprints : [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].id) === String(S.scaffoldForm.blueprint)) return list[i];
  }
  return list[0] || null;
}

function selectedRecipe() {
  var list = Array.isArray(S.scaffoldCatalog.recipes) ? S.scaffoldCatalog.recipes : [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].id) === String(S.scaffoldForm.recipe)) return list[i];
  }
  return list[0] || null;
}

function syncScaffoldForm() {
  var domainEl = document.getElementById('module-domain');
  var blueprintEl = document.getElementById('module-blueprint');
  var recipeEl = document.getElementById('module-recipe');
  if (domainEl) S.scaffoldForm.domain = String(domainEl.value || '').trim();
  if (blueprintEl) S.scaffoldForm.blueprint = String(blueprintEl.value || '');
  if (recipeEl) S.scaffoldForm.recipe = String(recipeEl.value || '');
}

function setScaffoldStatus(tone, title, currentState, nextAction, retryable, detail) {
  S.scaffoldStatus = {
    tone: String(tone || 'idle'),
    title: String(title || ''),
    currentState: String(currentState || ''),
    nextAction: String(nextAction || ''),
    retryable: String(retryable || ''),
    detail: String(detail || ''),
  };
}

function statusToneBadge(tone) {
  if (tone === 'success') return '정상';
  if (tone === 'warning') return '확인 필요';
  if (tone === 'error') return '차단';
  return '대기';
}

function normalizeScaffoldFailure(body, actionLabel, retryAfterSeconds) {
  var code = String(body && body.code || '');
  var message = String(body && (body.detail || body.message) || actionLabel + ' failed');
  var retryAfter = retryAfterSeconds ? String(retryAfterSeconds) + '초 후 재시도' : '원인 확인 후 재시도';

  if (code === 'RESOURCE_BUSY') {
    return {
      tone: 'warning',
      title: actionLabel + ' 대기 필요',
      currentState: '같은 리소스에서 다른 작업이 이미 진행 중입니다.',
      nextAction: retryAfter + ' 다시 시도하거나 다른 domain으로 실행하세요.',
      retryable: '가능',
      detail: message,
    };
  }

  if (code === 'FORBIDDEN') {
    return {
      tone: 'error',
      title: actionLabel + ' 권한 부족',
      currentState: '현재 권한으로는 이 작업을 실행할 수 없습니다.',
      nextAction: actionLabel === 'create'
        ? 'system.admin 권한으로 다시 시도하세요.'
        : 'domain.viewer 또는 system.admin 권한으로 다시 시도하세요.',
      retryable: '권한 확보 후 가능',
      detail: message,
    };
  }

  if (code === 'VALIDATION_ERROR') {
    return {
      tone: 'warning',
      title: actionLabel + ' 입력 확인 필요',
      currentState: '입력값 형식이 올바르지 않습니다.',
      nextAction: 'domain, blueprint, recipe를 다시 확인한 뒤 실행하세요.',
      retryable: '가능',
      detail: message,
    };
  }

  if (code === 'CONFLICT') {
    return {
      tone: 'warning',
      title: actionLabel + ' 충돌 감지',
      currentState: '같은 이름의 대상이나 기존 산출물과 충돌했습니다.',
      nextAction: '기존 requirements 파일을 확인하거나 다른 domain으로 시도하세요.',
      retryable: '조건 해소 후 가능',
      detail: message,
    };
  }

  return {
    tone: 'error',
    title: actionLabel + ' 실패',
    currentState: '요청은 전달됐지만 정상 완료되지 않았습니다.',
    nextAction: '상세 메시지를 확인하고 입력값 또는 서버 상태를 점검하세요.',
    retryable: '확인 후 가능',
    detail: message,
  };
}

function renderScaffoldStatus() {
  var status = S.scaffoldStatus || {};
  return '<section class="module-status is-' + escHtml(status.tone || 'idle') + '">' +
    '<div class="module-status-head">' +
    '<strong class="module-status-title">' + escHtml(status.title || 'preview 대기') + '</strong>' +
    '<span class="module-status-badge">' + escHtml(statusToneBadge(status.tone || 'idle')) + '</span>' +
    '</div>' +
    '<div class="module-status-grid">' +
    '<div class="module-status-row"><span>현재 상태</span><strong>' + escHtml(status.currentState || '-') + '</strong></div>' +
    '<div class="module-status-row"><span>다음 행동</span><strong>' + escHtml(status.nextAction || '-') + '</strong></div>' +
    '<div class="module-status-row"><span>재시도</span><strong>' + escHtml(status.retryable || '-') + '</strong></div>' +
    '<div class="module-status-row"><span>상세</span><strong>' + escHtml(status.detail || '-') + '</strong></div>' +
    '</div>' +
    '</section>';
}

function renderModuleWorkbench() {
  var blueprint = selectedBlueprint();
  var recipe = selectedRecipe();
  var profile = blueprint ? String(blueprint.architecture_profile || '') : '';
  var steps = blueprint && Array.isArray(blueprint.starter_sequence)
    ? blueprint.starter_sequence.map(function(item) {
      return '- ' + String(item.step || '') + ': ' + String(item.focus || '');
    }).join('\\n')
    : 'starter sequence 없음';
  var previewText = S.scaffoldPreview || 'preview를 아직 실행하지 않았습니다. dry-run preview를 먼저 누르세요.';

  var blueprintOptions = (Array.isArray(S.scaffoldCatalog.blueprints) ? S.scaffoldCatalog.blueprints : []).map(function(item) {
    return '<option value="' + escHtml(item.id) + '"' + (String(item.id) === String(S.scaffoldForm.blueprint) ? ' selected' : '') + '>' +
      escHtml(item.name + ' (' + item.id + ')') + '</option>';
  }).join('');
  var recipeOptions = (Array.isArray(S.scaffoldCatalog.recipes) ? S.scaffoldCatalog.recipes : []).map(function(item) {
    return '<option value="' + escHtml(item.id) + '"' + (String(item.id) === String(S.scaffoldForm.recipe) ? ' selected' : '') + '>' +
      escHtml(item.name + ' (' + item.id + ')') + '</option>';
  }).join('');

  return '<section class="module-workbench">' +
    '<div class="module-grid">' +
    '<div class="module-field"><span>domain id</span><input id="module-domain" class="module-input" value="' + escHtml(S.scaffoldForm.domain || '') + '" placeholder="예: ordering" oninput="handleScaffoldInput()"></div>' +
    '<div class="module-field"><span>blueprint</span><select id="module-blueprint" class="module-select" onchange="handleScaffoldBlueprint()">' + blueprintOptions + '</select></div>' +
    '<div class="module-field"><span>architecture profile</span><input class="module-input" value="' + escHtml(profile || 'unknown') + '" readonly></div>' +
    '<div class="module-field"><span>recipe</span><select id="module-recipe" class="module-select" onchange="handleScaffoldInput()">' + recipeOptions + '</select></div>' +
    '<div class="module-toolbar">' +
    '<button type="button" class="module-button primary" onclick="previewModuleScaffold()">dry-run preview</button>' +
    '<button type="button" class="module-button secondary" onclick="loadScaffoldCommand()">명령 미리보기</button>' +
    '<button type="button" class="module-button warn" onclick="createModuleScaffold()">confirm 후 create</button>' +
    '</div>' +
    renderScaffoldStatus() +
    '<div class="module-note">starter sequence\\n' + escHtml(steps) + '</div>' +
    '<pre class="module-preview">' + escHtml(previewText) + '</pre>' +
    '</div>' +
    '</section>';
}

function handleScaffoldInput() {
  syncScaffoldForm();
}

function handleScaffoldBlueprint() {
  syncScaffoldForm();
  var blueprint = selectedBlueprint();
  if (!blueprint) return;
  var recipes = Array.isArray(S.scaffoldCatalog.recipes) ? S.scaffoldCatalog.recipes : [];
  for (var i = 0; i < recipes.length; i++) {
    var refs = Array.isArray(recipes[i].blueprint_refs) ? recipes[i].blueprint_refs : [];
    if (refs.indexOf(blueprint.id) !== -1) {
      S.scaffoldForm.recipe = recipes[i].id;
      break;
    }
  }
  renderPanel('control-module');
}

function loadScaffoldCommand() {
  syncScaffoldForm();
  S.scaffoldError = '';
  S.scaffoldPreview = 'node scripts/generate-domain-scaffold.js --domain ' +
    (S.scaffoldForm.domain || '<domain>') +
    ' --blueprint ' + (S.scaffoldForm.blueprint || '<blueprint>') +
    (S.scaffoldForm.recipe ? ' --recipe ' + S.scaffoldForm.recipe : '') +
    ' --dry-run';
  setScaffoldStatus(
    'idle',
    '명령 미리보기 준비',
    'CLI 실행 명령이 준비되었습니다.',
    'dry-run preview를 실행해 실제 preview 결과를 확인하세요.',
    '가능',
    '명령 미리보기는 실행하지 않고 입력값만 조합합니다.'
  );
  renderPanel('control-module');
}

function previewModuleScaffold() {
  syncScaffoldForm();
  S.scaffoldError = '';
  if (!S.scaffoldForm.domain || !S.scaffoldForm.blueprint) {
    S.scaffoldError = 'domain 과 blueprint 를 먼저 입력하세요.';
    setScaffoldStatus(
      'warning',
      'preview 입력 확인 필요',
      '필수 입력값이 비어 있습니다.',
      'domain 과 blueprint 를 채운 뒤 다시 preview를 실행하세요.',
      '가능',
      'domain 과 blueprint 는 필수입니다.'
    );
    renderPanel('control-module');
    return;
  }

  fetchJson(S.planningApiBase + '/scaffold-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    idempotencyScope: 'scaffold-preview:' + S.scaffoldForm.domain + ':' + S.scaffoldForm.blueprint,
    idempotencyPayload: S.scaffoldForm,
    body: JSON.stringify(S.scaffoldForm),
  })
    .then(function(r) {
      return r.json().then(function(body) {
        return {
          ok: r.ok,
          body: body,
          retryAfter: r.headers.get('retry-after'),
        };
      });
    })
    .then(function(result) {
      if (!result.ok) {
        throw normalizeScaffoldFailure(result.body, 'preview', result.retryAfter);
      }
      S.scaffoldTranscript = String((result.body.data && result.body.data.stdout) || '');
      S.scaffoldPreview = String((result.body.data && (result.body.data.preview || result.body.data.stdout)) || '');
      S.scaffoldError = '';
      setScaffoldStatus(
        'success',
        'preview 준비 완료',
        'dry-run preview가 정상적으로 갱신되었습니다.',
        '결과를 확인한 뒤 confirm 후 create를 실행하세요.',
        '가능',
        'preview는 읽기 전용이며 실제 파일을 만들지 않습니다.'
      );
      renderPanel('control-module');
      showToast('module dry-run preview 갱신 완료');
    })
    .catch(function(error) {
      var normalized = error && error.tone ? error : normalizeScaffoldFailure({ message: String(error && error.message || 'preview failed') }, 'preview');
      S.scaffoldError = normalized.detail;
      setScaffoldStatus(normalized.tone, normalized.title, normalized.currentState, normalized.nextAction, normalized.retryable, normalized.detail);
      renderPanel('control-module');
    });
}

function createModuleScaffold() {
  syncScaffoldForm();
  if (!S.scaffoldForm.domain || !S.scaffoldForm.blueprint) {
    S.scaffoldError = 'domain 과 blueprint 를 먼저 입력하세요.';
    setScaffoldStatus(
      'warning',
      'create 입력 확인 필요',
      '필수 입력값이 비어 있습니다.',
      'domain 과 blueprint 를 채운 뒤 다시 create를 실행하세요.',
      '가능',
      'domain 과 blueprint 는 필수입니다.'
    );
    renderPanel('control-module');
    return;
  }
  if (!window.confirm('requirements/' + S.scaffoldForm.domain + '.yaml 을 실제로 생성할까요?')) {
    setScaffoldStatus(
      'idle',
      'create 대기',
      '실제 생성은 아직 실행되지 않았습니다.',
      'preview 결과를 다시 확인한 뒤 confirm 후 create를 누르세요.',
      '가능',
      '사용자 확인이 있어야 create가 실행됩니다.'
    );
    return;
  }

  fetchJson(S.planningApiBase + '/scaffold-create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    idempotencyScope: 'scaffold-create:' + S.scaffoldForm.domain + ':' + S.scaffoldForm.blueprint,
    idempotencyPayload: S.scaffoldForm,
    body: JSON.stringify(S.scaffoldForm),
  })
    .then(function(r) {
      return r.json().then(function(body) {
        return {
          ok: r.ok,
          body: body,
          retryAfter: r.headers.get('retry-after'),
        };
      });
    })
    .then(function(result) {
      if (!result.ok) {
        throw normalizeScaffoldFailure(result.body, 'create', result.retryAfter);
      }
      S.scaffoldTranscript = String((result.body.data && result.body.data.stdout) || '');
      S.scaffoldPreview = String((result.body.data && result.body.data.stdout) || '');
      S.scaffoldError = '';
      setScaffoldStatus(
        'success',
        'requirements 생성 완료',
        'requirements/' + S.scaffoldForm.domain + '.yaml 생성이 완료되었습니다.',
        'diff와 다음 work packet 연결 상태를 확인하세요.',
        '불필요',
        '실제 파일 생성이 끝났으므로 후속 검증 단계로 넘어가면 됩니다.'
      );
      renderPanel('control-module');
      showToast('requirements/' + S.scaffoldForm.domain + '.yaml 생성 완료');
    })
    .catch(function(error) {
      var normalized = error && error.tone ? error : normalizeScaffoldFailure({ message: String(error && error.message || 'create failed') }, 'create');
      S.scaffoldError = normalized.detail;
      setScaffoldStatus(normalized.tone, normalized.title, normalized.currentState, normalized.nextAction, normalized.retryable, normalized.detail);
      renderPanel('control-module');
    });
}

function renderFlagsTab(n) {
  var domainFlags = S.nodes.filter(function(node) {
    return node.type === 'flag' && node.parentId === n.id;
  });

  if (!domainFlags.length) return '<div class="tab-empty">\\uc774 \\ub3c4\\uba54\\uc778\\uc5d0 \\ub4f1\\ub85d\\ub41c \\ud50c\\ub798\\uadf8 \\uc5c6\\uc74c</div>';

  var toggleHtml = S.flagToggleEnabled
    ? ''
    : '<div class="ov-warn mb8">\\u26a0 \\ud1a0\\uae00 UI \\ube44\\ud65c\\uc131 (flag_toggle_ui.enabled = false)</div>';

  var rows = domainFlags.map(function(flag) {
    var flagId = flag.id.replace('flag-', '');
    var liveVal = (flagId in S.liveFlags) ? S.liveFlags[flagId] : flag.value;
    return '<div class="flag-row">' +
      '<div class="flag-id">' + escHtml(flagId) + '</div>' +
      '<label class="toggle-wrap ' + (!S.flagToggleEnabled ? 'toggle-disabled' : '') + '">' +
      '<input type="checkbox" ' + (liveVal ? 'checked' : '') +
      (S.flagToggleEnabled ? ' onchange="toggleFlag(\\'' + escHtml(flagId) + '\\', this.checked)"' : ' disabled') +
      '>' +
      '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
      '<span class="toggle-val">' + (liveVal ? 'ON' : 'OFF') + '</span>' +
      '</label>' +
      '</div>';
  }).join('');

  return toggleHtml + '<div class="flag-list">' + rows + '</div>';
}

function renderQualityTab(n) {
  var stageLetters = ['A', 'B', 'C', 'D', 'E'];
  var rows = stageLetters.map(function(s) {
    var stageNode = S.byId[n.id + '-' + s];
    var status = stageNode ? stageNode.status : 'NOT_STARTED';
    return '<tr>' +
      '<td>Stage ' + s + '</td>' +
      '<td class="' + (status === 'PASS' ? 'gate-pass' : status === 'FAIL' ? 'gate-fail' : 'gate-idle') + '">' + status + '</td>' +
      '</tr>';
  }).join('');

  return '<table class="gate-table">' +
    '<thead><tr><th>\\uac8c\\uc774\\ud2b8</th><th>\\uacb0\\uacfc</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>' +
    '<div class="ov-label mt8">\\uc694\\uc57d</div>' +
    '<div class="ov-value ov-pass mt8">5/5 PASS</div>';
}

function mergeHeaders(base, extra) {
  var next = {};
  var key;
  for (key in base) next[key] = base[key];
  for (key in (extra || {})) next[key] = extra[key];
  return next;
}

var PENDING_IDEMPOTENCY_KEYS = {};

function stableStringifyForIdempotency(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(function(item) { return stableStringifyForIdempotency(item); }).join(',') + ']';
  }
  var keys = Object.keys(value).sort();
  return '{' + keys.map(function(key) {
    return JSON.stringify(key) + ':' + stableStringifyForIdempotency(value[key]);
  }).join(',') + '}';
}

function createClientIdempotencyKey(scope) {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return scope + ':' + window.crypto.randomUUID();
  }
  return scope + ':' + Date.now() + ':' + Math.random().toString(16).slice(2);
}

function reserveIdempotencyKey(scope, payload) {
  var fingerprint = stableStringifyForIdempotency(payload || {});
  var entry = PENDING_IDEMPOTENCY_KEYS[scope];
  if (entry && entry.fingerprint === fingerprint) {
    return entry.key;
  }
  var key = createClientIdempotencyKey(scope);
  PENDING_IDEMPOTENCY_KEYS[scope] = { key: key, fingerprint: fingerprint };
  return key;
}

function releaseIdempotencyKey(scope, key) {
  var entry = PENDING_IDEMPOTENCY_KEYS[scope];
  if (entry && entry.key === key) {
    delete PENDING_IDEMPOTENCY_KEYS[scope];
  }
}

function fetchJson(url, options) {
  var opts = options || {};
  var headers = mergeHeaders(AUTH_HEADERS, opts.headers || {});
  var method = String(opts.method || 'GET').toUpperCase();
  var idempotencyScope = opts.idempotencyScope;
  var reservedKey = '';
  if (method === 'POST' && idempotencyScope) {
    reservedKey = reserveIdempotencyKey(idempotencyScope, opts.idempotencyPayload);
    headers['Idempotency-Key'] = reservedKey;
  }
  var requestOptions = Object.assign({}, opts, { headers: headers });
  delete requestOptions.idempotencyScope;
  delete requestOptions.idempotencyPayload;
  return fetch(url, requestOptions).finally(function() {
    if (reservedKey && idempotencyScope) {
      releaseIdempotencyKey(idempotencyScope, reservedKey);
    }
  });
}

function fetchAuditLog(domainId) {
  fetchJson(S.apiBase + '/system/audit?domain=' + encodeURIComponent(domainId) + '&page_size=20')
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(data) {
      var entries = Array.isArray(data.entries) ? data.entries : [];
      var html = entries.length === 0
        ? '<div class="tab-empty">\\uac10\\uc0ac \\ub85c\\uadf8 \\uc5c6\\uc74c</div>'
        : '<div class="audit-list">' +
          entries.map(function(e) {
            return '<div class="audit-row">' +
              '<span class="audit-seq">#' + (e.seq || 0) + '</span>' +
              '<span class="audit-ts">' + escHtml(String(e.ts || '').slice(0, 16).replace('T', ' ')) + '</span>' +
              '<span class="audit-action">' + escHtml(e.action || '') + '</span>' +
              '<span class="audit-result ' + (e.result === 'PASS' ? 'gate-pass' : 'gate-fail') + '">' + escHtml(e.result || '') + '</span>' +
              '</div>';
          }).join('') +
          '</div>';
      document.getElementById('panel-body').innerHTML = html;
    })
    .catch(function() {
      document.getElementById('panel-body').innerHTML = '<div class="tab-empty">API \\uc5f0\\uacb0 \\uc5c6\\uc74c \\u2014 \\uc815\\uc801 \\ubaa8\\ub4dc</div>';
    });
}

// ─── Control actions ──────────────────────────────────────────────────────────
function toggleFlag(flagId, newVal) {
  S.liveFlags[flagId] = newVal;
  var flagNodeId = 'flag-' + flagId;
  var flagNode = S.byId[flagNodeId];
  if (flagNode) {
    flagNode.value = newVal;
    var dot = document.querySelector('[data-flag-dot="' + flagNodeId + '"]');
    if (dot) dot.setAttribute('fill', newVal ? '#4ade80' : '#f87171');
    var flagRect = document.querySelector('[data-id="' + flagNodeId + '"] rect');
    if (flagRect) flagRect.setAttribute('fill', newVal ? 'var(--node-flag-on)' : 'var(--node-flag-off)');
  }

  fetchJson(S.apiBase + '/system/flags/' + encodeURIComponent(flagId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: newVal }),
  }).catch(function() {
    S.liveFlags[flagId] = !newVal;
    showToast('\\ud50c\\ub798\\uadf8 \\uc5c5\\ub370\\uc774\\ud2b8 \\uc2e4\\ud328 (API \\uc5f0\\uacb0 \\uc5c6\\uc74c)');
    if (flagNode) flagNode.value = !newVal;
  });
}

function openRollbackModal(domainId) {
  var n = S.byId[domainId];
  if (!n) return;
  var modal = document.getElementById('confirm-modal');
  modal.querySelector('.modal-title').textContent = '\\ub864\\ubc31: ' + n.label;
  modal.querySelector('.modal-body').innerHTML = rollbackModalMarkup(n);
  modal.querySelector('.modal-reason').value = '';
  modal.dataset.target = domainId;
  modal.style.display = 'flex';
  refreshRollbackModalValidation();
}

function confirmRollback() {
  var modal = document.getElementById('confirm-modal');
  var validation = rollbackModalValidationState();
  if (!validation.ok) {
    refreshRollbackModalValidation();
    setExecutionStatus('warning', '롤백 확인 필요', validation.message);
    showToast('롤백 대상 다시 확인 필요');
    return;
  }
  var domainId = modal.dataset.target;
  var reason = modal.querySelector('.modal-reason').value || '';
  modal.style.display = 'none';

  fetchJson(S.apiBase + '/system/rollback/' + encodeURIComponent(domainId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason }),
  }).then(function() {
    pulseNode(domainId, 'red');
    showToast(domainId + ' \\ub864\\ubc31 \\uc644\\ub8cc');
  }).catch(function() {
    showToast('\\ub864\\ubc31 API \\uc5f0\\uacb0 \\uc5c6\\uc74c (\\uc815\\uc801 \\ubaa8\\ub4dc)');
  });
}

function pulseNode(nodeId, color) {
  var g = document.querySelector('[data-id="' + nodeId + '"]');
  if (!g) return;
  var shape = g.querySelector('circle, rect, polygon');
  if (!shape) return;
  var origFill = shape.getAttribute('fill');
  shape.setAttribute('fill', color === 'red' ? '#dc2626' : '#0f766e');
  setTimeout(function() { if (shape) shape.setAttribute('fill', origFill); }, 1200);
}

// ─── API hydration ────────────────────────────────────────────────────────────
function hydrateFromApi() {
  var base = S.apiBase;
  Promise.all([
    fetchJson(base + '/system/health').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
    fetchJson(base + '/system/flags').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
  ]).then(function(results) {
    var healthData = results[0], flagsData = results[1];
    if (healthData) applyHealthData(healthData);
    if (flagsData) applyFlagsData(flagsData);
    S.lastUpdate = new Date();
    updateStatusBar();
  });
}

function hydratePlanningSnapshot() {
  fetchJson(S.planningApiBase + '/snapshot')
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(payload) {
      if (!payload) return;
      var snapshot = payload.data || payload;
      S.planningSnapshot = snapshot;
      applyPlanningSnapshot(snapshot);
    })
    .catch(function() {
      return null;
    });
}

function applyPlanningSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  var currentWp = snapshot.current_wp || {};
  var nextActions = snapshot.next_actions || {};
  var completedCount = Array.isArray(snapshot.completed_packets) ? snapshot.completed_packets.length : 0;
  var changedCount = snapshot.code_status && typeof snapshot.code_status.changed_count === 'number'
    ? snapshot.code_status.changed_count
    : 0;

  if (currentWp.goal) S.statusSummary.goal = String(currentWp.goal);
  if (currentWp.stage) {
    S.statusSummary.currentStage = String(currentWp.stage).toUpperCase();
    S.statusSummary.progress = Math.max(S.statusSummary.progress || 0, stageProgress(currentWp.stage));
  }
  if (nextActions.next_wp) S.statusSummary.nextTask = String(nextActions.next_wp);
  if (changedCount > 0) S.statusSummary.blocker = '확인 필요 ' + changedCount + '개 변경';

  if (Array.isArray(snapshot.stage_run_recent_reports) && snapshot.stage_run_recent_reports.length > 0) {
    applyStageRunHistory(snapshot.stage_run_recent_reports);
  }
  if (snapshot.stage_run_last_report && typeof snapshot.stage_run_last_report === 'object' && Object.keys(snapshot.stage_run_last_report).length > 0) {
    applyStageRunReport(snapshot.stage_run_last_report);
  }

  var automationConfig = snapshot.automation || snapshot.automation_config || null;
  if (automationConfig && typeof automationConfig.enabled === 'boolean') {
    S.statusSummary.autoSendEnabled = automationConfig.enabled;
  }
  if (!String(S.execution.promptText || '').trim() && currentWp.goal) {
    S.execution.promptText = '[현재 목표]\n' + String(currentWp.goal) + '\n\n[다음 작업]\n' + String(nextActions.next_wp || 'NONE');
  }

  S.planRows = [
    {
      id: 'plan-intake',
      nodeId: 'control-intake',
      step: '1',
      task: '입력 이해',
      purpose: '사용자 요청과 packet 범위를 정리',
      input: String(currentWp.id || 'NONE'),
      output: String(currentWp.goal || '목표 미정'),
      status: laneStatusByStage(S.statusSummary.currentStage, 'control-intake'),
      priority: '최고',
      owner: 'Planner',
      nextAction: '계획 수립',
    },
    {
      id: 'plan-planning',
      nodeId: 'control-planning',
      step: '2',
      task: '계획 수립',
      purpose: 'active packet과 draft를 동기화',
      input: String(snapshot.default_packet_id || currentWp.id || 'NONE'),
      output: String((snapshot.planner_sections_draft || {}).updated_at || 'draft ready'),
      status: laneStatusByStage(S.statusSummary.currentStage, 'control-planning'),
      priority: '최고',
      owner: 'Planner',
      nextAction: '실행 포커스 이동',
    },
    {
      id: 'plan-execution',
      nodeId: 'control-execution',
      step: '3',
      task: '실행',
      purpose: '현재 packet 실행과 runtime bridge 연결',
      input: String(currentWp.id || 'NONE'),
      output: String(currentWp.status || 'pending'),
      status: laneStatusByStage(S.statusSummary.currentStage, 'control-execution'),
      priority: '최고',
      owner: 'Builder',
      nextAction: '검증 evidence 확보',
    },
    {
      id: 'plan-validation',
      nodeId: 'control-validation',
      step: '4',
      task: '검증',
      purpose: 'drift와 changed files 확인',
      input: String(changedCount) + ' changed',
      output: changedCount > 0 ? '재검토 필요' : 'clean',
      status: changedCount > 0 ? 'ready' : laneStatusByStage(S.statusSummary.currentStage, 'control-validation'),
      priority: '최고',
      owner: 'Reviewer',
      nextAction: '완료 판정',
    },
    {
      id: 'plan-complete',
      nodeId: 'control-complete',
      step: '5',
      task: '완료',
      purpose: '완료 packet과 다음 실행 연결',
      input: String(completedCount) + ' completed',
      output: String(nextActions.next_wp || 'NONE'),
      status: laneStatusByStage(S.statusSummary.currentStage, 'control-complete'),
      priority: '높음',
      owner: 'Reporter',
      nextAction: '다음 packet 이동',
    },
    {
      id: 'plan-module',
      nodeId: 'control-module',
      step: '6',
      task: '모듈 생성',
      purpose: 'preview -> dry-run -> confirm -> create',
      input: 'blueprint / recipe / domain',
      output: 'requirements preview',
      status: 'ready',
      priority: '최고',
      owner: 'Builder',
      nextAction: 'dry-run preview 실행',
    },
  ];
  var currentLaneRow = S.planRows.find(function(row) {
    return row.status === 'in_progress';
  });
  S.statusSummary.currentLaneId = currentLaneRow ? currentLaneRow.nodeId : 'control-planning';

  renderMasterStatus();
  renderExecutionConsole();
  renderPlanBoard();
  if (S.selected) renderPanel(S.selected);
}

function applyHealthData(data) {
  var domains = Array.isArray(data.domains) ? data.domains :
                (Array.isArray(data.domain_health) ? data.domain_health : []);
  domains.forEach(function(d) {
    S.liveHealth[d.id] = d;
    var n = S.byId[d.id];
    if (n) {
      n.healthScore = d.health_score !== undefined ? d.health_score : (d.score || 100);
      updateHealthBadge(n.id, n.healthScore);
    }
  });
  if (data.total_tests)   S.totalTests   = data.total_tests;
  if (data.passing_tests) S.passingTests = data.passing_tests;
}

function applyFlagsData(data) {
  var flags = Array.isArray(data.flags) ? data.flags : [];
  flags.forEach(function(f) {
    S.liveFlags[f.id] = f.value !== undefined ? f.value : f.enabled;
  });
}

function updateHealthBadge(nodeId, score) {
  var badge   = document.querySelector('[data-health-badge="' + nodeId + '"]');
  var scoreEl = document.querySelector('[data-health-score="' + nodeId + '"]');
  if (badge) {
    badge.setAttribute('fill',
      score >= 90 ? 'var(--health-green)' :
      score >= 70 ? 'var(--health-amber)' : 'var(--health-red)');
  }
  if (scoreEl) scoreEl.textContent = String(score);
}

// ─── SSE Client ───────────────────────────────────────────────────────────────
var _sseRetries = 0;
var _sseES = null;

function connectSSE() {
  if (typeof EventSource === 'undefined') {
    S.sseStatus = 'UNAVAILABLE';
    updateStatusBar();
    return;
  }
  try {
    _sseES = new EventSource(RAW.meta.sseUrl);

    _sseES.onopen = function() {
      S.sseStatus = 'CONNECTED';
      _sseRetries = 0;
      updateStatusBar();
    };

    _sseES.onerror = function() {
      S.sseStatus = 'RECONNECTING';
      updateStatusBar();
      _sseES.close();
      var delay = Math.min(2000 * Math.pow(2, _sseRetries), 30000) + Math.random() * 1000;
      _sseRetries++;
      setTimeout(connectSSE, delay);
    };

    _sseES.addEventListener('system.health.updated', function(e) {
      var payload = JSON.parse(e.data);
      if (Array.isArray(payload.changed_domains)) {
        payload.changed_domains.forEach(function(d) {
          var n = S.byId[d.id];
          if (n) {
            n.healthScore = d.health_score;
            updateHealthBadge(d.id, d.health_score);
          }
        });
      }
      if (payload.total_tests)   S.totalTests   = payload.total_tests;
      if (payload.passing_tests) S.passingTests = payload.passing_tests;
      S.lastUpdate = new Date();
      updateStatusBar();
    });

    _sseES.addEventListener('system.flag.toggled', function(e) {
      var payload = JSON.parse(e.data);
      var flagNodeId = 'flag-' + payload.flag_id;
      var flagNode = S.byId[flagNodeId];
      if (flagNode) {
        flagNode.value = payload.new_value;
        pulseNode(flagNodeId, payload.new_value ? 'green' : 'red');
      }
      S.liveFlags[payload.flag_id] = payload.new_value;
      if (S.selected && S.panelTab === 'flags') renderPanel(S.selected);
    });

    _sseES.addEventListener('system.rollback.triggered', function(e) {
      var payload = JSON.parse(e.data);
      pulseNode(payload.target_domain, 'red');
      showToast('\\ub864\\ubc31 \\ud2b8\\ub9ac\\uac70: ' + payload.target_domain);
    });

    _sseES.addEventListener('system.quality-gate.updated', function(e) {
      var payload = JSON.parse(e.data);
      var stageNodeId = payload.target_domain + '-' + (payload.gate_name || '').slice(-1);
      var stageNode = S.byId[stageNodeId];
      if (stageNode && payload.new_status) stageNode.status = payload.new_status;
      if (S.selected && S.panelTab === 'quality') renderPanel(S.selected);
    });

    _sseES.addEventListener('system.domain.lifecycle-changed', function(e) {
      var payload = JSON.parse(e.data);
      var stageNodeId = payload.target_domain + '-' + payload.stage;
      var stageNode = S.byId[stageNodeId];
      if (stageNode && payload.new_status) stageNode.status = payload.new_status;
      if (S.selected && S.panelTab === 'overview') renderPanel(S.selected);
    });

  } catch (err) {
    S.sseStatus = 'UNAVAILABLE';
    updateStatusBar();
  }
}

// ─── Status bar ───────────────────────────────────────────────────────────────
function updateStatusBar() {
  var sseEl    = document.getElementById('sb-sse');
  var testsEl  = document.getElementById('sb-tests');
  var updateEl = document.getElementById('sb-update');
  var zoomEl   = document.getElementById('sb-zoom');
  var countEl  = document.getElementById('sb-count');

  if (sseEl) {
    sseEl.textContent = 'SSE: ' + S.sseStatus;
    sseEl.className = 'sb-item ' +
      (S.sseStatus === 'CONNECTED'    ? 'sb-green' :
       S.sseStatus === 'RECONNECTING' ? 'sb-amber' : 'sb-red');
  }
  if (testsEl)  testsEl.textContent  = 'Tests: ' + S.passingTests + '/' + S.totalTests;
  if (updateEl) {
    var secs = S.lastUpdate ? Math.round((Date.now() - S.lastUpdate) / 1000) : null;
    updateEl.textContent = secs !== null ? '\\uc5c5\\ub370\\uc774\\ud2b8: ' + secs + '\\ucd08 \\uc804' : '\\uc5c5\\ub370\\uc774\\ud2b8: -';
  }
  if (zoomEl)  zoomEl.textContent  = 'Zoom: ' + Math.round(S.tk * 100) + '%';
  if (countEl) {
    var visibleCount = S.nodes.filter(function(node) { return !node.hiddenInGraph; }).length;
    countEl.textContent = 'Nodes: ' + visibleCount;
  }
}

function updateZoomDisplay() {
  var el = document.getElementById('sb-zoom');
  if (el) el.textContent = 'Zoom: ' + Math.round(S.tk * 100) + '%';
}

// ─── Keyboard shortcuts ────────────────────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case 'Escape': {
        var modal = document.getElementById('confirm-modal');
        if (modal.style.display !== 'none') { modal.style.display = 'none'; return; }
        deselectNode();
        break;
      }
      case '+': case '=':
        S.tk = Math.min(4, S.tk * 1.15);
        applyTransform(); updateZoomDisplay();
        break;
      case '-':
        S.tk = Math.max(0.2, S.tk * 0.85);
        applyTransform(); updateZoomDisplay();
        break;
      case 'ArrowLeft':  S.tx += 40; applyTransform(); break;
      case 'ArrowRight': S.tx -= 40; applyTransform(); break;
      case 'ArrowUp':    S.ty += 40; applyTransform(); break;
      case 'ArrowDown':  S.ty -= 40; applyTransform(); break;
      case 'r': case 'R':
        if (S.selected && S.rollbackEnabled) {
          var n = S.byId[S.selected];
          if (n && n.type === 'domain') openRollbackModal(S.selected);
        }
        break;
      case '0':
        fitView();
        break;
    }
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  var toast = document.getElementById('toast') || createToastEl();
  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
  }, 3000);
}

function createToastEl() {
  var el = document.createElement('div');
  el.id = 'toast';
  el.style.cssText = 'position:fixed;bottom:56px;left:50%;transform:translateX(-50%) translateY(10px);' +
    'background:#1f2a37;color:white;padding:8px 16px;border-radius:8px;font-size:13px;' +
    'opacity:0;transition:all 0.3s;z-index:200;pointer-events:none;white-space:nowrap;';
  document.body.appendChild(el);
  return el;
}

function clearDeepLinkHighlights() {
  ['execution-console', 'plan-board', 'master-status'].forEach(function(id) {
    var target = document.getElementById(id);
    if (target) target.classList.remove('deep-link-highlight');
  });
}

function highlightDeepLinkTarget(id) {
  clearDeepLinkHighlights();
  var target = document.getElementById(id);
  if (!target) return;
  target.classList.add('deep-link-highlight');
  setTimeout(function() {
    if (target) target.classList.remove('deep-link-highlight');
  }, 2800);
}

function controlCenterDeepLinkFocus() {
  try {
    return new URLSearchParams(window.location.search).get('focus') || '';
  } catch (error) {
    return '';
  }
}

function readControlCenterDeepLinkContext() {
  try {
    var params = new URLSearchParams(window.location.search);
    return normalizeDeepLinkContext({
      focus: String(params.get('focus') || '').trim(),
      reason: String(params.get('reason') || '').trim(),
      command: String(params.get('command') || '').trim(),
      label: String(params.get('label') || '').trim(),
      source: String(params.get('source') || '').trim(),
    });
  } catch (error) {
    return normalizeDeepLinkContext(null);
  }
}

function resolveControlCenterDeepLinkContext() {
  var liveContext = readControlCenterDeepLinkContext();
  if (hasDeepLinkContext(liveContext)) {
    saveDeepLinkContext(liveContext);
    return liveContext;
  }
  return loadStoredDeepLinkContext();
}

function deepLinkFocusLabel(focus) {
  var value = String(focus || '').trim();
  if (value === 'execution-failure') return '실행 실패 drill-down';
  if (value === 'guard') return '커밋 가드 drill-down';
  if (value === 'operator-summary') return 'operator summary drill-down';
  return 'drill-down';
}

function deepLinkDefaultReason(focus) {
  var value = String(focus || '').trim();
  if (value === 'execution-failure') return '최근 실패 기준으로 실행 콘솔을 확인하세요.';
  if (value === 'guard') return '커밋 가드 사유를 먼저 정리하세요.';
  if (value === 'operator-summary') return '최근 operator loop 상태를 먼저 확인하세요.';
  return '선택한 drill-down 컨텍스트를 확인하세요.';
}

function applyDeepLinkContextBar() {
  var context = resolveControlCenterDeepLinkContext();
  S.deepLinkContext = context;
  var bar = document.getElementById('deep-link-context-bar');
  var focusEl = document.getElementById('deep-link-context-focus');
  var reasonEl = document.getElementById('deep-link-context-reason');
  var commandEl = document.getElementById('deep-link-context-command');
  var loadEl = document.getElementById('deep-link-context-load');
  if (!bar) return context;

  var visible = !!(context.focus || context.reason || context.command);
  bar.hidden = !visible;
  if (!visible) {
    return context;
  }

  if (focusEl) focusEl.textContent = deepLinkFocusLabel(context.focus);
  if (reasonEl) reasonEl.textContent = context.reason || deepLinkDefaultReason(context.focus);
  if (commandEl) {
    commandEl.textContent = context.command || '권장 명령 없음';
    commandEl.title = context.command || '';
  }
  if (loadEl) {
    loadEl.disabled = !String(context.command || '').trim();
    loadEl.title = String(context.command || '').trim()
      ? 'deep-link로 전달된 권장 명령을 실행 패널에 채웁니다.'
      : '전달된 권장 명령이 없습니다.';
  }

  return context;
}

function applyControlCenterDeepLink() {
  var context = applyDeepLinkContextBar();
  var focus = String(context.focus || controlCenterDeepLinkFocus() || '').trim();
  if (!focus) return;

  if (focus === 'execution-failure') {
    selectNode('control-execution');
    highlightDeepLinkTarget('execution-console');
    showToast((context.reason || '최근 실패 기준') + ' / 실행 콘솔을 강조했습니다.');
    return;
  }

  if (focus === 'guard') {
    selectNode('control-validation');
    highlightDeepLinkTarget('plan-board');
    showToast((context.reason || '커밋 가드 기준') + ' / plan board를 강조했습니다.');
    return;
  }

  if (focus === 'operator-summary') {
    selectNode(S.statusSummary.currentLaneId || 'root');
    highlightDeepLinkTarget('master-status');
    showToast((context.reason || 'operator summary 기준') + ' / 통합 상태를 강조했습니다.');
  }
}

// ─── HTML escape ──────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Globals ──────────────────────────────────────────────────────────────────
window.deselectNode       = deselectNode;
window.switchTab          = switchTab;
window.toggleFlag         = toggleFlag;
window.openRollbackModal  = openRollbackModal;
window.confirmRollback    = confirmRollback;
window.fitView            = fitView;
window.selectControlNode  = selectControlNode;
window.syncExecutionInputs = syncExecutionInputs;
window.syncStageRunInputs = syncStageRunInputs;
window.focusExecutionWorker = focusExecutionWorker;
window.sendExecutionWorkerNow = sendExecutionWorkerNow;
window.retryExecutionWorker = retryExecutionWorker;
window.stopAutoSendFromWorkerCard = stopAutoSendFromWorkerCard;
window.sendPromptNow = sendPromptNow;
window.sendEnterNow = sendEnterNow;
window.dispatchSchedulerPromptNow = dispatchSchedulerPromptNow;
window.dispatchSchedulerEnterNow = dispatchSchedulerEnterNow;
window.retryLastPrompt = retryLastPrompt;
window.toggleAutoSendRuntime = toggleAutoSendRuntime;
window.openExecutionRollbackModal = openExecutionRollbackModal;
window.runSelectedStage = runSelectedStage;
window.retryLastStageRun = retryLastStageRun;
window.reuseStageRunHistory = reuseStageRunHistory;
window.rerunStageHistory = rerunStageHistory;
window.focusStageRunFailureSignal = focusStageRunFailureSignal;
window.focusPinnedStageRunFailureSignal = focusPinnedStageRunFailureSignal;
window.focusFailedCommandSignal = focusFailedCommandSignal;
window.focusPrerequisitesSignal = focusPrerequisitesSignal;
window.pinFailedCommandSignal = pinFailedCommandSignal;
window.pinPrerequisitesSignal = pinPrerequisitesSignal;
window.stepStageRunFailureMatch = stepStageRunFailureMatch;
window.setStageRunHistoryFilter = setStageRunHistoryFilter;
window.setStageRunSignalHistoryView = setStageRunSignalHistoryView;
window.setStageRunSignalGroupCollapsed = setStageRunSignalGroupCollapsed;
window.setStageRunHistorySort = setStageRunHistorySort;
window.loadRecommendedPrompt = loadRecommendedPrompt;
window.copyOperatorCommand = copyOperatorCommand;
window.loadOperatorCommandPrompt = loadOperatorCommandPrompt;
window.replayOperatorActionCopy = replayOperatorActionCopy;
window.replayOperatorActionLoad = replayOperatorActionLoad;
window.handleScaffoldInput = handleScaffoldInput;
window.handleScaffoldBlueprint = handleScaffoldBlueprint;
window.previewModuleScaffold = previewModuleScaffold;
window.createModuleScaffold = createModuleScaffold;
window.loadScaffoldCommand = loadScaffoldCommand;

setInterval(updateStatusBar, 10000);
setInterval(hydrateExecutionRuntime, 15000);

})();`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Workflow OS \u2014 \ud1b5\ud569 \ud1b5\uc81c \uc13c\ud130</title>
<style>
${css}
</style>
</head>
<body>
<div id="topbar">
  <div class="brand">
    <div class="brand-mark">WF</div>
    <div class="brand-copy"><strong>Workflow OS</strong><span>\ud1b5\ud569 \ud1b5\uc81c \uc13c\ud130</span></div>
  </div>
  <div class="topbar-actions">
    <span id="topbar-auto-send-badge" class="tb-auto-badge tb-auto-off" title="\uc790\ub3d9 \uc804\uc1a1 \uc0c1\ud0dc">\uc790\ub3d9\uc804\uc1a1 OFF</span>
    <span id="topbar-branch-readiness" class="tb-status-badge tb-info" title="\ube0c\ub79c\uce58 \uc900\ube44\ub3c4">\ube0c\ub79c\uce58 \ub300\uae30</span>
    <span id="topbar-commit-guard-badge" class="tb-status-badge tb-info" title="\ucee4\ubc0b \uac00\ub4dc">\uac00\ub4dc \ub300\uae30</span>
    <span id="topbar-operator-action-badge" class="tb-status-badge tb-info" title="\ucd5c\uadfc operator action">\uc561\uc158 \ub300\uae30</span>
    <button class="tb-btn" onclick="fitView()">\u21ba \ub9de\ucda4</button>
    <a class="tb-btn tb-btn-studio" href="../index.html#automation-bridge">Planning Studio</a>
    <a class="tb-btn" href="../index.html">\u2190 \ud648</a>
    <a class="tb-btn" href="../catalog-site/index.html">\uce74\ud0c8\ub85c\uadf8</a>
  </div>
</div>

<section id="master-status">
  <article class="master-card"><span>\ud604\uc7ac \ubaa9\ud45c</span><strong id="master-goal">-</strong></article>
  <article class="master-card"><span>\ud604\uc7ac \ub2e8\uacc4</span><strong id="master-stage">-</strong></article>
  <article class="master-card"><span>\uc9c4\ud589\ub960</span><strong id="master-progress">0%</strong></article>
  <article class="master-card"><span>\ucc28\ub2e8 \uc5ec\ubd80</span><strong id="master-blocker" class="master-value">-</strong></article>
  <article class="master-card"><span>\ub2e4\uc74c \uc791\uc5c5</span><strong id="master-next">-</strong></article>
  <article class="master-card"><span>\uad8c\uc7a5 \ube0c\ub79c\uce58</span><strong id="master-branch" class="master-value">-</strong></article>
  <article class="master-card"><span>\ucee4\ubc0b \uac00\ub4dc</span><strong id="master-guard" class="master-value">-</strong></article>
  <article class="master-card"><span>\ucd5c\uadfc action</span><strong id="master-action-history" class="master-value">-</strong></article>
  <article class="master-card master-card-auto"><span>\uc790\ub3d9 \uc804\uc1a1</span><strong id="master-auto-send" class="master-auto-off">OFF</strong></article>
</section>

<section id="deep-link-context-bar" class="deep-link-context-bar" hidden>
  <div class="deep-link-context-copy">
    <span class="deep-link-context-label">drill-down 포커스</span>
    <strong id="deep-link-context-focus" class="deep-link-context-value">-</strong>
  </div>
  <div class="deep-link-context-copy">
    <span class="deep-link-context-label">이동 이유</span>
    <span id="deep-link-context-reason" class="deep-link-context-reason">-</span>
  </div>
  <div class="deep-link-context-copy">
    <span class="deep-link-context-label">권장 명령</span>
    <code id="deep-link-context-command" class="deep-link-context-command">-</code>
  </div>
  <div class="deep-link-context-actions">
    <button id="deep-link-context-load" class="tb-btn" type="button" onclick="loadOperatorCommandPrompt('deep-link')">권장 명령 채우기</button>
  </div>
</section>

<aside id="control-sidebar">
  <section class="sidebar-section">
    <div class="sidebar-title">실행 제어</div>
    <div id="execution-console">${renderStageRunHistoryStatic(graphData.meta.stageRunHistory)}</div>
  </section>
  <section class="sidebar-section">
    <div class="sidebar-title">\ud1b5\uc81c \ud750\ub984</div>
    <div id="control-sidebar-list" class="sidebar-stack"></div>
  </section>
  <section class="sidebar-section">
    <div class="sidebar-title">\ub3c4\uba54\uc778 \ucd08\uc810</div>
    <div id="domain-sidebar-list" class="sidebar-stack"></div>
  </section>
</aside>

<div id="canvas-wrap">
  <svg id="mindmap-svg">
    <defs>
      <filter id="node-shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" flood-opacity="0.18"/>
      </filter>
      <linearGradient id="grad-root" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f766e"/>
        <stop offset="100%" stop-color="#1d4ed8"/>
      </linearGradient>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" fill="var(--muted)" opacity="0.6"/>
      </marker>
    </defs>
    <g id="graph-root">
      <g id="edges-layer"></g>
      <g id="nodes-layer"></g>
    </g>
  </svg>
  <div id="disabled-overlay" style="display:none">
    <div class="overlay-msg">
      <div class="overlay-icon">\u26a0</div>
      <div class="overlay-title">System API \ube44\ud65c\uc131</div>
      <div class="overlay-body">system_api.enabled = false<br>\ub9c8\uc778\ub4dc\ub9f5 \ucee8\ud2b8\ub864 \uae30\ub2a5\uc744 \uc0ac\uc6a9\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.</div>
    </div>
  </div>
</div>

<div id="detail-panel" class="panel-closed">
  <div id="panel-header"></div>
  <div id="panel-tabs"></div>
  <div id="panel-body"></div>
</div>

<section id="plan-board">
  <div class="plan-board-head">
    <div>
      <h3>\uc2e4\ud589 \uacc4\ud68d\ud45c</h3>
      <p>\ub178\ub4dc \uc120\ud0dd\uacfc \uac19\uc740 \ub370\uc774\ud130 \ubaa8\ub378\uc744 \ubcf4\ub294 \ud558\ub2e8 \ud1b5\uc81c\ud45c</p>
    </div>
  </div>
  <div class="kanban-board-head">
    <div>
      <strong>\uce78\ubc18 \ud750\ub984</strong>
      <span>\ub098\uc120\ud615 \uc6b4\uc601: Intake \u2192 Planning \u2192 Execution \u2192 Validation \u2192 Complete</span>
    </div>
  </div>
  <div id="kanban-board" class="kanban-board"></div>
  <div class="plan-board-wrap">
    <table class="plan-table">
      <thead>
        <tr>
          <th>\ub2e8\uacc4</th>
          <th>\uc791\uc5c5\uba85</th>
          <th>\ubaa9\uc801</th>
          <th>\uc785\ub825</th>
          <th>\ucd9c\ub825</th>
          <th>\uc0c1\ud0dc</th>
          <th>\uc6b0\uc120\uc21c\uc704</th>
          <th>\ub2f4\ub2f9 \uc5d0\uc774\uc804\ud2b8</th>
          <th>\ub2e4\uc74c \uc561\uc158</th>
        </tr>
      </thead>
      <tbody id="plan-table-body"></tbody>
    </table>
  </div>
</section>

<div id="status-bar">
  <span id="sb-sse" class="sb-item sb-red">SSE: DISCONNECTED</span>
  <span class="sb-sep">|</span>
  <span class="sb-item">\uc804\uccb4: HEALTHY</span>
  <span class="sb-sep">|</span>
  <span id="sb-tests" class="sb-item">Tests: 570/570</span>
  <span class="sb-sep">|</span>
  <span id="sb-update" class="sb-item">\uc5c5\ub370\uc774\ud2b8: -</span>
  <span class="sb-sep">|</span>
  <span id="sb-zoom" class="sb-item">Zoom: 100%</span>
  <span class="sb-sep">|</span>
  <span id="sb-count" class="sb-item">Nodes: 0</span>
  <span class="sb-hint">0 \ub9de\ucda4 | +/- \uc904 | \u2190\u2192\u2191\u2193 \uc774\ub3d9 | R \ub864\ubc31 | Esc \ub2eb\uae30</span>
</div>

<div id="confirm-modal" style="display:none">
  <div class="modal-backdrop" onclick="document.getElementById('confirm-modal').style.display='none'"></div>
  <div class="modal-box">
    <div class="modal-icon">\u26a0</div>
    <div class="modal-title"></div>
    <div class="modal-body"></div>
    <textarea class="modal-reason" placeholder="\ub864\ubc31 \uc0ac\uc720 (\uc120\ud0dd)"></textarea>
    <div class="modal-validation-state"></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="document.getElementById('confirm-modal').style.display='none'">\ucde8\uc18c</button>
      <button class="btn-confirm-rollback" onclick="confirmRollback()">\ub864\ubc31 \ud655\uc778</button>
    </div>
  </div>
</div>

<script id="mindmap-data" type="application/json">${graphJson}</script>
<script>${js}</script>
</body>
</html>`;
}

// ─── Build data ───────────────────────────────────────────────────────────────

function buildData() {
  const bundle = readYamlMany([
    'master-shell/feature-flags/flags.yaml',
    'master-shell/catalog/domains.yaml',
    'master-shell/observability/health-scores.yaml',
    'master-shell/plugin-registry/registry.yaml',
    'master-shell/navigation/nav.yaml',
    'memory/current-wp.yaml',
    'memory/next-actions.yaml',
    'memory/project/master-planner-draft.yaml',
    'master-shell/catalog/project-blueprints.yaml',
    'master-shell/catalog/ai-runtime-recipes.yaml',
    'master-shell/catalog/adapter-compatibility-matrix.yaml',
  ]);

  const graphData = buildGraphData(bundle);

  const stageRunHistoryRaw = readYaml('memory/project/stage-run-history.yaml');
  graphData.meta.stageRunHistory = Array.isArray(stageRunHistoryRaw) ? stageRunHistoryRaw.slice(0, 5) : [];

  const stageRunLatestRaw = readYaml('memory/project/stage-run-latest.yaml');
  graphData.meta.stageRunLatest = (
    stageRunLatestRaw &&
    typeof stageRunLatestRaw === 'object' &&
    !Array.isArray(stageRunLatestRaw) &&
    Object.keys(stageRunLatestRaw).length > 0
  ) ? stageRunLatestRaw : null;

  return graphData;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function buildMindmapRuntime() {
  const graphData = buildData();
  return {
    graphData,
    html: buildHtml(graphData),
  };
}

function main() {
  const runtime = buildMindmapRuntime();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, runtime.html, 'utf8');
  process.stdout.write('[ui:build] \ub9c8\uc778\ub4dc\ub9f5 \ucee8\ud2b8\ub864 \uc13c\ud130 \uc0dd\uc131 \uc644\ub8cc\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  buildData,
  buildHtml,
  buildMindmapRuntime,
};
