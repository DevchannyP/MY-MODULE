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
        <a class="chip-link" href="#automation-bridge" style="background:linear-gradient(135deg,rgba(15,118,110,0.12),rgba(29,78,216,0.10));border-color:rgba(15,118,110,0.35);color:#0f766e;font-weight:700;" onclick="document.getElementById('automation-bridge').scrollIntoView({behavior:'smooth'});return false;">⚡ 자동화 브리지</a>
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

${buildAutomationBridgeHtml()}
  </div>
<script>
${buildAutomationBridgeJs()}
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

// ── Automation Bridge ─────────────────────────────────────────────────────────
function buildAutomationBridgeHtml() {
  return `
  <style>
  #automation-bridge{margin-top:48px;padding-top:20px;border-top:2px solid rgba(15,118,110,0.18);scroll-margin-top:80px}
  .ab-header{display:flex;align-items:center;gap:14px;margin-bottom:20px}
  .ab-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;background:linear-gradient(135deg,rgba(15,118,110,0.12),rgba(29,78,216,0.10));border:1px solid rgba(15,118,110,0.3);color:#0f766e;font-size:12px;font-weight:700}
  .ab-status-dot{width:8px;height:8px;border-radius:50%;background:#94a3b8;display:inline-block;animation:ab-pulse 2s infinite}
  .ab-status-dot.connected{background:#22c55e}.ab-status-dot.error{background:#ef4444;animation:none}
  @keyframes ab-pulse{0%,100%{opacity:1}50%{opacity:.4}}
  .ab-tabs{display:flex;gap:0;border-bottom:2px solid rgba(220,207,186,0.8);margin-bottom:0;overflow-x:auto}
  .ab-tab{padding:10px 18px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .13s;white-space:nowrap;font-family:var(--font-ui)}
  .ab-tab:hover{color:var(--text)}.ab-tab.ab-active{color:var(--accent);border-bottom-color:var(--accent)}
  .ab-panel{display:none;padding:20px 0}.ab-panel.ab-active{display:block}
  .ab-term-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .ab-card{background:var(--surface);border:1px solid rgba(220,207,186,0.92);border-radius:var(--radius-lg);padding:18px}
  .ab-card-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:12px}
  .ab-session-list{display:grid;gap:6px;max-height:220px;overflow-y:auto}
  .ab-session-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border:2px solid rgba(220,207,186,0.7);border-radius:10px;cursor:pointer;transition:all .13s;font-size:12px}
  .ab-session-item:hover{border-color:var(--accent);background:rgba(15,118,110,0.04)}.ab-session-item.ab-selected{border-color:var(--accent);background:rgba(15,118,110,0.07)}
  .ab-session-pts{font-family:var(--font-mono);font-weight:700;color:var(--accent);font-size:11px}
  .ab-session-info{color:var(--muted);font-size:11px}
  .ab-session-badge{padding:2px 7px;border-radius:99px;font-size:10px;font-weight:700;background:rgba(15,118,110,0.1);color:var(--accent);border:1px solid rgba(15,118,110,0.2);flex-shrink:0}
  .ab-session-badge.ai{background:rgba(29,78,216,0.1);color:#1d4ed8;border-color:rgba(29,78,216,0.2)}
  .ab-cmd-input{width:100%;padding:10px 14px;border:2px solid rgba(220,207,186,0.8);border-radius:10px;font-family:var(--font-mono);font-size:13px;background:var(--surface);color:var(--text);margin-bottom:10px;box-sizing:border-box}
  .ab-cmd-input:focus{outline:none;border-color:var(--accent)}
  .ab-btn-row{display:flex;gap:8px;flex-wrap:wrap}
  .ab-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:10px;border:none;cursor:pointer;font-size:13px;font-weight:700;font-family:var(--font-ui);transition:all .13s}
  .ab-btn:active{transform:scale(.97)}.ab-btn:disabled{opacity:.45;cursor:not-allowed}
  .ab-btn-primary{background:var(--accent);color:#fff}.ab-btn-primary:hover{background:#0d6860}
  .ab-btn-secondary{background:var(--surface-strong);color:var(--text);border:1px solid rgba(220,207,186,0.9)}.ab-btn-secondary:hover{border-color:var(--accent)}
  .ab-btn-sm{padding:5px 11px;font-size:11px;border-radius:8px}
  .ab-log{background:#1a1f2e;border-radius:12px;padding:12px 14px;height:150px;overflow-y:auto;font-family:var(--font-mono);font-size:11px;line-height:1.7}
  .ab-log-line{color:#a8b5cc}.ab-log-ok{color:#6ee7b7}.ab-log-fail{color:#fca5a5}.ab-log-info{color:#93c5fd}.ab-log-empty{color:#4b5563;font-style:italic}
  .ab-result{padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;margin-top:8px;display:none}
  .ab-result-ok{background:#dcfce7;color:#166534;border:1px solid #86efac;display:block}.ab-result-fail{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;display:block}
  .ab-cmd-search{width:100%;padding:10px 14px;border:2px solid rgba(220,207,186,0.8);border-radius:10px;font-family:var(--font-ui);font-size:13px;background:var(--surface);color:var(--text);margin-bottom:14px;box-sizing:border-box}
  .ab-cmd-search:focus{outline:none;border-color:var(--accent)}
  .ab-palette-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  .ab-palette-section{background:var(--surface);border:1px solid rgba(220,207,186,0.85);border-radius:var(--radius-lg);overflow:hidden}
  .ab-palette-section-head{display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(255,255,255,0.7);border-bottom:1px solid rgba(220,207,186,0.7);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  .ab-palette-list{padding:8px;display:grid;gap:4px}
  .ab-palette-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;transition:all .1s;font-size:12px}
  .ab-palette-item:hover{background:rgba(15,118,110,0.07)}.ab-palette-item.ab-hidden{display:none}
  .ab-palette-cmd{font-family:var(--font-mono);font-size:11px;color:var(--muted)}
  .ab-palette-run{flex-shrink:0;padding:3px 9px;border-radius:6px;font-size:10px;font-weight:700;background:transparent;border:1px solid rgba(220,207,186,0.8);color:var(--muted);cursor:pointer;font-family:var(--font-ui);transition:all .1s}
  .ab-palette-run:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
  .ab-kw-table{width:100%;border-collapse:collapse;font-size:13px}
  .ab-kw-table th{text-align:left;padding:8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);border-bottom:2px solid rgba(220,207,186,0.8)}
  .ab-kw-table td{padding:9px 12px;border-bottom:1px solid rgba(220,207,186,0.5);vertical-align:middle}
  .ab-kw-table tr:last-child td{border-bottom:none}.ab-kw-table tr:hover td{background:rgba(15,118,110,0.04)}
  .ab-kw-code{font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--accent);background:rgba(15,118,110,0.08);padding:3px 8px;border-radius:6px;cursor:pointer;border:1px solid rgba(15,118,110,0.2);transition:all .1s;display:inline-block}
  .ab-kw-code:hover{background:var(--accent);color:#fff}
  .ab-kw-run-btn{padding:4px 10px;border-radius:7px;font-size:10px;font-weight:700;background:transparent;border:1px solid rgba(220,207,186,0.8);color:var(--muted);cursor:pointer;font-family:var(--font-ui);transition:all .1s}
  .ab-kw-run-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
  .ab-file-tree{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .ab-file-group{background:var(--surface);border:1px solid rgba(220,207,186,0.85);border-radius:var(--radius-lg);overflow:hidden}
  .ab-file-group-head{display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(255,255,255,0.7);border-bottom:1px solid rgba(220,207,186,0.7);font-size:12px;font-weight:700;color:var(--text)}
  .ab-file-list{padding:8px;display:grid;gap:2px}
  .ab-file-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;font-size:12px;color:var(--muted);cursor:pointer;transition:all .1s;text-decoration:none}
  .ab-file-item:hover{background:rgba(15,118,110,0.07);color:var(--accent)}
  .ab-file-name{font-family:var(--font-mono);font-size:11px;flex:1}
  .ab-file-actions{display:flex;gap:4px;opacity:0;transition:opacity .1s}
  .ab-file-item:hover .ab-file-actions{opacity:1}
  .ab-file-action-btn{padding:2px 7px;border-radius:5px;font-size:10px;font-weight:700;background:transparent;border:1px solid rgba(220,207,186,0.8);color:var(--muted);cursor:pointer;font-family:var(--font-ui);transition:all .1s}
  .ab-file-action-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
  .ab-guide-grid{display:grid;gap:14px}
  .ab-guide-block{background:var(--surface);border:1px solid rgba(220,207,186,0.85);border-radius:var(--radius-lg);overflow:hidden}
  .ab-guide-block-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 18px;cursor:pointer;transition:background .1s}
  .ab-guide-block-head:hover{background:rgba(255,255,255,0.5)}
  .ab-guide-block-title{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700}
  .ab-guide-chevron{color:var(--muted);transition:transform .2s}
  .ab-guide-block.ab-open .ab-guide-chevron{transform:rotate(180deg)}
  .ab-guide-body{display:none;padding:0 18px 18px}
  .ab-guide-block.ab-open .ab-guide-body{display:block}
  .ab-guide-body p{color:var(--muted);font-size:14px;line-height:1.75;margin:0 0 12px}
  .ab-guide-body ul{margin:0 0 12px;padding-left:18px}
  .ab-guide-body li{color:var(--muted);font-size:14px;line-height:1.75}
  .ab-guide-body code{font-family:var(--font-mono);font-size:12px;background:rgba(15,118,110,0.08);color:var(--accent);padding:2px 7px;border-radius:6px;cursor:pointer}
  .ab-guide-body code:hover{background:var(--accent);color:#fff}
  .ab-guide-body pre{background:#1a1f2e;color:#a8b5cc;font-family:var(--font-mono);font-size:12px;border-radius:10px;padding:14px;overflow-x:auto;line-height:1.7;margin:10px 0}
  .ab-stage-flow{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:12px 0}
  .ab-stage-node{display:flex;align-items:center;gap:6px}
  .ab-stage-pill{padding:6px 14px;border-radius:999px;font-size:13px;font-weight:700;cursor:pointer;transition:all .13s;border:2px solid}
  .ab-stage-a{background:rgba(29,78,216,0.1);color:#1d4ed8;border-color:rgba(29,78,216,0.3)}
  .ab-stage-b{background:rgba(139,92,246,0.1);color:#7c3aed;border-color:rgba(139,92,246,0.3)}
  .ab-stage-c{background:rgba(180,83,9,0.1);color:#b45309;border-color:rgba(180,83,9,0.3)}
  .ab-stage-d{background:rgba(15,118,110,0.1);color:#0f766e;border-color:rgba(15,118,110,0.3)}
  .ab-stage-e{background:rgba(220,38,38,0.1);color:#dc2626;border-color:rgba(220,38,38,0.3)}
  .ab-stage-pill:hover{transform:translateY(-2px);box-shadow:0 6px 14px rgba(0,0,0,0.1)}
  .ab-arrow{color:var(--muted);font-size:16px}
  .ab-state-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;background:rgba(15,118,110,0.06);border:1px solid rgba(15,118,110,0.18);border-radius:var(--radius-md);margin-bottom:16px;font-size:12px}
  .ab-state-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,0.7);border:1px solid rgba(220,207,186,0.8);color:var(--muted);font-size:11px;font-weight:600}
  .ab-state-pill strong{color:var(--text)}
  @media(max-width:900px){.ab-term-grid,.ab-palette-grid,.ab-file-tree{grid-template-columns:1fr}}
  </style>

  <section id="automation-bridge">
    <div class="ab-header">
      <div class="section-head" style="margin:0;flex:1;">
        <div>
          <h2>⚡ Automation Bridge</h2>
          <p>UI에서 VS Code 터미널을 직접 제어하고, 전체 프로젝트 사용법 + 명령 팔레트 + 파일 탐색을 한 화면에서 사용합니다.</p>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
        <span class="ab-badge"><span class="ab-status-dot" id="ab-conn-dot"></span><span id="ab-conn-label">서버 연결 중...</span></span>
        <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abRefreshSessions()">⟳ 세션 갱신</button>
      </div>
    </div>
    <div class="ab-state-bar">
      <span class="ab-state-pill">WP <strong id="ab-wp-live">—</strong></span>
      <span class="ab-state-pill">브랜치 <strong id="ab-branch-live">—</strong></span>
      <span class="ab-state-pill">터미널 <strong id="ab-pty-live">—</strong></span>
      <span class="ab-state-pill">대상 세션 <strong id="ab-target-pts">미선택</strong></span>
      <span class="ab-state-pill" style="margin-left:auto;">서버 <strong id="ab-server-status">localhost:8080</strong></span>
    </div>
    <div class="ab-tabs">
      <button class="ab-tab ab-active" onclick="abSwitchTab('guide',this)">📖 사용법 가이드</button>
      <button class="ab-tab" onclick="abSwitchTab('terminal',this)">🖥 터미널 브리지</button>
      <button class="ab-tab" onclick="abSwitchTab('commands',this)">⚡ 명령 팔레트</button>
      <button class="ab-tab" onclick="abSwitchTab('files',this)">📂 파일 탐색</button>
      <button class="ab-tab" onclick="abSwitchTab('keywords',this)">🔑 키워드 실행표</button>
    </div>

    <!-- 사용법 가이드 -->
    <div class="ab-panel ab-active" id="ab-panel-guide">
      <div class="ab-guide-grid">
        <div class="ab-guide-block ab-open">
          <div class="ab-guide-block-head" onclick="abToggleGuide(this)">
            <div class="ab-guide-block-title"><span>🗺</span><span>한눈에 보기 — Workflow OS란?</span></div>
            <span class="ab-guide-chevron">▼</span>
          </div>
          <div class="ab-guide-body">
            <p>Workflow OS는 요구사항→설계→구현→검증의 전 사이클을 <strong>Work Packet</strong> 단위로 추적하고, Claude Code가 자율적으로 실행하는 프로젝트 운영 시스템입니다.</p>
            <div class="ab-stage-flow">
              <div class="ab-stage-node"><span class="ab-stage-pill ab-stage-a" onclick="abSendKeyword('A 도메인명')">A 분석</span><span class="ab-arrow">→</span></div>
              <div class="ab-stage-node"><span class="ab-stage-pill ab-stage-b" onclick="abSendKeyword('B_review 도메인명')">B 리뷰</span><span class="ab-arrow">→</span></div>
              <div class="ab-stage-node"><span class="ab-stage-pill ab-stage-c" onclick="abSendKeyword('계속')">C 쉘</span><span class="ab-arrow">→</span></div>
              <div class="ab-stage-node"><span class="ab-stage-pill ab-stage-d" onclick="abSendKeyword('D 도메인명')">D 구현</span><span class="ab-arrow">→</span></div>
              <div class="ab-stage-node"><span class="ab-stage-pill ab-stage-e" onclick="abSendKeyword('E 도메인명')">E 검증</span></div>
            </div>
            <ul>
              <li><strong>사용자가 하는 일</strong>: 요구사항과 우선순위 정의, <code>requirements/requirements.yaml</code> 편집</li>
              <li><strong>Claude가 하는 일</strong>: 한 번에 하나의 Work Packet을 끝까지 닫음</li>
              <li><strong>상태 추적</strong>: <code>memory/L0-hot/current-state.yaml</code>에서 현재 stage 확인</li>
              <li><strong>빠른 시작</strong>: 터미널에 <code>npm run project:status</code></li>
            </ul>
          </div>
        </div>
        <div class="ab-guide-block">
          <div class="ab-guide-block-head" onclick="abToggleGuide(this)">
            <div class="ab-guide-block-title"><span>📁</span><span>저장소 구조</span></div>
            <span class="ab-guide-chevron">▼</span>
          </div>
          <div class="ab-guide-body">
            <pre>my-module/
├── requirements/requirements.yaml  ← ★ 단일 진실원
├── domains/[도메인]/
│   ├── contracts/  ← OpenAPI·Events·UI·Capability
│   ├── src/        ← 실제 코드
│   └── tests/      ← 단위 + 적대적 테스트
├── master-shell/   ← 플러그인·피처플래그·네비게이션
├── memory/L0-hot/  ← 핫 상태 (세션 간 인수인계)
├── docs/adr/       ← 아키텍처 결정 기록
├── worklog/        ← 실행 이력
└── artifacts/      ← UI 포털 (현재 화면)</pre>
          </div>
        </div>
        <div class="ab-guide-block">
          <div class="ab-guide-block-head" onclick="abToggleGuide(this)">
            <div class="ab-guide-block-title"><span>🚀</span><span>5분 빠른 시작</span></div>
            <span class="ab-guide-chevron">▼</span>
          </div>
          <div class="ab-guide-body">
            <p><strong>Step 1</strong>: <code>requirements/requirements.yaml</code>에 도메인 추가</p>
            <p><strong>Step 2</strong>: Claude Code 터미널에 입력 (아래 키워드 탭 또는 터미널 브리지 탭 사용)</p>
            <pre>A my-feature    # 전체 Stage A~E 실행
D my-feature    # Stage D만 (구현)
E my-feature    # Stage E + B_review (검증)</pre>
            <p><strong>Step 3</strong>: 상태 확인</p>
            <pre>npm run project:status
npm run wp:next
npm run gate:all</pre>
          </div>
        </div>
        <div class="ab-guide-block">
          <div class="ab-guide-block-head" onclick="abToggleGuide(this)">
            <div class="ab-guide-block-title"><span>🔑</span><span>단일 키워드 실행표</span></div>
            <span class="ab-guide-chevron">▼</span>
          </div>
          <div class="ab-guide-body">
            <p>키워드를 클릭하면 선택된 터미널에 전송됩니다. 터미널 브리지 탭에서 세션을 먼저 선택하세요.</p>
            <ul>
              <li><code onclick="abSendKeyword(this.textContent)">계속</code> — next-actions priority 1 실행</li>
              <li><code onclick="abSendKeyword('A 도메인명')">A [도메인]</code> — Stage A~E 전체 실행</li>
              <li><code onclick="abSendKeyword('D 도메인명')">D [도메인]</code> — Stage D만 (구현 전용)</li>
              <li><code onclick="abSendKeyword('E 도메인명')">E [도메인]</code> — Stage E + B_review</li>
              <li><code onclick="abSendKeyword('검토')">검토</code> — 현재 상태 보고</li>
              <li><code onclick="abSendKeyword('게이트')">게이트</code> — 전 도메인 품질 게이트</li>
              <li><code onclick="abSendKeyword('건강')">건강</code> — 건강도 대시보드</li>
              <li><code onclick="abSendKeyword('A *')">A *</code> — 전 도메인 병렬 실행</li>
            </ul>
          </div>
        </div>
        <div class="ab-guide-block">
          <div class="ab-guide-block-head" onclick="abToggleGuide(this)">
            <div class="ab-guide-block-title"><span>🏗</span><span>아키텍처 원칙 10가지</span></div>
            <span class="ab-guide-chevron">▼</span>
          </div>
          <div class="ab-guide-body">
            <ul>
              <li><strong>계약 전용 연결</strong>: 도메인 간 직접 src/ import 금지</li>
              <li><strong>Clean Architecture</strong>: 의존성은 바깥→안쪽만</li>
              <li><strong>품질 게이트 절대주의</strong>: FAIL이면 완료 선언 금지</li>
              <li><strong>메모리 우선</strong>: <code>memory/L0-hot/</code>를 먼저 읽음</li>
              <li><strong>ADR 필수</strong>: 구조적 판단 변경 시 ADR 생성 (<code>npm run adr:new</code>)</li>
              <li><strong>불확실성 명시</strong>: [확인 필요] 태그 사용</li>
              <li><strong>리스크 비례 방어</strong>: risk_level에 비례해 보안 강화</li>
              <li><strong>불변 패턴</strong>: 엔티티 상태 직접 수정 금지</li>
              <li><strong>증거 기반 리뷰</strong>: 재현 절차 없는 지적은 "추정"</li>
              <li><strong>모놀리스 우선</strong>: 계약 안정 후에만 도메인 분리</li>
            </ul>
          </div>
        </div>
        <div class="ab-guide-block">
          <div class="ab-guide-block-head" onclick="abToggleGuide(this)">
            <div class="ab-guide-block-title"><span>🔧</span><span>트러블슈팅</span></div>
            <span class="ab-guide-chevron">▼</span>
          </div>
          <div class="ab-guide-body">
            <ul>
              <li><strong>테스트 FAIL</strong>: Claude가 최대 3회 자동 재시도. 3회 초과 시 멈추고 보고</li>
              <li><strong>서버 연결 안됨</strong>: <code>python3 scripts/serve.py</code> (포트 8080) 실행</li>
              <li><strong>세션 없음</strong>: 터미널 탭 → 세션 갱신 → CLI 탭 선택</li>
              <li><strong>상태 불일치</strong>: <code>npm run wp:reconcile</code></li>
              <li><strong>INV 충돌</strong>: ADR 생성 → <code>npm run adr:new</code></li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- 터미널 브리지 -->
    <div class="ab-panel" id="ab-panel-terminal">
      <div class="ab-term-grid">
        <div class="ab-card">
          <div class="ab-card-title">VS Code 터미널 세션 선택</div>
          <div class="ab-session-list" id="ab-session-list"><div style="font-size:12px;color:var(--muted);padding:8px;">세션 로딩 중...</div></div>
          <div style="margin-top:10px;display:flex;gap:6px;">
            <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abRefreshSessions()">⟳ 새로고침</button>
            <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abSendEnter()">↵ Enter</button>
          </div>
        </div>
        <div class="ab-card">
          <div class="ab-card-title">명령 전송</div>
          <input class="ab-cmd-input" id="ab-cmd-input" type="text" placeholder="명령어 또는 Claude 키워드... (Enter로 전송)" autocomplete="off" spellcheck="false">
          <div class="ab-btn-row">
            <button class="ab-btn ab-btn-primary" onclick="abSendCmd()">▶ 전송 + Enter</button>
            <button class="ab-btn ab-btn-secondary" onclick="abSendCmdNoEnter()">전송만</button>
          </div>
          <div id="ab-send-result" class="ab-result"></div>
          <div style="margin-top:14px;">
            <div class="ab-card-title" style="margin-bottom:8px;">빠른 키워드</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abFillCmd('계속')">계속</button>
              <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abFillCmd('검토')">검토</button>
              <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abFillCmd('게이트')">게이트</button>
              <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abFillCmd('건강')">건강</button>
              <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abFillCmd('게이트 *')">게이트 *</button>
              <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abFillCmd('A *')">A *</button>
              <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abFillCmd('D *')">D *</button>
              <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abFillCmd('그래프')">그래프</button>
            </div>
          </div>
          <div style="margin-top:12px;">
            <div class="ab-card-title" style="margin-bottom:8px;">도메인 지정 실행</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input class="ab-cmd-input" id="ab-domain-input" type="text" placeholder="도메인명 (예: billing)" style="flex:1;margin-bottom:0;min-width:120px;">
              <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abRunWithDomain('A')">A</button>
              <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abRunWithDomain('D')">D</button>
              <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abRunWithDomain('E')">E</button>
              <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abRunWithDomain('보고서')">보고서</button>
            </div>
          </div>
        </div>
      </div>
      <div class="ab-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div class="ab-card-title" style="margin:0;">전송 로그</div>
          <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abClearLog()">지우기</button>
        </div>
        <div class="ab-log" id="ab-log"><div class="ab-log-line ab-log-empty">명령을 전송하면 여기에 결과가 표시됩니다.</div></div>
      </div>
    </div>

    <!-- 명령 팔레트 -->
    <div class="ab-panel" id="ab-panel-commands">
      <input class="ab-cmd-search" id="ab-cmd-search" type="text" placeholder="명령어 검색... (예: test, validate, wp, health)" oninput="abFilterPalette(this.value)">
      <div class="ab-palette-grid">
        <div class="ab-palette-section"><div class="ab-palette-section-head">🧪 테스트</div><div class="ab-palette-list">
          <div class="ab-palette-item" data-search="test 전체"><span>전체 테스트</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm test</span><button class="ab-palette-run" onclick="abSendCmd2('npm test')">▶</button></div></div>
          <div class="ab-palette-item" data-search="test:contract 계약"><span>계약 드리프트 테스트</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run test:contract</span><button class="ab-palette-run" onclick="abSendCmd2('npm run test:contract')">▶</button></div></div>
          <div class="ab-palette-item" data-search="test:integration 통합"><span>통합 테스트</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run test:integration</span><button class="ab-palette-run" onclick="abSendCmd2('npm run test:integration')">▶</button></div></div>
          <div class="ab-palette-item" data-search="test:e2e smoke"><span>E2E 스모크</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run test:e2e-smoke</span><button class="ab-palette-run" onclick="abSendCmd2('npm run test:e2e-smoke')">▶</button></div></div>
          <div class="ab-palette-item" data-search="test:property 프로퍼티"><span>프로퍼티 테스트</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run test:property</span><button class="ab-palette-run" onclick="abSendCmd2('npm run test:property')">▶</button></div></div>
        </div></div>
        <div class="ab-palette-section"><div class="ab-palette-section-head">✅ 검증 · 품질</div><div class="ab-palette-list">
          <div class="ab-palette-item" data-search="gate:all 전체 품질"><span>전체 품질 게이트</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run gate:all</span><button class="ab-palette-run" onclick="abSendCmd2('npm run gate:all')">▶</button></div></div>
          <div class="ab-palette-item" data-search="lint eslint"><span>린트 (ESLint)</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run lint</span><button class="ab-palette-run" onclick="abSendCmd2('npm run lint')">▶</button></div></div>
          <div class="ab-palette-item" data-search="validate:requirements 요구사항"><span>요구사항 검증</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run validate:requirements</span><button class="ab-palette-run" onclick="abSendCmd2('npm run validate:requirements')">▶</button></div></div>
          <div class="ab-palette-item" data-search="validate:contracts 계약"><span>계약 검증</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run validate:contracts</span><button class="ab-palette-run" onclick="abSendCmd2('npm run validate:contracts')">▶</button></div></div>
          <div class="ab-palette-item" data-search="validate:fitness 아키텍처"><span>아키텍처 피트니스</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run validate:fitness</span><button class="ab-palette-run" onclick="abSendCmd2('npm run validate:fitness')">▶</button></div></div>
        </div></div>
        <div class="ab-palette-section"><div class="ab-palette-section-head">📦 Work Packet</div><div class="ab-palette-list">
          <div class="ab-palette-item" data-search="wp:next 다음"><span>다음 WP 확인</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run wp:next</span><button class="ab-palette-run" onclick="abSendCmd2('npm run wp:next')">▶</button></div></div>
          <div class="ab-palette-item" data-search="wp:gaps 갭"><span>갭 분석</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run wp:gaps</span><button class="ab-palette-run" onclick="abSendCmd2('npm run wp:gaps')">▶</button></div></div>
          <div class="ab-palette-item" data-search="wp:gaps:gen 갭 생성"><span>갭 → WP 스켈레톤</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run wp:gaps:gen</span><button class="ab-palette-run" onclick="abSendCmd2('npm run wp:gaps:gen')">▶</button></div></div>
          <div class="ab-palette-item" data-search="wp:health 세션 메트릭"><span>세션 메트릭</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run wp:health</span><button class="ab-palette-run" onclick="abSendCmd2('npm run wp:health')">▶</button></div></div>
          <div class="ab-palette-item" data-search="wp:reconcile 동기화"><span>상태 동기화</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run wp:reconcile</span><button class="ab-palette-run" onclick="abSendCmd2('npm run wp:reconcile')">▶</button></div></div>
        </div></div>
        <div class="ab-palette-section"><div class="ab-palette-section-head">🏥 상태 · 모니터링</div><div class="ab-palette-list">
          <div class="ab-palette-item" data-search="health 건강도"><span>건강도 대시보드</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run health</span><button class="ab-palette-run" onclick="abSendCmd2('npm run health')">▶</button></div></div>
          <div class="ab-palette-item" data-search="project:status 상태"><span>프로젝트 상태</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run project:status</span><button class="ab-palette-run" onclick="abSendCmd2('npm run project:status')">▶</button></div></div>
          <div class="ab-palette-item" data-search="error-budget 에러 버젯"><span>에러 버젯</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run error-budget</span><button class="ab-palette-run" onclick="abSendCmd2('npm run error-budget')">▶</button></div></div>
          <div class="ab-palette-item" data-search="operator:cockpit 오퍼레이터"><span>Operator Cockpit</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run operator:cockpit</span><button class="ab-palette-run" onclick="abSendCmd2('npm run operator:cockpit')">▶</button></div></div>
          <div class="ab-palette-item" data-search="audit:verify 감사"><span>감사 체인 검증</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run audit:verify</span><button class="ab-palette-run" onclick="abSendCmd2('npm run audit:verify')">▶</button></div></div>
        </div></div>
        <div class="ab-palette-section"><div class="ab-palette-section-head">⚙️ 생성 · 빌드</div><div class="ab-palette-list">
          <div class="ab-palette-item" data-search="ui:build UI 빌드"><span>UI 전체 재생성</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run ui:build</span><button class="ab-palette-run" onclick="abSendCmd2('npm run ui:build')">▶</button></div></div>
          <div class="ab-palette-item" data-search="generate:graph 의존성"><span>의존성 그래프</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run generate:graph</span><button class="ab-palette-run" onclick="abSendCmd2('npm run generate:graph')">▶</button></div></div>
          <div class="ab-palette-item" data-search="scaffold 스캐폴드"><span>도메인 스캐폴드</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run scaffold</span><button class="ab-palette-run" onclick="abSendCmd2('npm run scaffold')">▶</button></div></div>
          <div class="ab-palette-item" data-search="adr:new ADR"><span>ADR 새로 생성</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run adr:new</span><button class="ab-palette-run" onclick="abSendCmd2('npm run adr:new')">▶</button></div></div>
          <div class="ab-palette-item" data-search="orchestrate 병렬"><span>병렬 실행 계획</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run orchestrate</span><button class="ab-palette-run" onclick="abSendCmd2('npm run orchestrate')">▶</button></div></div>
        </div></div>
        <div class="ab-palette-section"><div class="ab-palette-section-head">🔄 세션 · 커밋</div><div class="ab-palette-list">
          <div class="ab-palette-item" data-search="session:bootstrap 시작"><span>세션 부트스트랩</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run session:bootstrap</span><button class="ab-palette-run" onclick="abSendCmd2('npm run session:bootstrap')">▶</button></div></div>
          <div class="ab-palette-item" data-search="session:end 종료"><span>세션 종료</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run session:end</span><button class="ab-palette-run" onclick="abSendCmd2('npm run session:end')">▶</button></div></div>
          <div class="ab-palette-item" data-search="commit:guard 커밋 가드"><span>커밋 가드</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run commit:guard</span><button class="ab-palette-run" onclick="abSendCmd2('npm run commit:guard')">▶</button></div></div>
          <div class="ab-palette-item" data-search="commit:guard:verify 검증"><span>커밋 가드 (검증만)</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run commit:guard:verify</span><button class="ab-palette-run" onclick="abSendCmd2('npm run commit:guard:verify')">▶</button></div></div>
          <div class="ab-palette-item" data-search="branch:bootstrap 브랜치"><span>브랜치 부트스트랩</span><div style="display:flex;align-items:center;gap:8px;"><span class="ab-palette-cmd">npm run branch:bootstrap</span><button class="ab-palette-run" onclick="abSendCmd2('npm run branch:bootstrap')">▶</button></div></div>
        </div></div>
      </div>
    </div>

    <!-- 파일 탐색 -->
    <div class="ab-panel" id="ab-panel-files">
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">파일을 클릭하면 VS Code에서 열립니다. 「보기/열기」 버튼으로 경로를 터미널에 전송합니다.</p>
      <div class="ab-file-tree">
        <div class="ab-file-group"><div class="ab-file-group-head">📋 요구사항</div><div class="ab-file-list">
          <a class="ab-file-item" href="#" onclick="abOpenFile('requirements/requirements.yaml');return false;"><span>📄</span><span class="ab-file-name">requirements.yaml</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('code requirements/requirements.yaml');event.stopPropagation();">VS Code</button></div></a>
          <a class="ab-file-item" href="#" onclick="abOpenFile('requirements/DOMAIN_TEMPLATE.yaml');return false;"><span>📄</span><span class="ab-file-name">DOMAIN_TEMPLATE.yaml</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('code requirements/DOMAIN_TEMPLATE.yaml');event.stopPropagation();">VS Code</button></div></a>
          <a class="ab-file-item" href="#" onclick="abOpenFile('requirements/constraints.yaml');return false;"><span>🔒</span><span class="ab-file-name">constraints.yaml</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('cat requirements/constraints.yaml');event.stopPropagation();">보기</button></div></a>
        </div></div>
        <div class="ab-file-group"><div class="ab-file-group-head">🧠 메모리 (핫 상태)</div><div class="ab-file-list">
          <a class="ab-file-item" href="#" onclick="abOpenFile('memory/L0-hot/current-state.yaml');return false;"><span>🔴</span><span class="ab-file-name">current-state.yaml</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('cat memory/L0-hot/current-state.yaml');event.stopPropagation();">보기</button></div></a>
          <a class="ab-file-item" href="#" onclick="abOpenFile('memory/L0-hot/next-actions.yaml');return false;"><span>⚡</span><span class="ab-file-name">next-actions.yaml</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('cat memory/L0-hot/next-actions.yaml');event.stopPropagation();">보기</button></div></a>
          <a class="ab-file-item" href="#" onclick="abOpenFile('memory/L0-hot/reflection-log.yaml');return false;"><span>📝</span><span class="ab-file-name">reflection-log.yaml</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('cat memory/L0-hot/reflection-log.yaml');event.stopPropagation();">보기</button></div></a>
          <a class="ab-file-item" href="#" onclick="abOpenFile('memory/project/lessons-learned.yaml');return false;"><span>📚</span><span class="ab-file-name">lessons-learned.yaml</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('cat memory/project/lessons-learned.yaml');event.stopPropagation();">보기</button></div></a>
        </div></div>
        <div class="ab-file-group"><div class="ab-file-group-head">⚙️ 설정 · 거버넌스</div><div class="ab-file-list">
          <a class="ab-file-item" href="#" onclick="abOpenFile('CLAUDE.md');return false;"><span>🤖</span><span class="ab-file-name">CLAUDE.md</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('code CLAUDE.md');event.stopPropagation();">VS Code</button></div></a>
          <a class="ab-file-item" href="#" onclick="abOpenFile('HOW_TO_USE.md');return false;"><span>📖</span><span class="ab-file-name">HOW_TO_USE.md</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('code HOW_TO_USE.md');event.stopPropagation();">VS Code</button></div></a>
          <a class="ab-file-item" href="#" onclick="abOpenFile('package.json');return false;"><span>📦</span><span class="ab-file-name">package.json</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('code package.json');event.stopPropagation();">VS Code</button></div></a>
          <a class="ab-file-item" href="#" onclick="abOpenFile('master-shell/plugin-registry/registry.yaml');return false;"><span>🔌</span><span class="ab-file-name">plugin-registry.yaml</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('code master-shell/plugin-registry/registry.yaml');event.stopPropagation();">VS Code</button></div></a>
        </div></div>
        <div class="ab-file-group"><div class="ab-file-group-head">📜 문서 · ADR</div><div class="ab-file-list">
          <a class="ab-file-item" href="#" onclick="abSendToTerminal('ls docs/adr/');return false;"><span>📁</span><span class="ab-file-name">docs/adr/ 목록</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('ls docs/adr/');event.stopPropagation();">ls</button></div></a>
          <a class="ab-file-item" href="#" onclick="abSendToTerminal('ls worklog/ | tail -10');return false;"><span>📁</span><span class="ab-file-name">worklog/ 최근</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('ls worklog/ | tail -10');event.stopPropagation();">ls</button></div></a>
          <a class="ab-file-item" href="#" onclick="abSendToTerminal('ls domains/');return false;"><span>📁</span><span class="ab-file-name">domains/ 전체</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('ls domains/');event.stopPropagation();">ls</button></div></a>
          <a class="ab-file-item" href="#" onclick="abSendToTerminal('ls memory/reflections/');return false;"><span>📁</span><span class="ab-file-name">memory/reflections/</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('ls memory/reflections/');event.stopPropagation();">ls</button></div></a>
        </div></div>
        <div class="ab-file-group"><div class="ab-file-group-head">🖥 서버 · 자동화</div><div class="ab-file-list">
          <a class="ab-file-item" href="vscode-cli-automation/index.html" target="_blank"><span>⚡</span><span class="ab-file-name">CLI 자동 전송기</span></a>
          <a class="ab-file-item" href="#" onclick="abSendToTerminal('python3 scripts/serve.py');return false;"><span>🌐</span><span class="ab-file-name">서버 시작 (8080)</span><div class="ab-file-actions"><button class="ab-file-action-btn" onclick="abSendToTerminal('python3 scripts/serve.py');event.stopPropagation();">실행</button></div></a>
          <a class="ab-file-item" href="/api/pty/sessions" target="_blank"><span>📡</span><span class="ab-file-name">/api/pty/sessions</span></a>
          <a class="ab-file-item" href="/api/automation/state" target="_blank"><span>📊</span><span class="ab-file-name">/api/automation/state</span></a>
        </div></div>
        <div class="ab-file-group"><div class="ab-file-group-head">📊 UI 포털</div><div class="ab-file-list">
          <a class="ab-file-item" href="master-planner/index.html" target="_blank"><span>🗂</span><span class="ab-file-name">마스터 플래너</span></a>
          <a class="ab-file-item" href="catalog-site/index.html" target="_blank"><span>📚</span><span class="ab-file-name">도메인 카탈로그</span></a>
          <a class="ab-file-item" href="mindmap/index.html" target="_blank"><span>🎛</span><span class="ab-file-name">통합 통제 센터</span></a>
          <a class="ab-file-item" href="quality/index.html" target="_blank"><span>✅</span><span class="ab-file-name">품질 게이트</span></a>
          <a class="ab-file-item" href="audit/index.html" target="_blank"><span>🔍</span><span class="ab-file-name">감사 로그</span></a>
          <a class="ab-file-item" href="study-guide/index.html" target="_blank"><span>🎓</span><span class="ab-file-name">학습 가이드</span></a>
        </div></div>
      </div>
    </div>

    <!-- 키워드 실행표 -->
    <div class="ab-panel" id="ab-panel-keywords">
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px;">키워드를 클릭하면 선택된 VS Code 터미널에 바로 전송됩니다. 도메인 이름이 필요한 키워드는 아래 입력창에서 설정하세요.</p>
      <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">
        <span style="font-size:12px;color:var(--muted);">도메인명:</span>
        <input class="ab-cmd-input" id="ab-kw-domain" type="text" placeholder="billing, video, task-tracking ..." style="width:220px;margin:0;">
      </div>
      <div class="ab-card">
        <table class="ab-kw-table">
          <thead><tr><th>키워드</th><th>설명</th><th>에이전트</th><th>실행</th></tr></thead>
          <tbody>
            <tr><td><span class="ab-kw-code" onclick="abSendKwSimple('계속')">계속</span></td><td>next-actions priority 1 실행</td><td>—</td><td><button class="ab-kw-run-btn" onclick="abSendKwSimple('계속')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwWithDomain('A')">A [도메인]</span></td><td>Stage A~E 전체 실행</td><td>architect→implementer→adversary</td><td><button class="ab-kw-run-btn" onclick="abSendKwWithDomain('A')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwWithDomain('D')">D [도메인]</span></td><td>Stage D만 (구현 전용)</td><td>implementer</td><td><button class="ab-kw-run-btn" onclick="abSendKwWithDomain('D')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwWithDomain('E')">E [도메인]</span></td><td>Stage E + B_review (검증)</td><td>adversary→reviewer</td><td><button class="ab-kw-run-btn" onclick="abSendKwWithDomain('E')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwSimple('검토')">검토</span></td><td>현재 상태 보고</td><td>—</td><td><button class="ab-kw-run-btn" onclick="abSendKwSimple('검토')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwSimple('게이트')">게이트</span></td><td>전 도메인 품질 게이트</td><td>observer</td><td><button class="ab-kw-run-btn" onclick="abSendKwSimple('게이트')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwWithDomain('B_review')">B_review [도메인]</span></td><td>적대적 리뷰만 (ultrathink)</td><td>reviewer (opus)</td><td><button class="ab-kw-run-btn" onclick="abSendKwWithDomain('B_review')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwWithDomain('보고서')">보고서 [도메인]</span></td><td>학습보고서 생성</td><td>reporter</td><td><button class="ab-kw-run-btn" onclick="abSendKwWithDomain('보고서')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwSimple('건강')">건강</span></td><td>건강도 대시보드</td><td>—</td><td><button class="ab-kw-run-btn" onclick="abSendKwSimple('건강')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwSimple('그래프')">그래프</span></td><td>의존성 다이어그램 생성</td><td>—</td><td><button class="ab-kw-run-btn" onclick="abSendKwSimple('그래프')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwSimple('카탈로그')">카탈로그</span></td><td>도메인 카탈로그 생성</td><td>—</td><td><button class="ab-kw-run-btn" onclick="abSendKwSimple('카탈로그')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwSimple('A *')">A *</span></td><td>전 도메인 병렬 실행</td><td>ultrathink</td><td><button class="ab-kw-run-btn" onclick="abSendKwSimple('A *')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwSimple('D *')">D *</span></td><td>전 도메인 Stage D 병렬</td><td>implementer×n</td><td><button class="ab-kw-run-btn" onclick="abSendKwSimple('D *')">▶</button></td></tr>
            <tr><td><span class="ab-kw-code" onclick="abSendKwSimple('게이트 *')">게이트 *</span></td><td>전 도메인 품질 게이트</td><td>observer</td><td><button class="ab-kw-run-btn" onclick="abSendKwSimple('게이트 *')">▶</button></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>`;
}

function buildAutomationBridgeJs() {
  return `
(function() {
  'use strict';
  const AB_API = '';
  let abSelectedPts = '';
  let abSessions = [];

  window.abSwitchTab = function(tabId, btn) {
    document.querySelectorAll('.ab-tab').forEach(function(t){ t.classList.remove('ab-active'); });
    document.querySelectorAll('.ab-panel').forEach(function(p){ p.classList.remove('ab-active'); });
    btn.classList.add('ab-active');
    var panel = document.getElementById('ab-panel-' + tabId);
    if (panel) panel.classList.add('ab-active');
  };

  window.abToggleGuide = function(head) {
    var block = head.closest('.ab-guide-block');
    if (block) block.classList.toggle('ab-open');
  };

  window.abRefreshSessions = function() {
    fetch(AB_API + '/api/pty/sessions')
      .then(function(r){ return r.json(); })
      .then(function(d){
        abSessions = Array.isArray(d.sessions) ? d.sessions : [];
        renderAbSessions();
        updateAbConn(true);
        var ptyEl = document.getElementById('ab-pty-live');
        if (ptyEl) ptyEl.textContent = abSessions.length + '개';
        var wpEl = document.getElementById('ab-wp-live');
        var wpSrc = document.getElementById('live-current-wp');
        if (wpEl && wpSrc) wpEl.textContent = wpSrc.textContent || '—';
        var brEl = document.getElementById('ab-branch-live');
        var brSrc = document.getElementById('live-branch-status');
        if (brEl && brSrc) brEl.textContent = brSrc.textContent || '—';
      })
      .catch(function(){
        updateAbConn(false);
        var el = document.getElementById('ab-session-list');
        if (el) el.innerHTML = '<div style="font-size:12px;color:#dc2626;padding:8px;">서버 연결 실패. python3 scripts/serve.py를 실행하세요.</div>';
      });
  };

  function renderAbSessions() {
    var el = document.getElementById('ab-session-list');
    if (!el) return;
    if (!abSessions.length) { el.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px;">열린 터미널이 없습니다.</div>'; return; }
    var html = '';
    abSessions.forEach(function(s) {
      var pts = String(s.pts || '');
      var procs = Array.isArray(s.processes) ? s.processes : [];
      var aiCli = ['claude','codex','aider','gemini','amp'].find(function(n){
        return procs.some(function(p){ return (String(p.comm||'')+String(p.cmdline||'')).toLowerCase().includes(n); });
      }) || '';
      var shellType = ['bash','zsh','fish','sh'].find(function(n){
        return procs.some(function(p){ return String(p.comm||'').toLowerCase() === n; });
      }) || '';
      var sel = pts === abSelectedPts ? ' ab-selected' : '';
      var badge = aiCli ? '<span class="ab-session-badge ai">'+aiCli+'</span>' : (shellType ? '<span class="ab-session-badge">'+shellType+'</span>' : '');
      var procLabel = procs.map(function(p){ return p.comm; }).filter(Boolean).slice(0,3).join(', ');
      html += '<div class="ab-session-item'+sel+'" onclick="abSelectSession(\\''+pts.replace(/'/g,"\\\\'")+'\\')"><div><div class="ab-session-pts">'+pts+'</div><div class="ab-session-info">'+(procLabel||'—')+'</div></div>'+badge+'</div>';
    });
    el.innerHTML = html;
  }

  window.abSelectSession = function(pts) {
    abSelectedPts = pts;
    renderAbSessions();
    var el = document.getElementById('ab-target-pts');
    if (el) el.textContent = pts || '미선택';
    abLog('세션 선택: ' + pts, 'info');
  };

  function updateAbConn(ok) {
    var dot = document.getElementById('ab-conn-dot');
    var lbl = document.getElementById('ab-conn-label');
    if (dot) dot.className = 'ab-status-dot' + (ok ? ' connected' : ' error');
    if (lbl) lbl.textContent = ok ? '서버 연결됨' : '서버 연결 실패';
  }

  function abSendText(text, addEnter) {
    if (!abSelectedPts) {
      abLog('오류: 터미널 세션을 먼저 선택하세요 (터미널 브리지 탭)', 'fail');
      showAbResult('터미널 세션을 먼저 선택하세요', false);
      return Promise.resolve(false);
    }
    var payload = { pts: abSelectedPts, text: addEnter ? text + '\\r' : text, action: 'prompt', name: 'automation-bridge' };
    return fetch(AB_API + '/api/pty/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, data: d }; }); })
      .then(function(res) {
        if (res.ok && res.data.ok) { abLog('전송: ' + (text.length > 50 ? text.slice(0,47)+'...' : text), 'ok'); showAbResult('전송 완료', true); return true; }
        else { abLog('전송 실패: ' + (res.data.error||'오류'), 'fail'); showAbResult('전송 실패', false); return false; }
      })
      .catch(function(e){ abLog('네트워크 오류: '+e.message, 'fail'); showAbResult('서버 연결 오류', false); return false; });
  }

  window.abSendCmd = function() { var i = document.getElementById('ab-cmd-input'); if (i&&i.value.trim()) abSendText(i.value.trim(), true); };
  window.abSendCmdNoEnter = function() { var i = document.getElementById('ab-cmd-input'); if (i&&i.value.trim()) abSendText(i.value.trim(), false); };
  window.abSendEnter = function() {
    if (!abSelectedPts) { abLog('터미널 세션을 먼저 선택하세요', 'fail'); return; }
    fetch(AB_API + '/api/pty/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pts: abSelectedPts, text: '\\r', action: 'enter', name: 'automation-bridge' }) }).then(function(){ abLog('Enter 전송', 'ok'); });
  };
  window.abFillCmd = function(cmd) { var i = document.getElementById('ab-cmd-input'); if (i){ i.value = cmd; i.focus(); } };
  window.abSendCmd2 = function(cmd) {
    if (!abSelectedPts) {
      if (confirm('터미널 세션이 선택되지 않았습니다.\\n터미널 브리지 탭에서 세션을 선택하세요.')) { document.querySelectorAll('.ab-tab')[1].click(); }
      return;
    }
    abSendText(cmd, true);
  };
  window.abSendToTerminal = function(cmd) {
    if (!abSelectedPts) {
      if (confirm('터미널 세션이 선택되지 않았습니다.\\n터미널 탭에서 세션을 먼저 선택하세요.')) { document.querySelectorAll('.ab-tab')[1].click(); }
      return;
    }
    abSendText(cmd, true);
  };
  window.abSendKeyword = function(kw) {
    if (!abSelectedPts) { abFillCmd(typeof kw === 'string' ? kw : ''); document.querySelectorAll('.ab-tab')[1].click(); abLog('터미널 탭에서 세션 선택 후 전송하세요: ' + kw, 'info'); return; }
    if (typeof kw === 'string') abSendText(kw, true);
  };
  window.abRunWithDomain = function(stage) {
    var d = (document.getElementById('ab-domain-input')||{}).value||'';
    if (!d.trim()) { abLog('도메인명을 입력하세요', 'fail'); return; }
    abSendText(stage + ' ' + d.trim(), true);
  };
  window.abSendKwSimple = function(kw) { abSendText(kw, true); };
  window.abSendKwWithDomain = function(keyword) {
    var d = (document.getElementById('ab-kw-domain')||{}).value||'';
    if (!d.trim()) {
      abLog('도메인명을 입력한 후 실행하세요', 'info');
      var el = document.getElementById('ab-kw-domain');
      if (el) { el.focus(); el.style.borderColor = '#dc2626'; setTimeout(function(){ el.style.borderColor = ''; }, 1500); }
      return;
    }
    abSendText(keyword + ' ' + d.trim(), true);
  };
  window.abOpenFile = function(relPath) {
    var uri = 'vscode://file/root/workspace/my-module/' + relPath;
    window.open(uri);
    abLog('VS Code 열기: ' + relPath, 'info');
  };
  window.abFilterPalette = function(query) {
    var q = query.toLowerCase().trim();
    document.querySelectorAll('.ab-palette-item').forEach(function(item) {
      item.classList.toggle('ab-hidden', q && !(item.getAttribute('data-search')||'').toLowerCase().includes(q));
    });
  };
  window.abLog = function(msg, type) {
    var box = document.getElementById('ab-log');
    if (!box) return;
    var empty = box.querySelector('.ab-log-empty');
    if (empty) empty.remove();
    var line = document.createElement('div');
    var now = new Date().toTimeString().slice(0,8);
    line.className = 'ab-log-line' + (type==='ok'?' ab-log-ok':type==='fail'?' ab-log-fail':type==='info'?' ab-log-info':'');
    line.textContent = '['+now+'] '+msg;
    box.insertBefore(line, box.firstChild);
    if (box.children.length > 60) box.removeChild(box.lastChild);
  };
  window.abClearLog = function() {
    var box = document.getElementById('ab-log');
    if (box) box.innerHTML = '<div class="ab-log-line ab-log-empty">로그가 여기에 표시됩니다.</div>';
  };
  function showAbResult(msg, ok) {
    var el = document.getElementById('ab-send-result');
    if (!el) return;
    el.textContent = msg;
    el.className = 'ab-result ' + (ok ? 'ab-result-ok' : 'ab-result-fail');
    clearTimeout(el._t);
    el._t = setTimeout(function(){ el.className = 'ab-result'; }, 3000);
  }
  document.addEventListener('DOMContentLoaded', function() {
    var inp = document.getElementById('ab-cmd-input');
    if (inp) inp.addEventListener('keydown', function(e){ if (e.key==='Enter'){ e.preventDefault(); abSendCmd(); } });
    abRefreshSessions();
    setInterval(abRefreshSessions, 8000);
    abLog('Automation Bridge 초기화 완료', 'info');
  });
})();
`;
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
