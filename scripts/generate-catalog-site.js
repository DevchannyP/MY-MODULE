#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { readYaml } = require('./run_stage');
// WP-UI-007: Shell SSE 통합
const { generateShellScript } = require('./lib/ui-shell');

const output = path.join(__dirname, '..', 'artifacts', 'catalog-site', 'index.html');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fileExists(relativePath) {
  if (!relativePath) {
    return false;
  }
  return fs.existsSync(path.join(__dirname, '..', relativePath));
}

const registry = readYaml('master-shell/plugin-registry/registry.yaml');
const nav = readYaml('master-shell/navigation/nav.yaml');
const plugins = Array.isArray(registry?.plugins) ? registry.plugins : [];
const navGroups = Array.isArray(nav?.navigation_groups) ? nav.navigation_groups : [];
const pluginMap = new Map(plugins.map((plugin) => [plugin.id, plugin]));

const groups = navGroups.map((group) => ({
  id: group.id,
  label: group.label || group.id,
  items: (Array.isArray(group.items) ? group.items : []).map((item) => {
    const plugin = pluginMap.get(item.plugin_id) || {};
    const uiContract = plugin.ui_contract || '';
    const contractDir = uiContract ? path.dirname(uiContract) : '';
    const docsPath = contractDir.replace(/\/contract(s)?$/, '/docs/README.md');
    return {
      groupLabel: group.label || group.id,
      label: item.label || plugin.name || item.plugin_id,
      route: item.route || plugin.entry_point || '',
      pluginId: item.plugin_id || '',
      owner: plugin.owner || '미정',
      status: plugin.status || 'unknown',
      featureFlag: item.feature_flag || plugin.feature_flag || '없음',
      architectureProfile: plugin.architecture_profile || '미정',
      uiContract,
      capabilityContract: plugin.capability_contract || '',
      openapi: contractDir ? `${contractDir}/openapi.yaml` : '',
      events: contractDir ? `${contractDir}/events.schema.json` : '',
      docsPath,
      notes: String(plugin.notes || '').trim(),
    };
  }),
}));

const allItems = groups.flatMap((group) => group.items);
const activeCount = allItems.filter((item) => item.status === 'active').length;

const groupCards = groups.map((group) => `
  <section class="group-card">
    <div class="group-head">
      <div>
        <div class="eyebrow">${esc(group.id)}</div>
        <h2>${esc(group.label)}</h2>
      </div>
      <div class="group-count">${group.items.length}개 화면</div>
    </div>
    <div class="plugin-grid">
      ${group.items.map((item) => `
        <article class="plugin-card">
          <div class="plugin-top">
            <div>
              <h3>${esc(item.label)}</h3>
              <div class="plugin-route"><code>${esc(item.route || '/')}</code></div>
            </div>
            <span class="status ${item.status === 'active' ? 'status-active' : 'status-inactive'}">${esc(item.status)}</span>
          </div>

          <p class="plugin-desc">${esc(item.groupLabel)} 그룹에 노출되는 플러그인입니다. 한국어 메뉴명과 계약 경로를 기준으로 확인합니다.</p>

          <div class="meta-list">
            <div class="meta-item"><span>플러그인 ID</span><strong>${esc(item.pluginId)}</strong></div>
            <div class="meta-item"><span>Feature Flag</span><strong>${esc(item.featureFlag)}</strong></div>
            <div class="meta-item"><span>Owner</span><strong>${esc(item.owner)}</strong></div>
            <div class="meta-item"><span>Architecture</span><strong>${esc(item.architectureProfile)}</strong></div>
          </div>

          <div class="contract-grid">
            ${[
              { label: 'OpenAPI', path: item.openapi },
              { label: 'Events', path: item.events },
              { label: 'UI Contract', path: item.uiContract },
              { label: 'Capability', path: item.capabilityContract },
            ].map((contract) => `
              <div class="contract-pill ${fileExists(contract.path) ? 'contract-ok' : 'contract-missing'}">
                <span>${contract.label}</span>
                <code>${esc(contract.path || '없음')}</code>
              </div>
            `).join('')}
          </div>

          ${item.notes ? `<div class="notes">${esc(item.notes)}</div>` : ''}
        </article>
      `).join('')}
    </div>
  </section>
`).join('');

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Workflow OS 도메인 카탈로그</title>
<style>
  :root {
    --bg: #f4efe5;
    --surface: #fffdf8;
    --surface-strong: #f9f1e2;
    --line: #ddcfb9;
    --text: #1f2937;
    --muted: #667085;
    --accent: #0f766e;
    --accent-2: #1d4ed8;
    --good: #0f766e;
    --warn: #b45309;
    --radius-xl: 28px;
    --radius-lg: 22px;
    --radius-md: 16px;
    --shadow: 0 18px 40px rgba(66, 51, 32, 0.08);
    --font-ui: "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    --font-mono: "JetBrains Mono", "D2Coding", monospace;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: var(--font-ui);
    color: var(--text);
    background:
      radial-gradient(circle at top left, rgba(15,118,110,0.14), transparent 22%),
      linear-gradient(180deg, #fcf8f0 0%, var(--bg) 100%);
  }

  code {
    font-family: var(--font-mono);
    background: #f0e7d8;
    padding: 2px 6px;
    border-radius: 8px;
    font-size: 12px;
    color: #7c3d0f;
  }

  .shell {
    width: min(1240px, calc(100vw - 32px));
    margin: 0 auto;
    padding: 24px 0 56px;
  }

  .topbar,
  .hero,
  .summary-card,
  .group-card,
  .plugin-card {
    background: rgba(255, 253, 248, 0.95);
    border: 1px solid rgba(221, 207, 185, 0.9);
    box-shadow: var(--shadow);
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: center;
    padding: 14px 18px;
    border-radius: 999px;
    position: sticky;
    top: 16px;
    z-index: 20;
    backdrop-filter: blur(12px);
  }

  .topbar strong { display: block; }
  .topbar span { color: var(--muted); font-size: 12px; }

  .top-links {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .top-links a,
  .hero-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 11px 14px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: white;
    color: var(--text);
    text-decoration: none;
    font-size: 13px;
    font-weight: 700;
  }

  .hero {
    margin-top: 24px;
    border-radius: var(--radius-xl);
    padding: 38px;
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(260px, 0.8fr);
    gap: 18px;
  }

  .eyebrow {
    display: inline-flex;
    padding: 7px 12px;
    border-radius: 999px;
    background: rgba(15,118,110,0.08);
    color: var(--accent);
    font-size: 12px;
    font-weight: 800;
    margin-bottom: 16px;
  }

  h1 {
    margin: 0;
    font-size: clamp(34px, 5vw, 54px);
    line-height: 1.05;
    letter-spacing: -0.04em;
  }

  .hero p {
    margin: 16px 0 0;
    color: var(--muted);
    font-size: 16px;
    line-height: 1.75;
  }

  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 22px;
  }

  .hero-action.primary {
    background: linear-gradient(135deg, #0f766e, #1d4ed8);
    color: white;
    border-color: transparent;
  }

  .hero-side {
    display: grid;
    gap: 12px;
  }

  .summary-card {
    border-radius: var(--radius-lg);
    padding: 18px;
  }

  .summary-card h2 {
    margin: 0 0 12px;
    font-size: 16px;
  }

  .summary-value {
    font-size: 34px;
    font-weight: 800;
    letter-spacing: -0.04em;
  }

  .summary-note {
    margin-top: 8px;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.6;
  }

  .group-card {
    border-radius: var(--radius-xl);
    padding: 24px;
    margin-top: 20px;
  }

  .group-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: end;
    margin-bottom: 18px;
  }

  .group-head h2 {
    margin: 0;
    font-size: 26px;
    letter-spacing: -0.03em;
  }

  .group-count {
    color: var(--muted);
    font-size: 13px;
  }

  .plugin-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .plugin-card {
    border-radius: var(--radius-lg);
    padding: 20px;
  }

  .plugin-top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: start;
  }

  .plugin-card h3 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -0.03em;
  }

  .plugin-route {
    margin-top: 8px;
  }

  .plugin-desc {
    margin: 16px 0 0;
    color: var(--muted);
    line-height: 1.7;
    font-size: 14px;
  }

  .status {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 7px 11px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    border: 1px solid transparent;
  }

  .status-active {
    background: rgba(15,118,110,0.1);
    color: var(--good);
    border-color: rgba(15,118,110,0.18);
  }

  .status-inactive {
    background: rgba(180,83,9,0.1);
    color: var(--warn);
    border-color: rgba(180,83,9,0.18);
  }

  .meta-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 18px;
  }

  .meta-item,
  .contract-pill,
  .notes {
    border-radius: 14px;
    background: #fbf6ec;
    border: 1px solid rgba(221, 207, 185, 0.78);
    padding: 12px 14px;
  }

  .meta-item span {
    display: block;
    color: var(--muted);
    font-size: 12px;
    margin-bottom: 4px;
  }

  .meta-item strong {
    font-size: 14px;
  }

  .contract-grid {
    display: grid;
    gap: 10px;
    margin-top: 18px;
  }

  .contract-pill {
    display: grid;
    gap: 8px;
  }

  .contract-pill span {
    font-size: 12px;
    color: var(--muted);
    font-weight: 700;
  }

  .contract-ok { border-left: 4px solid rgba(15,118,110,0.5); }
  .contract-missing { border-left: 4px solid rgba(180,83,9,0.5); }

  .notes {
    margin-top: 18px;
    color: var(--muted);
    line-height: 1.7;
    white-space: pre-wrap;
  }

  @media (max-width: 980px) {
    .topbar,
    .hero,
    .plugin-grid,
    .meta-list {
      grid-template-columns: 1fr;
    }

    .topbar,
    .hero {
      display: grid;
    }
  }
</style>
${generateShellScript()}
</head>
<body>
  <span data-sse-connect="/api/v1/system/events" hidden aria-hidden="true"></span>
  <div class="shell">
    <header class="topbar">
      <div>
        <strong>Workflow OS 도메인 카탈로그</strong>
        <span>계약 경로와 마스터 UI 메뉴를 한국어 기준으로 정리한 화면</span>
      </div>
      <div class="top-links">
        <a href="../index.html">홈</a>
        <a href="../master-planner/index.html">플래너</a>
        <a href="../study-guide/index.html">학습 가이드</a>
        <a href="../flags/index.html">피처 플래그</a>
        <a href="../audit/index.html">감사 로그</a>
        <a href="../quality/index.html">품질 게이트</a>
        <a href="../lifecycle/index.html">라이프사이클</a>
      </div>
    </header>

    <section class="hero">
      <div>
        <div class="eyebrow">메뉴 구조 + 계약 상태</div>
        <h1>플러그인과 계약 파일을<br>한눈에 읽는 카탈로그</h1>
        <p>
          이 화면은 마스터 UI에 연결된 메뉴 그룹을 기준으로 정리합니다.
          어떤 플러그인이 어떤 feature flag와 계약 파일을 쓰는지 바로 확인할 수 있게
          도메인 이름, 경로, owner, 상태를 한국어 중심으로 재배치했습니다.
        </p>
        <div class="hero-actions">
          <a class="hero-action primary" href="../master-planner/index.html">마스터 플래너 보기</a>
          <a class="hero-action" href="../index.html">루트 홈으로</a>
        </div>
      </div>
      <div class="hero-side">
        <div class="summary-card">
          <h2>등록된 메뉴 그룹</h2>
          <div class="summary-value">${groups.length}</div>
          <div class="summary-note">navigation/nav.yaml 기준 메뉴 그룹 수</div>
        </div>
        <div class="summary-card">
          <h2>플러그인 카드</h2>
          <div class="summary-value">${allItems.length}</div>
          <div class="summary-note">registry와 navigation을 결합한 표시 카드 수</div>
        </div>
        <div class="summary-card">
          <h2>현재 active 상태</h2>
          <div class="summary-value">${activeCount}</div>
          <div class="summary-note">status가 active인 플러그인 수</div>
        </div>
      </div>
    </section>

    ${groupCards}
  </div>
</body>
</html>`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html, 'utf-8');
process.stdout.write(`✅ 카탈로그 사이트: ${output}\n`);
