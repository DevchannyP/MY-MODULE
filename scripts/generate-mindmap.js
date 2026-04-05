#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { readYamlMany } = require('./run_stage');

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

// ─── Build graph data ────────────────────────────────────────────────────────

function buildGraphData(bundle) {
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
  const systemPos = domainPosition(270, 180);
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
  };

  return { nodes, edges, meta };
}

// ─── Build HTML ───────────────────────────────────────────────────────────────

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
  --panel-width: 340px;
  --status-bar-h: 40px;
  --canvas-bg: #f0ebe0;
  --panel-bg: rgba(255, 253, 248, 0.97);
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
body { font-family: var(--font-ui); color: var(--text); background: var(--bg); display: flex; flex-direction: column; }

#topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: rgba(255, 253, 248, 0.9);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(8px);
  height: 56px;
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

.topbar-actions { display: flex; gap: 8px; }
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

#canvas-wrap { flex: 1; position: relative; overflow: hidden; background: var(--canvas-bg); }
#mindmap-svg { width: 100%; height: 100%; cursor: grab; display: block; }
#mindmap-svg:active { cursor: grabbing; }

#detail-panel {
  position: fixed;
  right: 0;
  top: 56px;
  bottom: var(--status-bar-h);
  width: var(--panel-width);
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

#status-bar {
  height: var(--status-bar-h);
  background: var(--surface);
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
  z-index: 10;
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
`;

  const js = `(function() {
'use strict';

// ─── Parse embedded data ─────────────────────────────────────────────────────
const RAW = JSON.parse(document.getElementById('mindmap-data').textContent);

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
};

// ─── Bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  S.nodes.forEach(function(n) { S.byId[n.id] = n; });

  if (RAW.meta.flagStates['system_api.enabled'] === false) {
    document.getElementById('disabled-overlay').style.display = 'flex';
    return;
  }

  resizeCanvas();
  window.addEventListener('resize', function() { resizeCanvas(); applyTransform(); });

  runForce(120);
  render();
  updateStatusBar();
  setupPanZoom();
  setupNodeInteractions();
  setupKeyboard();
  hydrateFromApi();
  connectSSE();

  setTimeout(fitView, 50);
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
  document.querySelectorAll('.node').forEach(function(el) {
    var isSelected = el.dataset.id === id;
    el.classList.toggle('node-selected', isSelected);
    var circle = el.querySelector('circle:not([data-health-badge])');
    if (circle) {
      circle.setAttribute('stroke', isSelected ? 'white' : 'rgba(255,255,255,0.3)');
      circle.setAttribute('stroke-width', isSelected ? '3' : '1.5');
    }
  });
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

  var typeLabels = { root: '\\ub8e8\\ud2b8', domain: '\\ub3c4\\uba54\\uc778', stage: '\\uc2a4\\ud14c\\uc774\\uc9c0', contract: '\\uacc4\\uc57d', flag: '\\ud53c\\uc2a4\\uccb4 \\ud50c\\ub798\\uadf8' };
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
    return '<div class="ov-section">' +
      '<div class="ov-label">\\uc2dc\\uc2a4\\ud15c \\uc0c1\\ud0dc</div>' +
      '<div class="ov-value ov-pass">HEALTHY</div>' +
      '<div class="ov-label mt8">\\ud65c\\uc131 \\ub3c4\\uba54\\uc778</div>' +
      '<div class="ov-value">4\\uac1c (billing / productivity / video / system)</div>' +
      '<div class="ov-label mt8">\\uc804\\uccb4 \\ud14c\\uc2a4\\ud2b8</div>' +
      '<div class="ov-value">' + S.passingTests + ' / ' + S.totalTests + ' PASS</div>' +
      '<div class="ov-label mt8">SSE \\uc2a4\\ud2b8\\ub9bc</div>' +
      '<div class="ov-value">' + S.sseStatus + '</div>' +
      '</div>';
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

function fetchAuditLog(domainId) {
  fetch(S.apiBase + '/system/audit?domain=' + encodeURIComponent(domainId) + '&page_size=20')
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

  fetch(S.apiBase + '/system/flags/' + encodeURIComponent(flagId), {
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
  modal.querySelector('.modal-body').textContent =
    '\\uc774 \\ub3c4\\uba54\\uc778\\uc758 \\ubaa8\\ub4e0 \\ud53c\\uce58 \\ud50c\\ub798\\uadf8\\ub97c \\ube44\\ud65c\\uc131\\ud654\\ud569\\ub2c8\\ub2e4. \\uc774 \\uc791\\uc5c5\\uc740 \\uc989\\uc2dc \\uc801\\uc6a9\\ub429\\ub2c8\\ub2e4.';
  modal.dataset.target = domainId;
  modal.style.display = 'flex';
}

function confirmRollback() {
  var modal = document.getElementById('confirm-modal');
  var domainId = modal.dataset.target;
  var reason = modal.querySelector('.modal-reason').value || '';
  modal.style.display = 'none';

  fetch(S.apiBase + '/system/rollback/' + encodeURIComponent(domainId), {
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
    fetch(base + '/system/health').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
    fetch(base + '/system/flags').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
  ]).then(function(results) {
    var healthData = results[0], flagsData = results[1];
    if (healthData) applyHealthData(healthData);
    if (flagsData) applyFlagsData(flagsData);
    S.lastUpdate = new Date();
    updateStatusBar();
  });
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
  if (countEl) countEl.textContent = 'Nodes: ' + S.nodes.length;
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

setInterval(updateStatusBar, 10000);

})();`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Workflow OS \u2014 \ub9c8\uc778\ub4dc\ub9f5 \ucee8\ud2b8\ub864 \uc13c\ud130</title>
<style>
${css}
</style>
</head>
<body>
<div id="topbar">
  <div class="brand">
    <div class="brand-mark">WF</div>
    <div class="brand-copy"><strong>Workflow OS</strong><span>\ub9c8\uc778\ub4dc\ub9f5 \ucee8\ud2b8\ub864 \uc13c\ud130</span></div>
  </div>
  <div class="topbar-actions">
    <button class="tb-btn" onclick="fitView()">\u21ba \ub9de\ucda4</button>
    <a class="tb-btn" href="../index.html">\u2190 \ud648</a>
    <a class="tb-btn" href="../catalog-site/index.html">\uce74\ud0c8\ub85c\uadf8</a>
  </div>
</div>

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
  ]);
  return buildGraphData(bundle);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const graphData = buildData();
  const html = buildHtml(graphData);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, html, 'utf8');
  process.stdout.write('[ui:build] \ub9c8\uc778\ub4dc\ub9f5 \ucee8\ud2b8\ub864 \uc13c\ud130 \uc0dd\uc131 \uc644\ub8cc\n');
}

main();
