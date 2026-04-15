#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { buildReport } = require('./project_status');
const { readYaml } = require('./run_stage');
const { KANBAN_LANES, inferLaneId, laneMeta, buildFocusPacket } = require('./packet_flow');
const { buildBootstrapSummary } = require('./session_bootstrap');
const { buildOperatorCockpitSummary } = require('./operator_cockpit');
const { OPERATOR_ACTION_CLIENT_RUNTIME_SOURCE } = require('../src/shared/operatorActionClientRuntimeSource');
const { DEEP_LINK_CLIENT_RUNTIME_SOURCE } = require('../src/shared/deepLinkClientRuntimeSource');
const { BROWSER_UTILITY_RUNTIME_SOURCE } = require('../src/shared/browserUtilityRuntimeSource');
// WP-UI-006: System OS Live Data 통합 (Stage D)
const { generateShellScript } = require('./lib/ui-shell');
const { SystemApiClient } = require('./lib/system-api-client');

const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'artifacts', 'index.html');
// eslint-disable-next-line no-unused-vars -- used inside embedded <script> template (ESLint cannot track template-literal script scope)
const HOME_ACTION_SOURCE_STORAGE_KEY = 'workflow-os.home-action-sources';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function domIdToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function statusClass(value) {
  const normalized = String(value || '').toLowerCase();
  if (['pass', 'ready', 'active', 'clean', 'true'].includes(normalized)) {
    return 'tone-green';
  }
  if (['none', 'inactive', 'out-of-route', 'operator-collected', 'operator-triggered'].includes(normalized)) {
    return 'tone-amber';
  }
  return 'tone-slate';
}

function buildNavigationSummary(nav, registry) {
  const plugins = Array.isArray(registry?.plugins) ? registry.plugins : [];
  const pluginMap = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const groups = Array.isArray(nav?.navigation_groups) ? nav.navigation_groups : [];

  return groups.map((group) => {
    const items = Array.isArray(group.items) ? group.items : [];
    return {
      id: group.id,
      label: group.label || group.id,
      items: items.map((item) => {
        const plugin = pluginMap.get(item.plugin_id) || {};
        return {
          label: item.label || plugin.name || item.plugin_id,
          route: item.route || plugin.entry_point || '',
          pluginId: item.plugin_id || '',
          featureFlag: item.feature_flag || plugin.feature_flag || '',
          status: plugin.status || 'unknown',
          owner: plugin.owner || '미정',
        };
      }),
    };
  });
}

function buildStaticControlCenterHref(focus, targetId, meta = {}) {
  const params = new URLSearchParams();
  if (focus) params.set('focus', String(focus).trim());
  if (meta.reason) params.set('reason', String(meta.reason).trim());
  if (meta.command) params.set('command', String(meta.command).trim());
  if (meta.label) params.set('label', String(meta.label).trim());
  if (meta.source) params.set('source', String(meta.source).trim());
  const query = params.toString();
  return `mindmap/index.html${query ? `?${query}` : ''}${targetId ? `#${targetId}` : ''}`;
}

function operatorChainPriority(status) {
  const normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'blocked') return 0;
  if (normalized === 'pending') return 1;
  if (normalized === 'ready') return 2;
  if (normalized === 'completed') return 3;
  return 4;
}

function selectPreferredOperatorChainItem(operatorChain) {
  if (!Array.isArray(operatorChain) || operatorChain.length < 1) {
    return null;
  }
  return operatorChain
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const priorityGap = operatorChainPriority(left.item?.status) - operatorChainPriority(right.item?.status);
      return priorityGap !== 0 ? priorityGap : left.index - right.index;
    })[0].item;
}

function buildOperatorChainFocusMeta(item) {
  const itemId = String(item?.id || '').trim();
  const targetId = itemId === 'verify' || itemId === 'commit-guard' ? 'plan-board' : 'master-status';
  const focus = itemId === 'verify' || itemId === 'commit-guard' ? 'guard' : 'operator-summary';
  const href = buildStaticControlCenterHref(focus, targetId, {
    reason: item?.reason || item?.label || 'operator chain step',
    command: item?.command || '',
    label: item?.label || item?.id || 'step',
    source: 'home-chain',
  });
  return { targetId, focus, href };
}

function buildOperatorChainExecutionMeta(item) {
  const href = buildStaticControlCenterHref('execution-failure', 'execution-console', {
    reason: item?.reason || item?.label || 'operator chain command',
    command: item?.command || '',
    label: item?.label || item?.id || 'step',
    source: 'home-spotlight',
  });
  return { href };
}

function buildFlowStatusSection({ report, currentState, nextActions, bootstrap, operatorCockpit }) {
  const focusPacket = buildFocusPacket({ report, nextActions, currentWp: bootstrap?.current_wp });
  const currentLaneId = inferLaneId({
    status: focusPacket.status,
    stage: focusPacket.stage,
    completed: !focusPacket.active && ['completed', 'pass', 'done', 'closed'].includes(String(focusPacket.status || '').toLowerCase()),
  });
  const currentLane = laneMeta(currentLaneId);
  const qualityGateResult = String(currentState?.release_summary?.quality_gate_result || 'UNKNOWN');
  const validationCommands = Array.isArray(bootstrap?.validation_profile?.commands)
    ? bootstrap.validation_profile.commands
    : [];
  const recommendedReads = Array.isArray(bootstrap?.recommended_reads)
    ? bootstrap.recommended_reads.slice(0, 3)
    : [];
  const nextActionLabel = focusPacket.active
    ? `${String(focusPacket.id || 'WP')} · ${String(focusPacket.goal || '진행 중 작업')}`
    : `${String(report.next_wp || nextActions?.next_wp || 'NONE')}`;
  const operatorChain = Array.isArray(operatorCockpit?.operator_chain)
    ? operatorCockpit.operator_chain.slice(0, 5)
    : [];
  const spotlightItem = selectPreferredOperatorChainItem(operatorChain);
  const spotlightMeta = spotlightItem ? buildOperatorChainFocusMeta(spotlightItem) : null;
  const spotlightExecutionMeta = spotlightItem ? buildOperatorChainExecutionMeta(spotlightItem) : null;
  const spotlightHtml = spotlightItem
    ? `
      <article class="flow-chain-spotlight" id="flow-chain-spotlight" data-chain-id="${esc(spotlightItem.id || 'step')}">
        <div class="flow-chain-spotlight-copy">
          <span class="flow-kicker">지금 실행할 카드</span>
          <strong id="flow-chain-spotlight-title">${esc(spotlightItem.label || spotlightItem.id || 'step')}</strong>
          <p id="flow-chain-spotlight-reason">${esc(spotlightItem.reason || '다음 operator action 설명 없음')}</p>
        </div>
        <div class="flow-chain-spotlight-actions">
          <span class="tag ${statusClass(spotlightItem.status || 'pending')}" id="flow-chain-spotlight-status">${esc(spotlightItem.status || 'pending')}</span>
          <code id="flow-chain-spotlight-command">${esc(spotlightItem.command || '')}</code>
          <div class="flow-chain-spotlight-links">
            <button type="button" class="flow-chain-link is-button" id="flow-chain-spotlight-copy" data-command="${esc(spotlightItem.command || '')}">명령 복사</button>
            <a class="flow-chain-link" id="flow-chain-spotlight-fill" href="${esc(spotlightExecutionMeta?.href || 'mindmap/index.html#execution-console')}">실행 패널에 채우기</a>
            <a class="flow-chain-link" id="flow-chain-spotlight-link" href="${esc(spotlightMeta?.href || 'mindmap/index.html')}">바로 열기</a>
          </div>
        </div>
      </article>`
    : '';
  const operatorChainHtml = operatorChain.length > 0
    ? operatorChain.map((item) => {
      const itemId = String(item.id || '').trim();
      const scope = `chain:${itemId || 'step'}`;
      const deliveryToken = domIdToken(itemId || item.label || 'step');
      const deliveryId = `flow-chain-delivery-${deliveryToken}`;
      const deliveryMetaId = `flow-chain-delivery-meta-${deliveryToken}`;
      const focusMeta = buildOperatorChainFocusMeta(item);
      return `
      <div class="flow-chain-item${spotlightItem && spotlightItem.id === itemId ? ' is-active' : ''}" data-chain-id="${esc(itemId || 'step')}" data-chain-scope="${esc(scope)}" data-chain-command="${esc(item.command || '')}">
        <span class="flow-chain-label">${esc(item.label || item.id || 'step')}</span>
        <span class="tag ${statusClass(item.status || 'pending')}">${esc(item.status || 'pending')}</span>
        <code>${esc(item.command || '')}</code>
        <div class="flow-chain-delivery">
          <span class="flow-chain-delivery-pill" id="${esc(deliveryId)}" data-delivery-status="none">최근 전달 없음</span>
          <span class="flow-chain-delivery-meta" id="${esc(deliveryMetaId)}">실행 이력 없음</span>
        </div>
        <a class="flow-chain-link" href="${esc(focusMeta.href)}">control center에서 이어서 보기</a>
      </div>`;
    }).join('')
    : '<div class="flow-chain-empty">operator chain 정보 없음</div>';
  const releaseEvidence = operatorCockpit?.promotion_evidence || {};

  return `
    <div class="section-head" style="margin-top:36px">
      <div>
        <h2>연속 실행 오퍼레이터 바</h2>
        <p>같은 짧은 프롬프트를 반복해도 현재 레인, 다음 액션, 검증 루프를 같은 기준으로 이어갑니다.</p>
      </div>
      <div class="flow-pill">반복 프롬프트 <strong>계속</strong></div>
    </div>

    <section class="flow-strip" aria-label="연속 실행 상태">
      <article class="flow-card flow-card-primary">
        <div class="flow-card-head">
          <span class="flow-kicker">Current Lane</span>
          <span class="tag tone-green">${esc(currentLane.label)}</span>
        </div>
        <h3>${esc(focusPacket.id || 'NONE')}</h3>
        <p>${esc(focusPacket.goal || '현재 focus packet 없음')}</p>
        <div class="flow-meta">
          <span>stage ${esc(focusPacket.stage || '—')}</span>
          <span>status ${esc(focusPacket.status || '—')}</span>
        </div>
      </article>

      <article class="flow-card">
        <div class="flow-card-head">
          <span class="flow-kicker">Next Action</span>
          <span class="tag tone-amber">${esc(report.next_wp || nextActions?.next_wp || 'NONE')}</span>
        </div>
        <h3>다음 한 단계</h3>
        <p>${esc(nextActionLabel)}</p>
        <div class="flow-meta">
          <span>branch ${esc(bootstrap?.git?.branch || 'unknown')}</span>
          <span>dirty ${bootstrap?.git?.dirty ? `${esc(bootstrap.git.dirty_count)}건` : '없음'}</span>
        </div>
      </article>

      <article class="flow-card">
        <div class="flow-card-head">
          <span class="flow-kicker">Validation State</span>
          <span class="tag ${statusClass(qualityGateResult)}">${esc(qualityGateResult)}</span>
        </div>
        <h3>검증 루프</h3>
        <p>${validationCommands.length}개 명령이 현재 packet 프로파일에 연결돼 있습니다.</p>
        <div class="flow-code-list">
          ${validationCommands.slice(0, 3).map((command) => `<code>${esc(command)}</code>`).join('')}
        </div>
      </article>

      <article class="flow-card">
        <div class="flow-card-head">
          <span class="flow-kicker">Read First</span>
          <span class="tag tone-slate">${esc(bootstrap?.current_wp?.stage || '—')}</span>
        </div>
        <h3>세션 복구</h3>
        <p>채팅 대신 고정 파일을 먼저 읽고 차이만 처리합니다.</p>
        <div class="flow-code-list">
          ${recommendedReads.map((item) => `<code>${esc(item)}</code>`).join('')}
        </div>
      </article>
    </section>

    <section class="flow-chain-panel" aria-label="operator chain">
      <div class="flow-chain-head">
        <div>
          <h3>Operator Chain</h3>
          <p>홈 화면과 control center가 같은 operator chain 상태를 공유합니다.</p>
        </div>
        <div class="flow-chain-head-pills">
          <div class="flow-pill">Action Sources <strong id="flow-source-summary">source 집계 없음</strong></div>
          <div class="flow-pill">Release Evidence <strong>${esc(releaseEvidence.quality_gate_result || 'UNKNOWN')}</strong></div>
        </div>
      </div>
      ${spotlightHtml}
      <div class="flow-chain-grid">
        ${operatorChainHtml}
      </div>
    </section>`;
}

function buildHtml({ report, navSummary, currentState, wpQueue, nextActions, bootstrap, operatorCockpit,
                     sysHealth = null, sysFlags = null, sysCatalog = null, sysQg = null }) {
  const improvements = Array.isArray(report.essential_improvements) ? report.essential_improvements : [];
  const issues = Array.isArray(report.known_issues) ? report.known_issues : [];
  const capabilities = Array.isArray(currentState?.working_capabilities) ? currentState.working_capabilities : [];
  const stageSummary = Array.isArray(report.stage_summary) ? report.stage_summary : [];

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Workflow OS 운영 홈</title>
<style>.skip-link{position:absolute;left:-9999px;top:8px;padding:6px 12px;background:#0f766e;color:#fff;border-radius:6px;font-size:13px;z-index:9999}.skip-link:focus{left:8px}</style>
<style>
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
  }

  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    font-family: var(--font-ui);
    color: var(--text);
    background:
      radial-gradient(circle at top left, rgba(15,118,110,0.16), transparent 28%),
      radial-gradient(circle at top right, rgba(194,65,12,0.12), transparent 24%),
      linear-gradient(180deg, #fcf8ef 0%, var(--bg) 100%);
  }

  a { color: inherit; text-decoration: none; }

  .shell {
    width: min(1240px, calc(100vw - 32px));
    margin: 0 auto;
    padding: 24px 0 56px;
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: center;
    padding: 14px 18px;
    background: rgba(255, 253, 248, 0.88);
    border: 1px solid rgba(220, 207, 186, 0.8);
    border-radius: 999px;
    backdrop-filter: blur(12px);
    box-shadow: var(--shadow);
    position: sticky;
    top: 16px;
    z-index: 30;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .brand-mark {
    width: 42px;
    height: 42px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, #0f766e, #1d4ed8);
    color: white;
    font-weight: 800;
    box-shadow: 0 10px 22px rgba(29, 78, 216, 0.18);
  }

  .brand-copy strong {
    display: block;
    font-size: 15px;
    letter-spacing: -0.02em;
  }

  .brand-copy span {
    color: var(--muted);
    font-size: 12px;
  }

  .top-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip-link,
  .cta,
  .page-link {
    border-radius: 999px;
    border: 1px solid transparent;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }

  .chip-link {
    padding: 10px 14px;
    background: rgba(255,255,255,0.9);
    border-color: var(--line);
    font-size: 13px;
    color: var(--muted);
  }

  .chip-link:hover,
  .cta:hover,
  .page-link:hover {
    transform: translateY(-1px);
    box-shadow: 0 10px 18px rgba(15, 118, 110, 0.12);
  }

  .hero {
    margin-top: 24px;
    padding: 40px;
    border-radius: var(--radius-xl);
    background:
      linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,247,234,0.92)),
      linear-gradient(120deg, rgba(15,118,110,0.07), transparent 40%);
    border: 1px solid rgba(220, 207, 186, 0.9);
    box-shadow: var(--shadow);
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.7fr);
    gap: 22px;
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    border-radius: 999px;
    background: rgba(15,118,110,0.08);
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
    margin-bottom: 16px;
  }

  h1 {
    margin: 0;
    font-size: clamp(34px, 5vw, 56px);
    line-height: 1.06;
    letter-spacing: -0.04em;
  }

  .hero p {
    margin: 16px 0 0;
    color: var(--muted);
    font-size: 17px;
    line-height: 1.7;
  }

  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 24px;
  }

  .cta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 14px 18px;
    font-size: 14px;
    font-weight: 700;
  }

  .cta-primary {
    background: linear-gradient(135deg, #0f766e, #1d4ed8);
    color: white;
  }

  .cta-secondary {
    background: white;
    color: var(--text);
    border-color: var(--line);
  }

  .hero-side {
    padding: 20px;
    border-radius: var(--radius-lg);
    background: rgba(255,255,255,0.72);
    border: 1px solid rgba(220, 207, 186, 0.95);
  }

  .hero-side h2 {
    margin: 0 0 14px;
    font-size: 16px;
  }

  .loop-card {
    margin-top: 14px;
    padding: 16px;
    border-radius: var(--radius-lg);
    background: linear-gradient(135deg, rgba(15,118,110,0.08), rgba(29,78,216,0.07));
    border: 1px solid rgba(15, 118, 110, 0.18);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.45);
  }

  .loop-card h3 {
    margin: 0 0 10px;
    font-size: 15px;
    letter-spacing: -0.02em;
  }

  .loop-list {
    display: grid;
    gap: 10px;
  }

  .loop-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .loop-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(255,255,255,0.72);
    border: 1px solid rgba(220, 207, 186, 0.72);
    font-size: 13px;
  }

  .loop-row strong {
    text-align: right;
  }

  .side-list {
    display: grid;
    gap: 10px;
  }

  .side-item {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 14px;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    background: rgba(255, 248, 238, 0.95);
    border: 1px solid rgba(220, 207, 186, 0.75);
  }

  .side-item strong {
    font-weight: 700;
  }

  .muted { color: var(--muted); }

  .stats,
  .page-grid,
  .content-grid {
    display: grid;
    gap: 16px;
  }

  .stats {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-top: 18px;
  }

  .stat-card,
  .panel,
  .page-card {
    background: var(--surface);
    border: 1px solid rgba(220, 207, 186, 0.92);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
  }

  .stat-card {
    padding: 18px;
  }

  .stat-label {
    color: var(--muted);
    font-size: 12px;
    margin-bottom: 8px;
  }

  .stat-value {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.04em;
  }

  .stat-note {
    margin-top: 8px;
    color: var(--muted);
    font-size: 12px;
  }

  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 14px;
    margin: 40px 0 16px;
  }

  .section-head h2 {
    margin: 0;
    font-size: 24px;
    letter-spacing: -0.03em;
  }

  .section-head p {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 14px;
  }

  .page-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .page-card {
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .page-card h3 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -0.03em;
  }

  .page-card p {
    margin: 0;
    color: var(--muted);
    line-height: 1.7;
    font-size: 14px;
  }

  .page-link {
    margin-top: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 14px;
    background: #f4efe4;
    border-color: var(--line);
    font-size: 14px;
    font-weight: 700;
  }

  .content-grid {
    grid-template-columns: 1.15fr 0.85fr;
    align-items: start;
  }

  .panel {
    padding: 22px;
  }

  .panel h3 {
    margin: 0 0 14px;
    font-size: 19px;
    letter-spacing: -0.02em;
  }

  .panel-list {
    display: grid;
    gap: 10px;
  }

  .panel-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    padding: 12px 14px;
    border-radius: 14px;
    background: #fbf7ef;
    border: 1px solid rgba(220, 207, 186, 0.7);
  }

  .panel-row strong {
    display: block;
    margin-bottom: 3px;
    font-size: 14px;
  }

  .panel-row span {
    color: var(--muted);
    font-size: 12px;
  }

  .tag {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    border: 1px solid transparent;
  }

  .tone-green { color: var(--green); background: rgba(15,118,110,0.1); border-color: rgba(15,118,110,0.18); }
  .tone-amber { color: var(--amber); background: rgba(180,83,9,0.1); border-color: rgba(180,83,9,0.18); }
  .tone-slate { color: var(--slate); background: rgba(71,85,105,0.1); border-color: rgba(71,85,105,0.18); }

  .nav-groups {
    display: grid;
    gap: 14px;
  }

  .nav-group {
    padding: 18px;
    border-radius: 18px;
    background: #fffaf0;
    border: 1px solid rgba(220, 207, 186, 0.8);
  }

  .nav-group h4 {
    margin: 0 0 12px;
    font-size: 18px;
  }

  .nav-item {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px 14px;
    padding: 12px 0;
    border-top: 1px dashed rgba(220, 207, 186, 0.9);
  }

  .nav-item:first-child { border-top: none; padding-top: 0; }

  .nav-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
    font-size: 11px;
    color: var(--muted);
  }

  .nav-meta code,
  .cmd-list code {
    font-family: var(--font-mono);
    background: #f3ead8;
    padding: 2px 6px;
    border-radius: 8px;
    color: #6b3d08;
  }

  .cmd-list {
    display: grid;
    gap: 10px;
  }

  .cmd-item {
    padding: 14px;
    border-radius: 16px;
    background: #f7f2e8;
    border: 1px solid rgba(220, 207, 186, 0.78);
  }

  .cmd-item strong {
    display: block;
    margin-bottom: 8px;
  }

  .foot {
    margin-top: 32px;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
  }

  @media (max-width: 980px) {
    .hero,
    .content-grid,
    .page-grid,
    .stats {
      grid-template-columns: 1fr;
    }

    .topbar {
      border-radius: 28px;
      align-items: stretch;
      flex-direction: column;
    }
  }
${KANBAN_CSS}
</style>
${generateShellScript()}
</head>
<body>
  <a href="#main-content" class="skip-link">본문으로 건너뛰기</a>
  <span data-sse-connect="/api/v1/system/events" hidden aria-hidden="true"></span>
${buildSystemOsSection(sysHealth, sysFlags, sysCatalog, sysQg)}
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">WO</div>
        <div class="brand-copy">
          <strong>Workflow OS 운영 홈</strong>
          <span>한국어 중심으로 다시 정리한 정적 포털 첫 화면</span>
        </div>
      </div>
      <button class="chip-link" aria-controls="home-stat-detail" style="cursor:pointer;border:none;background:rgba(15,118,110,0.08);border:1px solid rgba(15,118,110,0.3);border-radius:999px;padding:6px 12px;font-size:12px;color:#0f766e;" onclick="document.getElementById('home-stat-detail').scrollIntoView({behavior:'smooth'})">운영 상태 보기</button>
      <span id="live-autosend-badge" style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;background:rgba(220,207,186,0.4);color:#61707f;border:1px solid rgba(220,207,186,0.6);">상태 로딩...</span>
      <button id="btn-autosend-toggle" style="display:none;padding:4px 10px;border-radius:999px;font-size:11px;background:transparent;border:1px solid rgba(15,118,110,0.4);color:#0f766e;cursor:pointer;margin-left:4px;" aria-label="자동 전송 ON/OFF 전환">전환</button>
      <nav aria-label="주요 운영 화면">
      <div class="top-actions">
        <a class="chip-link" href="master-planner/index.html">마스터 플래너</a>
        <a class="chip-link" href="catalog-site/index.html">도메인 카탈로그</a>
        <a class="chip-link" href="study-guide/index.html">학습 가이드</a>
        <a class="chip-link" href="flags/index.html">피처 플래그</a>
        <a class="chip-link" href="audit/index.html">감사 로그</a>
        <a class="chip-link" href="quality/index.html">품질 게이트</a>
        <a class="chip-link" href="lifecycle/index.html">라이프사이클</a>
      </div>
      </nav>
    </header>

    <section class="hero" id="main-content">
      <div>
        <div class="eyebrow">운영자 시작 화면</div>
        <h1>지금 필요한 화면을 바로 찾고,<br>현재 상태를 한눈에 확인합니다.</h1>
        <p>
          이 홈은 <code>artifacts/</code> 루트에서 바로 열리는 안내 화면입니다.
          복잡한 planner, 카탈로그, 학습 문서를 한국어 중심으로 이어 주고,
          현재 stage · Work Packet · 품질 상태를 첫 화면에서 보여줍니다.
        </p>
        <div class="hero-actions">
          <a class="cta cta-primary" href="master-planner/index.html">플래너 바로 열기</a>
          <a class="cta cta-secondary" href="catalog-site/index.html">도메인 보기</a>
          <a class="cta cta-secondary" href="study-guide/index.html">학습 경로 보기</a>
        </div>
      </div>
      <aside class="hero-side">
        <h2>지금 상태</h2>
        <div class="side-list">
          <div class="side-item"><span class="muted">요구사항 Stage</span><strong>${esc(report.requirements_stage || '—')}</strong></div>
          <div class="side-item"><span class="muted">현재 Work Packet</span><strong id="live-current-wp">${esc(report.current_wp || 'NONE')}</strong></div>
          <div class="side-item"><span class="muted">다음 Work Packet</span><strong>${esc(report.next_wp || 'NONE')}</strong></div>
          <div class="side-item"><span class="muted">프로모션 파이프라인</span><strong>${esc(report.promotion_pipeline?.drift_status || '—')}</strong></div>
          <div class="side-item"><span class="muted">자동 전송</span><strong id="live-autosend-state">—</strong></div>
          <div class="side-item"><span class="muted">브랜치</span><strong id="live-branch-status">—</strong></div>
          <div class="side-item"><span class="muted">터미널 세션</span><strong id="live-pty-sessions">—</strong></div>
          <div class="side-item"><span class="muted">스케줄러</span><strong id="live-pty-scheduler">—</strong></div>
          <div class="side-item"><span class="muted">활성 플래그</span><strong id="live-active-flags" title="클릭하면 /flags 전체 목록 이동" style="cursor:pointer;" onclick="window.open('/flags','_blank')">—</strong></div>
          <div class="side-item"><span class="muted">ENV 오버라이드</span><strong id="live-env-overrides" style="color:var(--accent-2)">—</strong></div>
          <div class="side-item"><span class="muted">최근 operator action</span><strong id="live-operator-action">—</strong></div>
        </div>
        <div class="loop-card">
          <h3>최근 Operator Loop</h3>
        <div class="loop-list">
          <div class="loop-row"><span class="muted">상태</span><strong id="live-loop-status">—</strong></div>
          <div class="loop-row"><span class="muted">권장 브랜치</span><strong id="live-loop-branch">—</strong></div>
          <div class="loop-row"><span class="muted">다음 가드 행동</span><strong id="live-loop-next">—</strong></div>
        </div>
        <div class="loop-actions">
            <a id="live-loop-primary-link" class="page-link" href="mindmap/index.html?focus=execution-failure&reason=%EC%B5%9C%EA%B7%BC%20operator%20action%20%EC%8B%A4%ED%8C%A8&command=npm%20run%20operator%3Acockpit&source=home-loop#execution-console">실행 콘솔 열기</a>
            <a id="live-loop-secondary-link" class="page-link" href="mindmap/index.html?focus=guard&reason=%EC%BB%A4%EB%B0%8B%20%EA%B0%80%EB%93%9C%20%ED%99%95%EC%9D%B8%20%ED%95%84%EC%9A%94&command=npm%20run%20commit%3Aguard&source=home-loop#plan-board">plan board 열기</a>
            <a id="live-loop-summary-link" class="page-link" href="mindmap/index.html?focus=operator-summary&reason=operator%20%EC%83%81%ED%83%9C%20%EC%A0%84%EC%B2%B4%20%ED%99%95%EC%9D%B8&command=npm%20run%20operator%3Acockpit&source=home-loop#master-status" style="display:none">통합 상태 열기</a>
        </div>
      </div>
    </aside>
    </section>

    <section class="stats" id="home-stat-detail">
      <article class="stat-card">
        <div class="stat-label">헬스 레이팅</div>
        <div class="stat-value">${esc(currentState?.health_metrics?.last_known?.health_rating || '—')}</div>
        <div class="stat-note">게이트 통과율 ${esc(currentState?.health_metrics?.last_known?.gate_pass_rate_pct || '—')}%</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">활성 capability</div>
        <div class="stat-value">${capabilities.length}</div>
        <div class="stat-note">현재 상태 파일 기준 pass capability 수</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">잠금 토큰</div>
        <div class="stat-value">${esc(report.promotion_pipeline?.locked_tokens || 0)}</div>
        <div class="stat-note">프로모션 파이프라인 context lock 기준</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">미결 이슈</div>
        <div class="stat-value">${issues.length}</div>
        <div class="stat-note">현재 known issues 수</div>
      </article>
    </section>

    ${buildFlowStatusSection({ report, currentState, nextActions, bootstrap, operatorCockpit })}

    ${buildKanbanSection(wpQueue)}

    <div class="section-head">
      <div>
        <h2>화면 바로가기</h2>
        <p>운영 목적에 맞는 화면을 고르면 됩니다.</p>
      </div>
    </div>
    <section class="page-grid">
      <article class="page-card">
        <h3>통합 통제 센터</h3>
        <p>도메인 라이프사이클, 피처 플래그, 실행 계획표, 롤백 제어를 한 화면에서 직접 조작하는 마스터 컨트롤 패널입니다.</p>
        <a class="page-link" href="mindmap/index.html">열기</a>
      </article>
      <article class="page-card">
        <h3>마스터 플래너</h3>
        <p>Work Packet, stage, AI planning surface, benchmark 흐름을 한 화면에서 보는 메인 운영 콘솔입니다.</p>
        <a class="page-link" href="master-planner/index.html">열기</a>
      </article>
      <article class="page-card">
        <h3>도메인 카탈로그</h3>
        <p>플러그인별 계약 파일, owner, feature flag, 메뉴 노출 경로를 빠르게 확인하는 화면입니다.</p>
        <a class="page-link" href="catalog-site/index.html">열기</a>
      </article>
      <article class="page-card">
        <h3>학습 가이드</h3>
        <p>ADR, 로드맵, 도메인 역량을 정리한 한국어 학습 화면입니다. 신규 참여자 온보딩에 적합합니다.</p>
        <a class="page-link" href="study-guide/index.html">열기</a>
      </article>
    </section>

    <div class="section-head">
      <div>
        <h2>운영 요약</h2>
        <p>현재 stage와 개선 포인트, 메뉴 구성을 한 번에 봅니다.</p>
      </div>
    </div>
    <section class="content-grid">
      <div class="panel">
        <h3>Stage 상태</h3>
        <div class="panel-list">
          ${stageSummary.map((item) => `
            <div class="panel-row">
              <div>
                <strong>Stage ${esc(item.stage)}</strong>
                <span>${esc(item.docs_ref || '')}</span>
              </div>
              <span class="tag ${statusClass(item.route_status)}">${esc(item.route_status || 'unknown')}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="panel">
        <h3>필수 개선 3종</h3>
        <div class="panel-list">
          ${improvements.map((item) => `
            <div class="panel-row">
              <div>
                <strong>${esc(item.id)}</strong>
                <span>${esc(item.detail || '')}</span>
              </div>
              <span class="tag ${statusClass(item.ready ? 'ready' : 'pending')}">${item.ready ? '준비됨' : '점검 필요'}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <div class="section-head">
      <div>
        <h2>메뉴 구조</h2>
        <p>마스터 UI에 연결된 도메인 메뉴를 한국어 기준으로 정리했습니다.</p>
      </div>
    </div>
    <section class="panel nav-groups">
      ${navSummary.map((group) => `
        <div class="nav-group">
          <h4>${esc(group.label)}</h4>
          ${(group.items || []).map((item) => `
            <div class="nav-item">
              <div>
                <strong>${esc(item.label)}</strong>
                <div class="nav-meta">
                  <span>경로 <code>${esc(item.route || '/')}</code></span>
                  <span>플래그 <code>${esc(item.featureFlag || '없음')}</code></span>
                  <span>owner ${esc(item.owner)}</span>
                </div>
              </div>
              <span class="tag ${statusClass(item.status)}">${esc(item.status)}</span>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </section>

    <div class="section-head">
      <div>
        <h2>권장 명령</h2>
        <p>정적 UI와 현재 상태를 다시 맞출 때 가장 많이 쓰는 명령입니다.</p>
      </div>
    </div>
    <section class="panel">
      <div class="cmd-list">
        <div class="cmd-item">
          <strong>UI 전체 재생성</strong>
          <code>npm run ui:build</code>
        </div>
        <div class="cmd-item">
          <strong>현재 상태 확인</strong>
          <code>npm run project:status</code>
        </div>
        <div class="cmd-item">
          <strong>다음 Work Packet 확인</strong>
          <code>npm run wp:next</code>
        </div>
      </div>
    </section>

    <p class="foot" style="font-size:12px;color:#61707f;margin-top:8px;">같은 자동화 저장 재시도는 안전하게 재사용됩니다. 같은 계획 초안을 다시 저장해도 중복 기록되지 않습니다.</p>
    <p class="foot">생성 소스: <code>memory/current-state.yaml</code>, <code>memory/current-wp.yaml</code>, <code>master-shell/navigation/nav.yaml</code>, <code>master-shell/plugin-registry/registry.yaml</code></p>
  </div>
<script>
${OPERATOR_ACTION_CLIENT_RUNTIME_SOURCE}
${DEEP_LINK_CLIENT_RUNTIME_SOURCE}
${BROWSER_UTILITY_RUNTIME_SOURCE}
async function callPlanningApi(endpoint, body) {
  try {
    const opts = body
      ? {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        idempotencyScope: 'planning-studio:' + endpoint,
        idempotencyPayload: body,
      }
      : {};
    const resp = await fetchJsonClient('/api/planning-studio/' + endpoint, opts);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) { return null; }
}
async function callJson(path, { method = 'GET', body } = {}) {
  try {
    const opts = { method };
    if (body) { opts.headers = { 'content-type': 'application/json' }; opts.body = JSON.stringify(body); }
    const resp = await fetchJsonClient(path, opts);
    if (!resp.ok) return null;
    return await resp.json();
    } catch (_) { return null; }
}
function normalizeHomeActionSourceEntries(entries) {
  return normalizeOperatorActionClientEntries(entries).map(function(entry) {
    return {
      id: entry.id,
      source: entry.source,
      command: entry.command,
      ts: entry.ts,
    };
  }).filter(function(entry) {
    return entry.id || (entry.source && entry.command);
  }).slice(0, 6);
}
function loadHomeActionSources() {
  return normalizeHomeActionSourceEntries(loadOperatorActionClientStorage(HOME_ACTION_SOURCE_STORAGE_KEY));
}
function saveHomeActionSources(entries) {
  saveOperatorActionClientStorage(HOME_ACTION_SOURCE_STORAGE_KEY, normalizeHomeActionSourceEntries(entries));
}
function mergeHomeActionSource(action) {
  var nextHistory = normalizeHomeActionSourceEntries(mergeOperatorActionClientEntries(loadHomeActionSources(), action));
  saveHomeActionSources(nextHistory);
  return nextHistory;
}
function summarizeHomeActionSources(entries) {
  return operatorActionClientSourceSummary(normalizeHomeActionSourceEntries(entries));
}
function updateHomeActionSourceSummary(entries) {
  var summaryEl = document.getElementById('flow-source-summary');
  if (!summaryEl) {
    return;
  }
  summaryEl.textContent = summarizeHomeActionSources(entries);
}
function createHomeOperatorActionId(scope) {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return String(scope || 'home-action') + ':' + window.crypto.randomUUID();
  }
  return String(scope || 'home-action') + ':' + Date.now() + ':' + Math.random().toString(16).slice(2);
}
function copyTextToClipboard(value) {
  return copyTextToClipboardClient(value);
}
function buildControlCenterHref(focus, targetId, meta = {}) {
  return buildDeepLinkClientHref('mindmap/index.html', focus, targetId, meta);
}
function buildHomeOperatorActionPayload(item, action) {
  var itemId = String(item && item.id || '').trim();
  return {
    id: createHomeOperatorActionId('home-spotlight:' + (itemId || 'step')),
    action: String(action || 'unknown'),
    label: String(item && (item.label || item.id) || 'Operator Chain'),
    scope: 'chain:' + itemId,
    source: 'home-spotlight',
    command: String(item && item.command || '').trim(),
    delivery_status: 'unsent',
    delivery_message: '실제 전송 전',
    delivery_ts: '',
    ts: new Date().toISOString(),
  };
}
function syncHomeOperatorAction(payload, options) {
  var normalized = payload && typeof payload === 'object' ? payload : null;
  if (!normalized || !String(normalized.command || '').trim() || !String(normalized.label || '').trim()) {
    return Promise.resolve(null);
  }
  var keepalive = !!(options && options.keepalive);
  return fetch('/api/ui/operator-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized),
    keepalive: keepalive,
  })
    .then(function(response) {
      if (!response.ok) return null;
      return response.json().catch(function() { return null; });
    })
    .catch(function() { return null; });
}
function chainDeliveryDomId(itemId) {
  return 'flow-chain-delivery-' + String(itemId || 'item')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function chainDeliveryMetaDomId(itemId) {
  return 'flow-chain-delivery-meta-' + String(itemId || 'item')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function operatorActionDeliveryTone(status) {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'unsent') return 'unsent';
  return 'none';
}
function operatorChainItemPriority(status) {
  var normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'blocked') return 0;
  if (normalized === 'pending') return 1;
  if (normalized === 'ready') return 2;
  if (normalized === 'completed') return 3;
  return 4;
}
function selectHomeOperatorChainItem(operatorCockpit, recentAction) {
  var chain = operatorCockpit && Array.isArray(operatorCockpit.operator_chain)
    ? operatorCockpit.operator_chain
    : [];
  if (chain.length < 1) {
    return null;
  }
  if (recentAction && typeof recentAction === 'object') {
    for (var i = 0; i < chain.length; i += 1) {
      var item = chain[i] || {};
      var sameScope = String(recentAction.scope || '').trim() === ('chain:' + String(item.id || '').trim());
      var sameCommand = String(recentAction.command || '').trim()
        && String(recentAction.command || '').trim() === String(item.command || '').trim();
      if (sameScope || sameCommand) {
        return item;
      }
    }
  }
  var ranked = chain.slice().sort(function(left, right) {
    return operatorChainItemPriority(left && left.status) - operatorChainItemPriority(right && right.status);
  });
  return ranked[0] || chain[0];
}
function updateHomeOperatorChainSpotlight(item) {
  var spotlight = document.getElementById('flow-chain-spotlight');
  var titleEl = document.getElementById('flow-chain-spotlight-title');
  var reasonEl = document.getElementById('flow-chain-spotlight-reason');
  var statusEl = document.getElementById('flow-chain-spotlight-status');
  var commandEl = document.getElementById('flow-chain-spotlight-command');
  var copyBtn = document.getElementById('flow-chain-spotlight-copy');
  var fillEl = document.getElementById('flow-chain-spotlight-fill');
  var linkEl = document.getElementById('flow-chain-spotlight-link');
  var cards = document.querySelectorAll('.flow-chain-item[data-chain-id]');
  for (var i = 0; i < cards.length; i += 1) {
    cards[i].classList.remove('is-active');
  }
  if (!spotlight || !titleEl || !reasonEl || !statusEl || !commandEl || !copyBtn || !fillEl || !linkEl || !item) {
    return;
  }
  var itemId = String(item.id || '').trim();
  var targetId = itemId === 'verify' || itemId === 'commit-guard' ? 'plan-board' : 'master-status';
  var focus = itemId === 'verify' || itemId === 'commit-guard' ? 'guard' : 'operator-summary';
  spotlight.dataset.chainId = itemId || '';
  titleEl.textContent = String(item.label || item.id || 'step');
  reasonEl.textContent = String(item.reason || '다음 operator action 설명 없음');
  statusEl.textContent = String(item.status || 'pending');
  statusEl.className = 'tag ' + statusClass(String(item.status || 'pending'));
  commandEl.textContent = String(item.command || '');
  copyBtn.dataset.command = String(item.command || '');
  copyBtn.dataset.label = String(item.label || item.id || 'step');
  copyBtn.dataset.scope = 'chain:' + itemId;
  copyBtn.dataset.chainId = itemId;
  fillEl.href = buildControlCenterHref('execution-failure', 'execution-console', {
    reason: item.reason || item.label || 'operator chain command',
    command: item.command || '',
    label: item.label || item.id || 'step',
    source: 'home-spotlight',
  });
  fillEl.dataset.command = String(item.command || '');
  fillEl.dataset.label = String(item.label || item.id || 'step');
  fillEl.dataset.scope = 'chain:' + itemId;
  fillEl.dataset.chainId = itemId;
  linkEl.href = buildControlCenterHref(focus, targetId, {
    reason: item.reason || item.label || 'operator chain step',
    command: item.command || '',
    label: item.label || item.id || 'step',
    source: 'home-chain',
  });
  var activeCard = document.querySelector('.flow-chain-item[data-chain-id="' + itemId.replace(/"/g, '\\"') + '"]');
  if (activeCard) {
    activeCard.classList.add('is-active');
  }
}
function operatorActionDeliveryLabel(status) {
  if (status === 'success') return '성공';
  if (status === 'failed') return '실패';
  if (status === 'unsent') return '미전송';
  return '없음';
}
function operatorActionDeliverySummary(action) {
  if (!action || typeof action !== 'object') {
    return {
      label: '최근 전달 없음',
      meta: '실행 이력 없음',
      tone: 'none',
    };
  }
  var deliveryStatus = String(action.delivery_status || 'unsent');
  var meta = '';
  if (String(action.delivery_message || '').trim()) {
    meta = String(action.delivery_message || '').trim();
  } else if (String(action.label || '').trim()) {
    meta = String(action.label || '').trim();
  }
  return {
    label: '최근 전달 ' + operatorActionDeliveryLabel(deliveryStatus),
    meta: meta || '최근 메시지 없음',
    tone: operatorActionDeliveryTone(deliveryStatus),
  };
}
function updateHomeOperatorChainDeliveries(operatorCockpit, recentAction) {
  var chain = operatorCockpit && Array.isArray(operatorCockpit.operator_chain)
    ? operatorCockpit.operator_chain
    : [];
  for (var i = 0; i < chain.length; i += 1) {
    var item = chain[i] || {};
    var itemId = String(item.id || '').trim();
    var deliveryEl = document.getElementById(chainDeliveryDomId(itemId || item.label || 'item'));
    var deliveryMetaEl = document.getElementById(chainDeliveryMetaDomId(itemId || item.label || 'item'));
    if (!deliveryEl) continue;
    var expectedScope = 'chain:' + itemId;
    var sameScope = recentAction
      && String(recentAction.scope || '').trim()
      && String(recentAction.scope || '').trim() === expectedScope;
    var sameCommand = recentAction
      && String(recentAction.command || '').trim()
      && String(recentAction.command || '').trim() === String(item.command || '').trim();
    var matchedAction = recentAction && (sameScope || sameCommand) ? recentAction : null;
    var delivery = operatorActionDeliverySummary(matchedAction);
    deliveryEl.textContent = delivery.label;
    deliveryEl.dataset.deliveryStatus = delivery.tone;
    if (deliveryMetaEl) {
      deliveryMetaEl.textContent = delivery.meta;
      deliveryMetaEl.dataset.deliveryStatus = delivery.tone;
      deliveryMetaEl.title = matchedAction && String(matchedAction.command || '').trim()
        ? String(matchedAction.command || '').trim()
        : '';
    }
  }
}
function updateAutosendUi(autoSend) {
  const badge = document.getElementById('live-autosend-badge');
  const stateEl = document.getElementById('live-autosend-state');
  const toggleBtn = document.getElementById('btn-autosend-toggle');
  if (badge) {
    const on = !!autoSend.enabled;
    badge.textContent = on ? '자동 전송 ON' : '자동 전송 OFF';
    badge.style.background = on ? 'rgba(15,118,110,0.15)' : 'rgba(220,207,186,0.4)';
    badge.style.color = on ? '#0f766e' : '#61707f';
  }
  if (stateEl) stateEl.textContent = autoSend.enabled ? 'ON' : 'OFF';
  if (toggleBtn) toggleBtn.style.display = 'inline-block';
}
document.addEventListener('DOMContentLoaded', async () => {
  const result = await callPlanningApi('snapshot');
  if (!result || !result.ok) {
    const badge = document.getElementById('live-autosend-badge');
    if (badge) { badge.textContent = '서버 오프라인'; }
    return;
  }
  const d = result.data || {};
  let autoSend = d.automation_config || {};
  updateAutosendUi(autoSend);
  const wpEl = document.getElementById('live-current-wp');
  if (wpEl && d.current_wp) wpEl.textContent = d.current_wp.id || '—';
  const branchEl = document.getElementById('live-branch-status');
  if (branchEl && d.code_status) {
    branchEl.textContent = (d.code_status.dirty ? '⚡ ' : '') + (d.code_status.branch || '—');
  }
  const toggleBtn = document.getElementById('btn-autosend-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      toggleBtn.disabled = true;
      const saveResult = await callPlanningApi('save-automation', {
        enabled: !autoSend.enabled,
        cycle_minutes: autoSend.cycle_minutes || 30,
        enter_seconds: autoSend.enter_seconds || 10,
        workers: autoSend.workers || [],
      });
      if (saveResult && saveResult.ok) {
        autoSend = (saveResult.data || {}).automation_config || autoSend;
        updateAutosendUi(autoSend);
      }
      toggleBtn.disabled = false;
    });
  }
  const currentWpId = (d.current_wp || {}).id;
  if (currentWpId) {
    const wpEl2 = document.getElementById('live-current-wp');
    if (wpEl2) {
      wpEl2.title = '클릭하여 현재 패킷을 다음 실행 대상으로 설정';
      wpEl2.style.cursor = 'pointer';
      wpEl2.addEventListener('click', async () => {
        await callPlanningApi('save-packet', { id: currentWpId, set_as_next: true });
      });
    }
  }

  const ptySessions = await fetch('/api/pty/sessions').then((r) => r.ok ? r.json() : null).catch(() => null);
  const ptySessionsEl = document.getElementById('live-pty-sessions');
  if (ptySessionsEl) {
    if (ptySessions && typeof ptySessions.count === 'number') {
      ptySessionsEl.textContent = ptySessions.count > 0 ? (ptySessions.count + '개 연결됨') : '없음';
    } else {
      ptySessionsEl.textContent = '브리지 오프라인';
    }
  }

  const ptyScheduler = await callJson('/api/pty/scheduler/status', { method: 'GET' });
  const ptySchedulerEl = document.getElementById('live-pty-scheduler');
  if (ptySchedulerEl) {
    if (ptyScheduler && typeof ptyScheduler.running === 'boolean') {
      ptySchedulerEl.textContent = ptyScheduler.running ? '실행 중' : '중지됨';
    } else {
      ptySchedulerEl.textContent = '브리지 오프라인';
    }
  }

  // 활성 Feature Flag 상태 — .env WOS_FLAG_* 오버라이드 가시성
  const flagsData = await callJson('/flags', { method: 'GET' }).catch(() => null);
  const activeFlagsEl = document.getElementById('live-active-flags');
  const envOverridesEl = document.getElementById('live-env-overrides');
  if (flagsData && Array.isArray(flagsData.flags)) {
    const enabledCount = (flagsData.enabled_flags || []).length;
    const overrideCount = typeof flagsData.env_overrides_applied === 'number' ? flagsData.env_overrides_applied : 0;
    if (activeFlagsEl) {
      activeFlagsEl.textContent = enabledCount > 0 ? (enabledCount + '개 활성') : '모두 비활성';
      activeFlagsEl.title = enabledCount > 0
        ? ('활성: ' + (flagsData.enabled_flags || []).join(', ') + ' — 클릭하면 /flags 전체 목록 이동')
        : '클릭하면 /flags 전체 목록 이동';
    }
    if (envOverridesEl) {
      envOverridesEl.textContent = overrideCount > 0 ? (overrideCount + '개 .env 적용') : '없음';
      if (overrideCount > 0 && (flagsData.env_overridden_flags || []).length > 0) {
        envOverridesEl.title = 'ENV 오버라이드: ' + flagsData.env_overridden_flags.join(', ');
      }
    }
  } else {
    if (activeFlagsEl) activeFlagsEl.textContent = '서버 오프라인';
    if (envOverridesEl) envOverridesEl.textContent = '—';
  }

  const homeRuntime = await callJson('/ui/home-runtime', { method: 'GET' }).catch(() => null);
  const recentOperatorActionEl = document.getElementById('live-operator-action');
  const recentLoopStatusEl = document.getElementById('live-loop-status');
  const recentLoopBranchEl = document.getElementById('live-loop-branch');
  const recentLoopNextEl = document.getElementById('live-loop-next');
  const recentLoopPrimaryLinkEl = document.getElementById('live-loop-primary-link');
  const recentLoopSecondaryLinkEl = document.getElementById('live-loop-secondary-link');
  const recentAction = homeRuntime && homeRuntime.runtime_state
    ? homeRuntime.runtime_state.recent_operator_action
    : null;
  if (recentOperatorActionEl) {
    if (recentAction && typeof recentAction === 'object') {
      const deliveryLabel = recentAction.delivery_status === 'success'
        ? '성공'
        : recentAction.delivery_status === 'failed'
          ? '실패'
          : '미전송';
      recentOperatorActionEl.textContent = deliveryLabel + ' / ' + String(recentAction.label || '명령');
      recentOperatorActionEl.title = String(recentAction.command || '');
    } else {
      recentOperatorActionEl.textContent = '기록 없음';
    }
  }
  const operatorCockpit = homeRuntime && homeRuntime.runtime_state
    ? homeRuntime.runtime_state.operator_cockpit
    : null;
  var latestHomeRecentAction = recentAction;
  var runtimeActionHistory = homeRuntime && homeRuntime.runtime_state && Array.isArray(homeRuntime.runtime_state.recent_operator_actions)
    ? homeRuntime.runtime_state.recent_operator_actions
    : [];
  var homeActionSourceHistory = runtimeActionHistory.length > 0
    ? normalizeHomeActionSourceEntries(runtimeActionHistory)
    : mergeHomeActionSource(recentAction);
  if (runtimeActionHistory.length > 0) {
    saveHomeActionSources(homeActionSourceHistory);
  }
  updateHomeActionSourceSummary(homeActionSourceHistory);
  function applyHomeRecentActionUi(nextAction) {
    latestHomeRecentAction = nextAction;
    homeActionSourceHistory = mergeHomeActionSource(nextAction);
    updateHomeActionSourceSummary(homeActionSourceHistory);
    if (recentOperatorActionEl) {
      if (nextAction && typeof nextAction === 'object') {
        const deliveryLabel = nextAction.delivery_status === 'success'
          ? '성공'
          : nextAction.delivery_status === 'failed'
            ? '실패'
            : '미전송';
        recentOperatorActionEl.textContent = deliveryLabel + ' / ' + String(nextAction.label || '명령');
        recentOperatorActionEl.title = String(nextAction.command || '');
      } else {
        recentOperatorActionEl.textContent = '기록 없음';
        recentOperatorActionEl.title = '';
      }
    }
    if (recentLoopStatusEl) {
      if (nextAction && typeof nextAction === 'object') {
        const deliveryLabel = nextAction.delivery_status === 'success'
          ? '성공'
          : nextAction.delivery_status === 'failed'
            ? '실패'
            : '미전송';
        recentLoopStatusEl.textContent = deliveryLabel + ' / ' + String(nextAction.label || '명령');
      } else {
        recentLoopStatusEl.textContent = '기록 없음';
      }
    }
    updateHomeOperatorChainSpotlight(selectHomeOperatorChainItem(operatorCockpit, nextAction));
    updateHomeOperatorChainDeliveries(operatorCockpit, nextAction);
  }
  const spotlightCopyBtn = document.getElementById('flow-chain-spotlight-copy');
  const spotlightFillEl = document.getElementById('flow-chain-spotlight-fill');
  if (spotlightCopyBtn) {
    spotlightCopyBtn.addEventListener('click', async () => {
      const command = String(spotlightCopyBtn.dataset.command || '').trim();
      const originalText = spotlightCopyBtn.textContent;
      if (!command) {
        spotlightCopyBtn.textContent = '명령 없음';
        setTimeout(() => { spotlightCopyBtn.textContent = originalText; }, 1200);
        return;
      }
      try {
        await copyTextToClipboard(command);
        const nextAction = buildHomeOperatorActionPayload({
          id: spotlightCopyBtn.dataset.chainId,
          label: spotlightCopyBtn.dataset.label,
          command: command,
        }, 'copied');
        applyHomeRecentActionUi(nextAction);
        syncHomeOperatorAction(nextAction, { keepalive: false });
        spotlightCopyBtn.textContent = '복사됨';
      } catch (_) {
        spotlightCopyBtn.textContent = '복사 실패';
      }
      setTimeout(() => { spotlightCopyBtn.textContent = originalText; }, 1200);
    });
  }
  if (spotlightFillEl) {
    spotlightFillEl.addEventListener('click', () => {
      const command = String(spotlightFillEl.dataset.command || '').trim();
      if (!command) {
        return;
      }
      const nextAction = buildHomeOperatorActionPayload({
        id: spotlightFillEl.dataset.chainId,
        label: spotlightFillEl.dataset.label,
        command: command,
      }, 'loaded');
      applyHomeRecentActionUi(nextAction);
      syncHomeOperatorAction(nextAction, { keepalive: true });
    });
  }
  applyHomeRecentActionUi(recentAction);
  if (recentLoopStatusEl) {
    if (recentOperatorActionEl && latestHomeRecentAction) {
      const deliveryLabel = latestHomeRecentAction.delivery_status === 'success'
        ? '성공'
        : latestHomeRecentAction.delivery_status === 'failed'
          ? '실패'
          : '미전송';
      recentLoopStatusEl.textContent = deliveryLabel + ' / ' + String(latestHomeRecentAction.label || '명령');
    } else {
      recentLoopStatusEl.textContent = '기록 없음';
    }
  }
  if (recentLoopBranchEl) {
    recentLoopBranchEl.textContent = operatorCockpit && operatorCockpit.branch
      ? String(operatorCockpit.branch.recommended_branch || operatorCockpit.branch.current_branch || '기록 없음')
      : '기록 없음';
  }
  if (recentLoopNextEl) {
    recentLoopNextEl.textContent = operatorCockpit && operatorCockpit.commit_guard
      ? String(operatorCockpit.commit_guard.next_action || '기록 없음')
      : '기록 없음';
  }
  if (recentLoopPrimaryLinkEl) {
    const failedAction = latestHomeRecentAction && latestHomeRecentAction.delivery_status === 'failed';
    const validationCommands = operatorCockpit
      && operatorCockpit.validation_profile
      && Array.isArray(operatorCockpit.validation_profile.commands)
      ? operatorCockpit.validation_profile.commands
      : [];
    const recommendedCommand = String(
      failedAction
        ? (latestHomeRecentAction.command || '')
        : (validationCommands[0] || 'npm run operator:cockpit')
    ).trim();
    const reason = failedAction
      ? String(latestHomeRecentAction.delivery_message || latestHomeRecentAction.label || '최근 operator action 실패').trim()
      : String(
        operatorCockpit && operatorCockpit.commit_guard
          ? operatorCockpit.commit_guard.next_action || '최근 operator loop 상태 확인'
          : '최근 operator loop 상태 확인'
      ).trim();
    recentLoopPrimaryLinkEl.href = failedAction
      ? buildControlCenterHref('execution-failure', 'execution-console', {
        reason,
        command: recommendedCommand,
        label: latestHomeRecentAction.label || '최근 operator action',
        source: 'home-loop',
      })
      : buildControlCenterHref('operator-summary', 'master-status', {
        reason,
        command: recommendedCommand,
        label: 'operator summary',
        source: 'home-loop',
      });
    recentLoopPrimaryLinkEl.textContent = failedAction ? '실행 콘솔 열기' : '통합 상태 열기';
  }
  if (recentLoopSecondaryLinkEl) {
    const guardBlocked = operatorCockpit && operatorCockpit.commit_guard
      ? operatorCockpit.commit_guard.can_apply !== true
      : false;
    const validationCommands = operatorCockpit
      && operatorCockpit.validation_profile
      && Array.isArray(operatorCockpit.validation_profile.commands)
      ? operatorCockpit.validation_profile.commands
      : [];
    const guardReason = String(
      guardBlocked
        ? (
          operatorCockpit
          && operatorCockpit.commit_guard
          && Array.isArray(operatorCockpit.commit_guard.reasons)
          && operatorCockpit.commit_guard.reasons[0]
            ? operatorCockpit.commit_guard.reasons[0]
            : (operatorCockpit && operatorCockpit.commit_guard ? operatorCockpit.commit_guard.next_action : '커밋 가드 확인 필요')
        )
        : '실행 패널에서 다음 operator action을 준비하세요.'
    ).trim();
    const guardCommand = String(
      guardBlocked
        ? (validationCommands[0] || 'npm run commit:guard')
        : (
          homeRuntime
          && homeRuntime.runtime_state
          && latestHomeRecentAction
          && latestHomeRecentAction.command
            ? latestHomeRecentAction.command
            : 'npm run operator:cockpit'
        )
    ).trim();
    recentLoopSecondaryLinkEl.href = guardBlocked
      ? buildControlCenterHref('guard', 'plan-board', {
        reason: guardReason,
        command: guardCommand,
        label: 'commit guard',
        source: 'home-loop',
      })
      : buildControlCenterHref('execution-failure', 'execution-console', {
        reason: guardReason,
        command: guardCommand,
        label: 'execution console',
        source: 'home-loop',
      });
    recentLoopSecondaryLinkEl.textContent = guardBlocked ? 'plan board 열기' : '실행 패널 열기';
  }
});
</script>
</body>
</html>`;
}

// ── Kanban lane mapping ──────────────────────────────────
const STAGE_CYCLE = ['A', 'B', 'C', 'D', 'E'];

function classifyLane(wp) {
  const s = String(wp.status || '').toLowerCase();
  for (const lane of KANBAN_LANES) {
    if (lane.statuses.some((k) => s.includes(k))) return lane.id;
  }
  return 'backlog';
}

function buildKanbanSection(wpQueue) {
  if (!wpQueue || !Array.isArray(wpQueue.capabilities)) return '';

  // Flatten all WPs from capabilities
  const allWps = [];
  for (const cap of wpQueue.capabilities) {
    for (const wp of (cap.work_packets || [])) {
      allWps.push({ ...wp, cap_name: cap.name, cap_id: cap.id });
    }
  }

  // Group by lane
  const laneMap = {};
  for (const lane of KANBAN_LANES) laneMap[lane.id] = [];
  for (const wp of allWps) laneMap[classifyLane(wp)].push(wp);

  // Stage badge helper
  function stageBadges(wp) {
    const current = String(wp.current_stage || wp.stage || '').toUpperCase();
    return STAGE_CYCLE.map((s) => {
      const active = current.includes(s);
      return `<span class="kb-stage ${active ? 'kb-stage-on' : ''}">${s}</span>`;
    }).join('');
  }

  // Tier badge
  function tierBadge(wp) {
    const tier = String(wp.tier || '').toLowerCase();
    const map = { infra: '#475569', arch: '#1d4ed8', governance: '#7e22ce', domain: '#0f766e', meta: '#b45309' };
    const color = map[tier] || '#475569';
    return tier ? `<span class="kb-tier" style="background:${color}22;color:${color};border-color:${color}44;">${tier}</span>` : '';
  }

  const laneHtml = KANBAN_LANES.map((lane) => {
    const cards = laneMap[lane.id];
    const cardHtml = cards.length === 0
      ? `<div class="kb-empty">없음</div>`
      : cards.map((wp) => `
        <div class="kb-card">
          <div class="kb-card-head">
            <span class="kb-id">${esc(wp.id || '—')}</span>
            ${tierBadge(wp)}
          </div>
          <div class="kb-goal">${esc(wp.goal || wp.name || '—')}</div>
          <div class="kb-stages">${stageBadges(wp)}</div>
        </div>`).join('');
    return `
      <div class="kb-lane">
        <div class="kb-lane-head" style="border-top:3px solid ${lane.color}">
          <span class="kb-lane-label">${lane.label}</span>
          <span class="kb-lane-count">${cards.length}</span>
        </div>
        <div class="kb-cards">${cardHtml}</div>
      </div>`;
  }).join('');

  // Spiral model: iterations derived from done caps vs total
  const totalCaps = wpQueue.capabilities.length;
  const doneCaps = wpQueue.capabilities.filter((c) => c.work_packets && c.work_packets.every((w) => String(w.status || '').toLowerCase().includes('done') || String(w.status || '').toLowerCase().includes('pass'))).length;
  const iteration = doneCaps > 0 ? doneCaps : 1;

  const spiralSteps = [
    { label: '요구사항 분석', color: '#1d4ed8', stage: 'A' },
    { label: '계약 설계', color: '#7e22ce', stage: 'B' },
    { label: '셸 조합', color: '#b45309', stage: 'C' },
    { label: '구현 · 테스트', color: '#0f766e', stage: 'D' },
    { label: '적대적 검증', color: '#dc2626', stage: 'E' },
  ];

  const spiralHtml = spiralSteps.map((step, i) => `
    <div class="spiral-step">
      <div class="spiral-node" style="background:${step.color}22;border-color:${step.color}66;color:${step.color}">
        <span class="spiral-stage">${step.stage}</span>
      </div>
      <div class="spiral-label">${step.label}</div>
      ${i < spiralSteps.length - 1 ? '<div class="spiral-arrow">→</div>' : ''}
    </div>`).join('');

  return `
    <div class="section-head" style="margin-top:40px">
      <div>
        <h2>칸반 보드 · 작업 흐름</h2>
        <p>Work Packet 상태를 레인별로 시각화합니다. 각 카드의 A→E 배지는 나선형 반복 주기를 나타냅니다.</p>
      </div>
      <div class="spiral-iteration">반복 <strong>#${iteration}</strong> / ${totalCaps} 능력</div>
    </div>

    <div class="spiral-row">${spiralHtml}</div>

    <section class="kb-board" aria-label="칸반 보드">
      ${laneHtml}
    </section>`;
}

const KANBAN_CSS = `
  /* ── Flow Status Strip ────────────────────── */
  .flow-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .flow-card {
    background: var(--surface);
    border: 1px solid rgba(220,207,186,0.92);
    border-radius: var(--radius-lg);
    padding: 18px;
    box-shadow: var(--shadow);
    display: grid;
    gap: 10px;
  }
  .flow-card-primary {
    background:
      linear-gradient(135deg, rgba(15,118,110,0.08), rgba(29,78,216,0.06)),
      var(--surface);
  }
  .flow-card-head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: center;
  }
  .flow-kicker {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    font-weight: 700;
  }
  .flow-card h3 {
    margin: 0;
    font-size: 18px;
    letter-spacing: -0.03em;
  }
  .flow-card p {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.6;
  }
  .flow-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .flow-meta span,
  .flow-pill {
    display: inline-flex;
    align-items: center;
    padding: 5px 10px;
    border-radius: 999px;
    background: rgba(15,118,110,0.07);
    border: 1px solid rgba(15,118,110,0.18);
    color: var(--muted);
    font-size: 12px;
  }
  .flow-pill strong {
    margin-left: 6px;
    color: var(--accent);
  }
  .flow-code-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .flow-code-list code {
    font-size: 11px;
    padding: 5px 8px;
    border-radius: 10px;
    background: rgba(255,247,234,0.95);
    border: 1px solid rgba(220,207,186,0.9);
  }
  .flow-chain-panel {
    background: var(--surface);
    border: 1px solid rgba(220,207,186,0.92);
    border-radius: var(--radius-lg);
    padding: 18px;
    box-shadow: var(--shadow);
    margin-bottom: 18px;
  }
  .flow-chain-head {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: flex-start;
    margin-bottom: 14px;
  }
  .flow-chain-head-pills {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  .flow-chain-head h3 {
    margin: 0;
    font-size: 18px;
    letter-spacing: -0.03em;
  }
  .flow-chain-head p {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 13px;
  }
  .flow-chain-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 10px;
  }
  .flow-chain-spotlight {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: center;
    background: rgba(15,118,110,0.07);
    border: 1px solid rgba(15,118,110,0.18);
    border-radius: 16px;
    padding: 14px 16px;
    margin-bottom: 12px;
  }
  .flow-chain-spotlight-copy {
    display: grid;
    gap: 4px;
  }
  .flow-chain-spotlight-copy strong {
    font-size: 16px;
    letter-spacing: -0.02em;
  }
  .flow-chain-spotlight-copy p {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }
  .flow-chain-spotlight-actions {
    display: grid;
    justify-items: end;
    gap: 8px;
  }
  .flow-chain-spotlight-links {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  .flow-chain-spotlight-actions code {
    font-size: 11px;
    padding: 5px 8px;
    border-radius: 10px;
    background: rgba(255,255,255,0.75);
    border: 1px solid rgba(220,207,186,0.9);
  }
  .flow-chain-item {
    display: grid;
    gap: 8px;
    background: var(--surface-strong);
    border: 1px solid rgba(220,207,186,0.85);
    border-radius: 12px;
    padding: 12px;
    transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }
  .flow-chain-item.is-active {
    border-color: rgba(15,118,110,0.42);
    box-shadow: 0 12px 24px rgba(15,118,110,0.12);
    transform: translateY(-1px);
  }
  .flow-chain-label {
    font-weight: 700;
    font-size: 13px;
  }
  .flow-chain-item code {
    font-size: 11px;
    padding: 5px 7px;
    border-radius: 8px;
    background: rgba(255,255,255,0.7);
    border: 1px solid rgba(220,207,186,0.85);
    word-break: break-word;
  }
  .flow-chain-link {
    font-size: 12px;
    color: var(--accent);
    font-weight: 700;
  }
  .flow-chain-link.is-button {
    appearance: none;
    border: 1px solid rgba(15,118,110,0.24);
    background: rgba(255,255,255,0.72);
    border-radius: 999px;
    padding: 6px 10px;
    cursor: pointer;
  }
  .flow-chain-delivery {
    display: grid;
    gap: 6px;
  }
  .flow-chain-delivery-pill {
    width: fit-content;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
    border-radius: 999px;
    padding: 4px 8px;
    background: rgba(220,207,186,0.45);
    color: var(--muted);
  }
  .flow-chain-delivery-pill[data-delivery-status="success"] {
    background: rgba(15,118,110,0.14);
    color: var(--green);
  }
  .flow-chain-delivery-pill[data-delivery-status="failed"] {
    background: rgba(194,65,12,0.12);
    color: var(--accent-2);
  }
  .flow-chain-delivery-pill[data-delivery-status="unsent"] {
    background: rgba(180,83,9,0.12);
    color: var(--amber);
  }
  .flow-chain-delivery-meta {
    font-size: 12px;
    color: var(--muted);
    min-height: 19px;
  }
  .flow-chain-delivery-meta[data-delivery-status="success"] {
    color: var(--green);
  }
  .flow-chain-delivery-meta[data-delivery-status="failed"] {
    color: var(--accent-2);
  }
  .flow-chain-delivery-meta[data-delivery-status="unsent"] {
    color: var(--amber);
  }
  .flow-chain-empty {
    color: var(--muted);
    font-size: 13px;
  }
  /* ── Kanban Board ─────────────────────────── */
  .kb-board {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 8px;
  }
  .kb-lane {
    background: var(--surface);
    border: 1px solid rgba(220,207,186,0.92);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .kb-lane-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px 8px;
    background: rgba(255,255,255,0.7);
  }
  .kb-lane-label { font-weight: 700; font-size: 13px; }
  .kb-lane-count {
    background: rgba(0,0,0,0.07);
    border-radius: 99px;
    padding: 1px 7px;
    font-size: 11px;
    font-weight: 700;
  }
  .kb-cards { display: grid; gap: 8px; padding: 10px; }
  .kb-card {
    background: var(--surface-strong);
    border: 1px solid rgba(220,207,186,0.75);
    border-radius: 10px;
    padding: 10px 11px;
    display: grid;
    gap: 5px;
  }
  .kb-card-head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .kb-id {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--accent);
    font-weight: 700;
  }
  .kb-tier {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 99px;
    border: 1px solid;
    text-transform: uppercase;
  }
  .kb-goal {
    font-size: 11px;
    color: var(--text);
    line-height: 1.5;
  }
  .kb-stages {
    display: flex;
    gap: 3px;
    margin-top: 3px;
  }
  .kb-stage {
    width: 18px;
    height: 18px;
    border-radius: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 800;
    background: rgba(0,0,0,0.06);
    color: var(--muted);
  }
  .kb-stage.kb-stage-on {
    background: linear-gradient(135deg, #0f766e, #1d4ed8);
    color: white;
  }
  .kb-empty {
    text-align: center;
    padding: 18px 10px;
    color: var(--muted);
    font-size: 12px;
  }
  /* ── Spiral Model ─────────────────────────── */
  .spiral-row {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 14px 18px;
    background: var(--surface);
    border: 1px solid rgba(220,207,186,0.85);
    border-radius: var(--radius-lg);
    margin-bottom: 14px;
    overflow-x: auto;
    flex-wrap: wrap;
    gap: 4px;
  }
  .spiral-step {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .spiral-node {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: 2px solid;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
  }
  .spiral-stage {
    font-size: 14px;
    font-weight: 900;
  }
  .spiral-label {
    font-size: 10px;
    color: var(--muted);
    max-width: 60px;
    line-height: 1.3;
    display: none;
  }
  .spiral-arrow {
    font-size: 16px;
    color: var(--muted);
    margin: 0 2px;
  }
  .spiral-iteration {
    font-size: 12px;
    color: var(--muted);
    padding: 5px 10px;
    border-radius: 99px;
    background: rgba(15,118,110,0.07);
    border: 1px solid rgba(15,118,110,0.2);
  }
  .spiral-iteration strong { color: var(--accent); }
  @media (max-width: 980px) {
    .flow-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .flow-chain-spotlight {
      flex-direction: column;
      align-items: flex-start;
    }
    .flow-chain-head {
      flex-direction: column;
    }
    .flow-chain-head-pills {
      justify-content: flex-start;
    }
    .flow-chain-spotlight-actions { justify-items: flex-start; }
    .flow-chain-spotlight-links { justify-content: flex-start; }
    .flow-chain-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .kb-board { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 600px) {
    .flow-strip { grid-template-columns: 1fr; }
    .flow-chain-grid { grid-template-columns: 1fr; }
    .kb-board { grid-template-columns: 1fr; }
    .spiral-row { gap: 2px; }
  }
`;

function buildHomeData() {
  const report = buildReport();
  const nav = readYaml('master-shell/navigation/nav.yaml');
  const registry = readYaml('master-shell/plugin-registry/registry.yaml');
  const currentState = readYaml('memory/current-state.yaml');
  const wpQueue = readYaml('memory/wp-queue.yaml');
  const nextActions = readYaml('memory/next-actions.yaml');
  const bootstrap = buildBootstrapSummary();
  const operatorCockpit = buildOperatorCockpitSummary();
  const navSummary = buildNavigationSummary(nav, registry);

  // WP-UI-006: System OS 초기 스냅샷 (file mode — 빌드 타임 동기 읽기)
  const sysClient = new SystemApiClient({ mode: 'file' });
  const sysHealth  = sysClient._readHealthFile();
  const sysFlags   = sysClient._readFlagsFile();
  const sysCatalog = sysClient._readCatalogFile();
  const sysQg      = sysClient._readQualityGateFile();

  return { report, nav, registry, currentState, navSummary, wpQueue, nextActions, bootstrap, operatorCockpit,
           sysHealth, sysFlags, sysCatalog, sysQg };
}

function buildHomeRuntime() {
  const data = buildHomeData();
  const html = buildHtml(data);
  return { html, homeData: { report: data.report, generatedAt: new Date().toISOString() } };
}

function main() {
  const data = buildHomeData();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, buildHtml(data), 'utf8');
  process.stdout.write('생성 완료: artifacts/index.html\n');
}

if (require.main === module) {
  main();
}

// ── WP-UI-006: System OS 라이브 상태 섹션 ─────────────────────────────────────
function buildSystemOsSection(sysHealth, sysFlags, sysCatalog, sysQg) {
  const health = sysHealth  || { overall_score: 0, rating: 'UNKNOWN', domains: [] };
  const flags  = sysFlags   || { flags: [], total: 0 };
  // sysCatalog reserved for WP-UI-007 — domain count available via health.domains
  void sysCatalog;
  const qg     = sysQg     || { overall: 'UNKNOWN', last_run_at: null, gates: [] };

  const activeFlags = flags.flags.filter(f => f.enabled).length;
  const passGates   = qg.gates.filter(g => g.result === 'PASS').length;
  const totalGates  = qg.gates.length;
  const lastGateAt  = qg.last_run_at
    ? new Date(qg.last_run_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })
    : '알 수 없음';
  const scoreColor  = health.overall_score >= 90 ? '#22c55e' : health.overall_score >= 70 ? '#f59e0b' : '#ef4444';
  const ratingBg    = { ELITE:'rgba(34,197,94,0.15)', HIGH:'rgba(99,102,241,0.15)', MEDIUM:'rgba(245,158,11,0.15)',
    LOW:'rgba(239,68,68,0.12)', CRITICAL:'rgba(239,68,68,0.2)', UNKNOWN:'rgba(100,116,139,0.1)' }[health.rating] || 'rgba(100,116,139,0.1)';
  const ratingColor = { ELITE:'#22c55e', HIGH:'#6366f1', MEDIUM:'#f59e0b', LOW:'#ef4444',
    CRITICAL:'#ef4444', UNKNOWN:'#64748b' }[health.rating] || '#64748b';

  const domainCards = health.domains.map(d => {
    const scoreW   = Math.max(0, Math.min(100, d.health_score || 0));
    const barColor = scoreW >= 90 ? '#22c55e' : scoreW >= 70 ? '#f59e0b' : '#ef4444';
    const trendIcon = { UP:'↑', DOWN:'↓', STABLE:'→' }[d.trend] || '→';
    const trendColor = d.trend === 'UP' ? '#22c55e' : d.trend === 'DOWN' ? '#ef4444' : '#64748b';
    return `<div class="wfos-domain-card" data-domain-id="${esc(d.id)}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <span style="font-weight:600;font-size:.85rem;">${esc(d.name || d.id)}</span>
        <span style="font-size:.7rem;padding:2px 7px;border-radius:999px;background:rgba(99,102,241,0.12);color:#6366f1;">${esc(d.stage || 'E')}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span data-health-score style="font-size:1.4rem;font-weight:700;font-family:monospace;color:${barColor};">${scoreW}</span>
        <span style="color:${trendColor};font-size:1rem;">${trendIcon}</span>
      </div>
      <div style="background:#334155;border-radius:999px;height:4px;overflow:hidden;">
        <div style="width:${scoreW}%;height:100%;background:${barColor};border-radius:999px;transition:width .4s ease;"></div>
      </div>
    </div>`;
  }).join('') || '<span style="color:#64748b;font-size:.85rem;">도메인 데이터 없음</span>';

  const gateDots = qg.gates.map(g => {
    const c = g.result === 'PASS' ? '#22c55e' : g.result === 'FAIL' ? '#ef4444' : '#64748b';
    return `<span title="${esc(g.name)} — ${esc(g.result)}" style="color:${c};font-size:.65rem;cursor:default;">●</span>`;
  }).join(' ');

  return `<section id="wfos-live-section" aria-label="System OS 실시간 상태"
  style="background:#1e293b;border-bottom:1px solid #334155;padding:.75rem 1.5rem;">
  <style>
    #wfos-live-section * { box-sizing: border-box; }
    .wfos-status-bar { display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center;margin-bottom:.75rem; }
    .wfos-stat { display:flex;flex-direction:column;gap:2px; }
    .wfos-stat__label { font-size:.65rem;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-family:sans-serif; }
    .wfos-stat__value { font-size:1.1rem;font-weight:700;font-family:monospace;color:#f1f5f9; }
    .wfos-domain-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.5rem;margin-bottom:.5rem; }
    .wfos-domain-card { background:#0f172a;border:1px solid #334155;border-radius:8px;padding:.6rem .75rem; }
    .wfos-footer { display:flex;align-items:center;gap:1rem;flex-wrap:wrap;font-size:.75rem;color:#64748b; }
  </style>
  <div class="wfos-status-bar">
    <div class="wfos-stat"><span class="wfos-stat__label">전체 헬스</span><span class="wfos-stat__value" style="color:${scoreColor};">${health.overall_score}</span></div>
    <div class="wfos-stat"><span class="wfos-stat__label">등급</span><span class="wfos-stat__value" style="font-size:.85rem;padding:2px 8px;border-radius:999px;background:${ratingBg};color:${ratingColor};">${esc(health.rating)}</span></div>
    <div class="wfos-stat"><span class="wfos-stat__label">도메인</span><span class="wfos-stat__value">${health.domains.length}</span></div>
    <div class="wfos-stat"><span class="wfos-stat__label">활성 플래그</span><span class="wfos-stat__value">${activeFlags} / ${flags.total}</span></div>
    <div class="wfos-stat"><span class="wfos-stat__label">품질 게이트</span><span class="wfos-stat__value" style="color:${passGates===totalGates&&totalGates>0?'#22c55e':'#ef4444'};">${passGates}/${totalGates} PASS</span></div>
    <div class="wfos-stat"><span class="wfos-stat__label">마지막 게이트</span><span class="wfos-stat__value" style="font-size:.8rem;">${esc(lastGateAt)}</span></div>
    <div style="flex:1;"></div>
    <div style="display:flex;align-items:center;gap:.4rem;">
      <span class="wf-sse-indicator wf-sse-indicator--offline" data-sse-indicator title="실시간 연결 상태">●</span>
      <span style="font-size:.72rem;color:#64748b;">실시간</span>
    </div>
  </div>
  <div class="wfos-domain-grid" id="wfos-domain-grid">${domainCards}</div>
  <div class="wfos-footer">
    <span>게이트: ${gateDots || '<span style="color:#64748b;">없음</span>'}</span>
    <span style="color:#334155;">|</span>
    <a href="flags/index.html" style="color:#6366f1;text-decoration:none;">피처 플래그</a>
    <a href="audit/index.html" style="color:#6366f1;text-decoration:none;">감사 로그</a>
    <a href="quality/index.html" style="color:#6366f1;text-decoration:none;">품질 게이트</a>
    <a href="lifecycle/index.html" style="color:#6366f1;text-decoration:none;">라이프사이클</a>
    <a href="rollback/index.html" style="color:#ef4444;text-decoration:none;">롤백 콘솔</a>
  </div>
</section>`;
}

module.exports = { buildHomeRuntime };
