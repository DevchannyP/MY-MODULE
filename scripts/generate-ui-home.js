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

function buildMpoPanel() {
  return `
<section id="mpo-panel" style="position:fixed;right:20px;bottom:20px;z-index:50;width:min(420px,calc(100vw - 32px));background:rgba(10,19,25,0.94);color:#f5f7f9;border:1px solid rgba(255,255,255,0.16);border-radius:18px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,0.35);backdrop-filter:blur(14px);font-family:'IBM Plex Sans','Pretendard',sans-serif;">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:0;">
    <strong style="font-size:15px;letter-spacing:0.02em;flex:1;">MPO v1.0</strong>
    <span id="mpo-status-chip" style="font-size:12px;padding:4px 8px;border-radius:999px;background:#1d3a2b;color:#b8ffd1;">idle</span>
    <button id="mpo-collapse-btn" title="접기 / 펼치기" style="border:none;background:rgba(255,255,255,0.08);color:#f5f7f9;border-radius:8px;padding:4px 8px;cursor:pointer;font-size:14px;line-height:1;transition:background .15s;">▾</button>
  </div>

  <div id="mpo-body" style="margin-top:10px;">
    <label for="mpo-goal-input" style="display:block;font-size:12px;opacity:0.8;margin-bottom:6px;">목표 한 줄</label>
    <textarea id="mpo-goal-input" rows="3" style="width:100%;resize:vertical;border-radius:12px;border:1px solid rgba(255,255,255,0.12);background:#081016;color:#f5f7f9;padding:10px 12px;font:inherit;box-sizing:border-box;">문서 정리와 MPO dry-run 검증 경로를 확인해줘</textarea>

    <div style="display:flex;gap:8px;margin-top:10px;">
      <button id="mpo-plan-button" style="flex:1;border:none;border-radius:12px;padding:10px 12px;background:#f2c14e;color:#1f2022;font-weight:700;cursor:pointer;">계획 만들기</button>
      <button id="mpo-approve-button" style="flex:1;border:none;border-radius:12px;padding:10px 12px;background:#2c7be5;color:#fff;font-weight:700;cursor:pointer;" disabled>승인 후 실행</button>
    </div>

    <div id="mpo-term-bar" style="display:none;margin-top:10px;padding:6px 10px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);font-size:11px;align-items:center;gap:6px;">
      <span style="opacity:0.6;">터미널</span>
      <span id="mpo-term-pts" style="font-family:monospace;color:#7dd3fc;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">—</span>
      <span id="mpo-term-badge" style="padding:2px 6px;border-radius:99px;font-size:10px;font-weight:700;background:rgba(34,197,94,0.12);color:#4ade80;border:1px solid rgba(34,197,94,0.25);">미탐색</span>
    </div>

    <div id="mpo-summary" style="margin-top:10px;font-size:12px;line-height:1.5;opacity:0.85;">세션 없음</div>
    <div id="mpo-plan-list" style="margin-top:10px;max-height:220px;overflow:auto;display:grid;gap:8px;"></div>
    <div id="mpo-events" style="margin-top:10px;max-height:180px;overflow:auto;background:#0f1a21;border-radius:12px;padding:10px;font-size:11px;line-height:1.5;"></div>
  </div>
</section>
<script>
(function() {
  var statusChip = document.getElementById('mpo-status-chip');
  var collapseBtn = document.getElementById('mpo-collapse-btn');
  var bodyEl = document.getElementById('mpo-body');
  var planButton = document.getElementById('mpo-plan-button');
  var approveButton = document.getElementById('mpo-approve-button');
  var goalInput = document.getElementById('mpo-goal-input');
  var summaryEl = document.getElementById('mpo-summary');
  var planListEl = document.getElementById('mpo-plan-list');
  var eventsEl = document.getElementById('mpo-events');
  var termBarEl = document.getElementById('mpo-term-bar');
  var termPtsEl = document.getElementById('mpo-term-pts');
  var termBadgeEl = document.getElementById('mpo-term-badge');
  var currentSessionId = null;
  var collapsed = false;

  var STATUS_STYLES = {
    idle: { background: '#334155', color: '#e2e8f0' },
    planning: { background: '#713f12', color: '#fde68a' },
    awaiting_approval: { background: '#1e3a8a', color: '#bfdbfe' },
    queued: { background: '#1e40af', color: '#dbeafe' },
    running: { background: '#14532d', color: '#bbf7d0' },
    completed: { background: '#166534', color: '#dcfce7' },
    completed_with_replan: { background: '#78350f', color: '#fde68a' },
    failed: { background: '#7f1d1d', color: '#fecaca' },
    error: { background: '#7f1d1d', color: '#fecaca' }
  };

  /* ── 접기 / 펼치기 ── */
  collapseBtn.addEventListener('click', function() {
    collapsed = !collapsed;
    bodyEl.style.display = collapsed ? 'none' : '';
    collapseBtn.textContent = collapsed ? '▸' : '▾';
    collapseBtn.title = collapsed ? '펼치기' : '접기';
  });

  function setStatus(value) {
    var normalized = String(value || 'idle');
    var style = STATUS_STYLES[normalized] || STATUS_STYLES.idle;
    statusChip.textContent = normalized;
    statusChip.style.background = style.background;
    statusChip.style.color = style.color;
  }

  function appendEvent(line) {
    var ts = new Date().toTimeString().slice(0, 8);
    var item = document.createElement('div');
    item.textContent = '[' + ts + '] ' + line;
    eventsEl.prepend(item);
    if (eventsEl.children.length > 80) eventsEl.removeChild(eventsEl.lastChild);
  }

  function renderPlan(session) {
    currentSessionId = session && session.session_id ? session.session_id : null;
    planListEl.innerHTML = '';
    var wpList = session && session.dag && Array.isArray(session.dag.wp_list) ? session.dag.wp_list : [];
    var replannedCount = 0;
    wpList.forEach(function(wp) {
      var isReplan = Boolean(wp && wp.execution_result && wp.execution_result.auto_replan === true);
      if (isReplan) replannedCount += 1;
      var meta = [wp.domain, wp.layer, wp.provider_tier || 'unrouted'];
      if (isReplan && wp.execution_result && wp.execution_result.replan_of) {
        meta.push('replan of ' + wp.execution_result.replan_of);
      }
      var card = document.createElement('div');
      card.style.cssText = 'padding:10px;border-radius:12px;background:' +
        (isReplan ? 'rgba(245,158,11,0.14);border:1px solid rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.04)');
      card.innerHTML =
        '<strong style="display:block;font-size:12px;">' + wp.id +
        (isReplan ? ' <span style="font-size:10px;padding:2px 6px;border-radius:999px;background:#92400e;color:#fde68a;">AUTO-REPLAN</span>' : '') + '</strong>' +
        '<div style="font-size:12px;margin-top:4px;">' + wp.title + '</div>' +
        '<div style="font-size:11px;opacity:0.75;margin-top:4px;">' + meta.join(' · ') + '</div>';
      planListEl.appendChild(card);
    });
    if (session && session.dag && session.dag.plan_summary) {
      var parts = [
        '총 ' + session.dag.plan_summary.total_wps + '개 WP',
        '예상 토큰 ' + session.dag.plan_summary.total_estimated_tokens,
        '상태 ' + session.status
      ];
      if (replannedCount > 0) parts.push('자동 재계획 ' + replannedCount + '회');
      summaryEl.textContent = parts.join(' · ');
    } else {
      summaryEl.textContent = '세션 없음';
    }
    approveButton.disabled = !(session && session.status === 'awaiting_approval');
  }

  function describeEvent(eventName, payload) {
    if (eventName === 'mpo.plan.replanned') return eventName + ': ' + (payload.failed_wp_id || '') + ' -> ' + (payload.replanned_wp_id || '');
    if (eventName === 'mpo.wp.failed') return eventName + ': ' + (payload.wp_id || '') + ' / ' + (payload.reason || 'unknown');
    if (eventName === 'mpo.plan.completed') return eventName + ': ' + (payload.session_id || '') + ' / completed';
    return eventName + ': ' + (payload.wp_id || payload.session_id || '');
  }

  async function requestJson(url, options) {
    var response = await fetch(url, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}));
    var body = await response.json();
    if (!response.ok) throw new Error(body.detail || body.title || ('HTTP ' + response.status));
    return body;
  }

  /* ── 터미널 자동 탐색 ── */
  var AI_PROCS = ['claude', 'codex', 'aider', 'gemini', 'amp'];
  var SHELL_PROCS = ['bash', 'zsh', 'fish', 'sh'];

  function scoreSession(s) {
    var procs = Array.isArray(s.processes) ? s.processes : [];
    var names = procs.map(function(p) { return String(p.comm || '').toLowerCase(); });
    if (AI_PROCS.some(function(n) { return names.some(function(c) { return c.includes(n); }); })) return 3;
    if (SHELL_PROCS.some(function(n) { return names.includes(n); })) return 2;
    return 1;
  }

  async function autoDetectTerminal() {
    try {
      var res = await fetch('/api/pty/sessions');
      if (!res.ok) return null;
      var data = await res.json();
      var sessions = Array.isArray(data.sessions) ? data.sessions : [];
      if (!sessions.length) return null;
      sessions = sessions.slice().sort(function(a, b) { return scoreSession(b) - scoreSession(a); });
      return sessions[0];
    } catch (_) {
      return null;
    }
  }

  async function sendToTerminal(pts, text) {
    try {
      var res = await fetch('/api/pty/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pts: pts, text: text + '\\r', action: 'prompt', name: 'mpo-agent' })
      });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  function showTermBar(pts, badge, color) {
    termBarEl.style.display = 'flex';
    termPtsEl.textContent = pts || '—';
    termBadgeEl.textContent = badge || '미탐색';
    termBadgeEl.style.color = color || '#4ade80';
    var hexColor = (color || '#4ade80').replace(/^#/, '');
    var hr = parseInt(hexColor.slice(0, 2), 16);
    var hg = parseInt(hexColor.slice(2, 4), 16);
    var hb = parseInt(hexColor.slice(4, 6), 16);
    termBadgeEl.style.borderColor = 'rgba(' + hr + ',' + hg + ',' + hb + ',0.25)';
    termBadgeEl.style.background = 'rgba(' + hr + ',' + hg + ',' + hb + ',0.12)';
  }

  /* ── 계획 만들기 ── */
  planButton.addEventListener('click', async function() {
    try {
      setStatus('planning');
      planButton.disabled = true;
      var session = await requestJson('/api/v1/mpo/plan', {
        method: 'POST',
        body: JSON.stringify({ goal: goalInput.value }),
      });
      renderPlan(session);
      setStatus(session.status || 'planned');
      appendEvent('plan created: ' + session.session_id);
      /* 계획 완료 시 터미널 선제 탐색 */
      autoDetectTerminal().then(function(s) {
        if (!s) return;
        var procs = (s.processes || []).map(function(p) { return p.comm; }).filter(Boolean);
        var isAi = AI_PROCS.some(function(n) { return procs.some(function(c) { return c.includes(n); }); });
        showTermBar(String(s.pts || ''), isAi ? procs[0] : (procs[0] || 'shell'), isAi ? '#7dd3fc' : '#a3a3a3');
        appendEvent('터미널 선제 탐색: ' + String(s.pts || '') + ' (' + procs.slice(0,2).join(', ') + ')');
        if (typeof window.abSelectSession === 'function') window.abSelectSession(String(s.pts || ''));
      });
    } catch (error) {
      setStatus('error');
      appendEvent('plan failed: ' + error.message);
    } finally {
      planButton.disabled = false;
    }
  });

  /* ── 승인 후 실행 (터미널 자동 탐색 + 에이전트 전송) ── */
  approveButton.addEventListener('click', async function() {
    if (!currentSessionId) return;
    try {
      setStatus('queued');
      approveButton.disabled = true;

      /* 1. API 승인 */
      var session = await requestJson('/api/v1/mpo/session/' + currentSessionId + '/approve', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      renderPlan(session);
      setStatus(session.status || 'queued');
      appendEvent('approved: ' + currentSessionId);

      /* 2. 터미널 자동 탐색 */
      appendEvent('터미널 자동 탐색 중...');
      var best = await autoDetectTerminal();

      if (!best) {
        appendEvent('경고: 사용 가능한 터미널 없음 — 터미널 브리지 탭에서 세션 선택 후 수동 전송하세요');
        showTermBar('없음', '미발견', '#f87171');
        return;
      }

      var pts = String(best.pts || '');
      var procs = (best.processes || []).map(function(p) { return p.comm; }).filter(Boolean);
      var isAi = AI_PROCS.some(function(n) { return procs.some(function(c) { return c.includes(n); }); });
      var isShell = !isAi && SHELL_PROCS.some(function(n) { return procs.includes(n); });

      showTermBar(pts, isAi ? procs[0] : (procs[0] || 'shell'), isAi ? '#7dd3fc' : '#4ade80');
      appendEvent('터미널 선택: ' + pts + ' [' + procs.slice(0,3).join(', ') + ']' + (isAi ? ' (AI CLI)' : isShell ? ' (shell)' : ''));

      /* 터미널 브리지와 세션 동기화 */
      if (typeof window.abSelectSession === 'function') window.abSelectSession(pts);

      /* 3. 에이전트 목표 전송 */
      var goal = (goalInput.value || '').trim();
      if (!goal) {
        appendEvent('경고: 목표가 비어 있어 터미널 전송을 건너뜁니다');
        return;
      }
      var sent = await sendToTerminal(pts, goal);
      if (sent) {
        appendEvent('에이전트 전송 완료 → ' + pts + ': ' + goal.slice(0, 50) + (goal.length > 50 ? '…' : ''));
      } else {
        appendEvent('터미널 전송 실패 (' + pts + ') — 서버가 실행 중인지 확인하세요');
      }
    } catch (error) {
      setStatus('error');
      appendEvent('approve failed: ' + error.message);
    }
  });

  /* ── SSE 연결 ── */
  var sseSource = new EventSource('/api/v1/system/events');
  sseSource.addEventListener('mpo.connected', function() { appendEvent('sse connected'); });
  sseSource.onerror = function() { appendEvent('sse 연결 끊김 — 재연결 시도 중'); };
  [
    'mpo.intake.normalized',
    'mpo.decomposition.ready',
    'mpo.envelope.built',
    'mpo.wp.started',
    'mpo.wp.completed',
    'mpo.wp.failed',
    'mpo.plan.replanned',
    'mpo.memory.reconciled',
    'mpo.plan.completed'
  ].forEach(function(eventName) {
    sseSource.addEventListener(eventName, async function(event) {
      var payload = JSON.parse(event.data);
      appendEvent(describeEvent(eventName, payload));
      if (payload.session_id && currentSessionId === payload.session_id) {
        try {
          var session = await requestJson('/api/v1/mpo/session/' + currentSessionId, { method: 'GET' });
          renderPlan(session);
          setStatus(session.status || eventName);
        } catch (error) {
          appendEvent('refresh failed: ' + error.message);
        }
      }
    });
  });
})();
</script>`;
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

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function buildHomeOperatorChainBlueprints({ bootstrap, operatorCockpit }) {
  const branch = operatorCockpit?.branch || {};
  const commitGuard = operatorCockpit?.commit_guard || {};
  const evidence = operatorCockpit?.promotion_evidence || {};
  const validationProfile = operatorCockpit?.validation_profile || bootstrap?.validation_profile || {};
  const validationCommands = Array.isArray(validationProfile.commands)
    ? validationProfile.commands.filter(Boolean)
    : [];
  const recommendedReads = Array.isArray(bootstrap?.recommended_reads)
    ? bootstrap.recommended_reads.filter(Boolean)
    : [];
  const currentWpId = String(bootstrap?.current_wp?.id || operatorCockpit?.current_wp?.id || 'current-wp').trim();
  const currentLaneHint = String(bootstrap?.current_lane_hint || operatorCockpit?.current_lane?.label || 'lane').trim();
  const nextWp = String(bootstrap?.next_wp || operatorCockpit?.next_wp || 'NONE').trim();
  const currentBranch = String(branch.current_branch || bootstrap?.git?.branch || '').trim();
  const recommendedBranch = String(branch.recommended_branch || '').trim();
  const dirtySummary = bootstrap?.git?.dirty
    ? `dirty ${String(bootstrap.git.dirty_count || 0)}건`
    : 'dirty 없음';
  const primaryValidationCommand = String(validationProfile.primary_command || validationCommands[0] || 'npm run ui:build').trim();
  const guardReason = Array.isArray(commitGuard.guard?.reasons) && commitGuard.guard.reasons[0]
    ? String(commitGuard.guard.reasons[0]).trim()
    : String(commitGuard.next_action || 'guard 상태 확인').trim();
  const evidenceGeneratedAt = String(evidence.generated_at_utc || '').trim();
  const evidenceQuality = String(evidence.quality_gate_result || 'UNKNOWN').trim();

  return {
    bootstrap: {
      owner: 'Planner',
      summary: '지금 어떤 일을 하고 있는지, 무엇을 먼저 읽어야 하는지 다시 맞추는 단계입니다.',
      why: `${currentWpId} 기준이 흔들리면 뒤에 나오는 브랜치 점검, 검증, 배포 판단도 모두 헷갈리기 쉬워집니다.`,
      references: recommendedReads.length > 0
        ? recommendedReads.slice(0, 3)
        : ['memory/current-wp.yaml', 'memory/next-actions.yaml'],
      mapSteps: [
        {
          title: '여기서 시작',
          detail: `${currentWpId} / lane ${currentLaneHint} / next ${nextWp}`,
          hrefLabel: '전체 상황 보기',
          href: buildStaticControlCenterHref('operator-summary', 'master-status', {
            reason: 'session bootstrap 기준 확인',
            command: 'npm run session:bootstrap',
            label: 'Session Bootstrap',
            source: 'home-map',
          }),
        },
        {
          title: '먼저 볼 자료',
          detail: recommendedReads.length > 0
            ? recommendedReads.slice(0, 2).join(' / ')
            : 'recommended reads가 없으면 current-wp와 next-actions부터 확인',
        },
        {
          title: '어디부터 고치나',
          detail: '현재 목표와 다음 작업이 어긋나면 세션 요약과 작업 순서부터 다시 맞춥니다.',
        },
        {
          title: '확인 명령',
          detail: 'npm run session:bootstrap',
        },
      ],
    },
    branch: {
      owner: 'Builder',
      summary: '지금 수정해도 되는 브랜치인지 먼저 확인하는 단계입니다.',
      why: recommendedBranch
        ? `현재 ${currentBranch || 'unknown'} 브랜치가 권장 브랜치 ${recommendedBranch}와 다르면 엉뚱한 위치를 수정할 수 있습니다.`
        : '권장 브랜치 정보가 없으면 브랜치 준비 단계부터 다시 확인하는 편이 안전합니다.',
      references: [currentBranch || '현재 브랜치 미확인', recommendedBranch || '권장 브랜치 미확인', dirtySummary],
      mapSteps: [
        {
          title: '여기서 시작',
          detail: `현재 ${currentBranch || 'unknown'} / 권장 ${recommendedBranch || '없음'}`,
        },
        {
          title: '변경 상태 확인',
          detail: dirtySummary,
        },
        {
          title: '어디부터 고치나',
          detail: '브랜치가 다르면 권장 브랜치로 이동하거나 브랜치 준비 명령부터 실행합니다.',
          hrefLabel: '전체 상황 보기',
          href: buildStaticControlCenterHref('operator-summary', 'master-status', {
            reason: 'branch bootstrap 점검',
            command: String(branch.create_command || '').trim(),
            label: 'Branch Bootstrap',
            source: 'home-map',
          }),
        },
        {
          title: '확인 명령',
          detail: String(branch.create_command || 'npm run branch:bootstrap').trim() || 'npm run branch:bootstrap',
        },
      ],
    },
    verify: {
      owner: 'Reviewer',
      summary: '무엇을 검사해야 하는지와 어떤 실패를 먼저 고쳐야 하는지 정하는 단계입니다.',
      why: `${validationCommands.length}개 검사 명령이 연결되어 있으면 가장 먼저 실패한 항목부터 고치는 것이 가장 빠릅니다.`,
      references: validationCommands.length > 0
        ? validationCommands.slice(0, 3)
        : ['검증 명령 없음'],
      mapSteps: [
        {
          title: '여기서 시작',
          detail: primaryValidationCommand || 'primary validation command 없음',
        },
        {
          title: '무엇을 확인하나',
          detail: `${String(validationProfile.packet_type || bootstrap?.validation_profile?.packet_type || 'UNKNOWN')} / Stage ${String(validationProfile.stage || bootstrap?.current_wp?.stage || 'UNKNOWN')}`,
        },
        {
          title: '어디부터 고치나',
          detail: '검사 보드에서 실패한 항목과 차단 상태를 같이 보며 가장 앞선 실패부터 해결합니다.',
          hrefLabel: '검사 보드 열기',
          href: buildStaticControlCenterHref('guard', 'plan-board', {
            reason: 'validation profile 기준 점검',
            command: primaryValidationCommand,
            label: 'Validation Profile',
            source: 'home-map',
          }),
        },
        {
          title: '확인 명령',
          detail: primaryValidationCommand || '검증 명령 없음',
        },
      ],
    },
    'commit-guard': {
      owner: 'Reviewer',
      summary: '지금 변경을 적용해도 되는지 최종 안전 점검을 하는 단계입니다.',
      why: guardReason || '이 차단 이유를 먼저 풀어야 적용하거나 다음 단계로 넘어갈 수 있습니다.',
      references: Array.isArray(commitGuard.guard?.reasons) && commitGuard.guard.reasons.length > 0
        ? commitGuard.guard.reasons.slice(0, 3).map(String)
        : ['guard reason 없음'],
      mapSteps: [
        {
          title: '여기서 시작',
          detail: guardReason || 'guard next action 없음',
        },
        {
          title: '막히는 이유',
          detail: [
            commitGuard.guard?.has_dirty_changes ? 'dirty 있음' : 'dirty 없음',
            commitGuard.guard?.validations_passed ? 'validation 통과' : 'validation 미통과',
            commitGuard.guard?.can_apply ? 'apply 가능' : 'apply 차단',
          ].join(' / '),
        },
        {
          title: '어디부터 고치나',
          detail: '검사 보드에서 검증 결과와 안전 조건을 같이 보면서 차단 이유를 하나씩 없앱니다.',
          hrefLabel: '안전 점검 보드 열기',
          href: buildStaticControlCenterHref('guard', 'plan-board', {
            reason: guardReason || 'commit guard 차단 확인',
            command: commitGuard.guard?.can_apply ? 'npm run commit:guard -- --apply' : 'npm run commit:guard:verify',
            label: 'Commit Guard',
            source: 'home-map',
          }),
        },
        {
          title: '확인 명령',
          detail: commitGuard.guard?.can_apply ? 'npm run commit:guard -- --apply' : 'npm run commit:guard:verify',
        },
      ],
    },
    'release-evidence': {
      owner: 'Reporter',
      summary: '배포하거나 반영해도 되는지 마지막 증거를 모아 확인하는 단계입니다.',
      why: evidenceQuality === 'PASS'
        ? '검사 결과가 PASS라면 지금은 증거를 정리하고 마지막 판단만 하면 됩니다.'
        : '검사 결과나 실행 증거가 비어 있으면 최종 반영 전에 그 부분부터 복구해야 합니다.',
      references: [
        String(evidence.path || 'artifacts/release-evidence/release-evidence.json').trim(),
        `quality gate ${evidenceQuality}`,
        evidenceGeneratedAt ? `generated ${evidenceGeneratedAt}` : 'generated 시각 없음',
      ],
      mapSteps: [
        {
          title: '여기서 시작',
          detail: `${String(evidence.path || 'artifacts/release-evidence/release-evidence.json').trim()} / ${evidenceQuality}`,
        },
        {
          title: '무엇을 확인하나',
          detail: `${String(evidence.artifact_count || 0)}개 artifact / next ${String(evidence.next_action?.id || 'NONE')}`,
        },
        {
          title: '어디부터 고치나',
          detail: '실행 화면에서 증거 생성 명령을 다시 준비하고, 막히게 만든 앞선 실패부터 해결합니다.',
          hrefLabel: '실행 화면 열기',
          href: buildStaticControlCenterHref('execution-failure', 'execution-console', {
            reason: evidenceQuality === 'PASS' ? 'release evidence 최종 확인' : 'release evidence blocker 해소',
            command: 'python3 scripts/generate_release_evidence.py',
            label: 'Release Evidence',
            source: 'home-map',
          }),
        },
        {
          title: '확인 명령',
          detail: 'python3 scripts/generate_release_evidence.py',
        },
      ],
    },
  };
}

function buildHomeOperatorChainMapPanel(item, blueprints) {
  if (!item || typeof item !== 'object') {
    return `
    <section class="flow-map-panel" id="flow-chain-map-panel" aria-live="polite">
      <div class="flow-map-empty">위 카드를 누르면 이 단계가 무슨 뜻인지, 어디부터 고치면 되는지가 여기에 표시됩니다.</div>
    </section>`;
  }

  const itemId = String(item.id || '').trim();
  const blueprint = blueprints[itemId] || {
    owner: 'Operator',
    summary: '이 단계의 쉬운 설명이 아직 준비되지 않았습니다.',
    why: '현재 표시된 이유를 기준으로 제어 센터에서 먼저 확인하세요.',
    references: ['추가 기준 없음'],
    mapSteps: [
      { title: '여기서 시작', detail: String(item.reason || 'reason 없음') },
      { title: '어디부터 고치나', detail: '문제 해결 제어 센터에서 이 단계와 연결된 화면부터 확인합니다.' },
      { title: '확인 명령', detail: String(item.command || '명령 없음') },
    ],
  };
  const mapSteps = Array.isArray(blueprint.mapSteps) ? blueprint.mapSteps : [];
  const references = Array.isArray(blueprint.references) ? blueprint.references.filter(Boolean) : [];

  return `
    <section class="flow-map-panel" id="flow-chain-map-panel" aria-live="polite" data-selected-chain-id="${esc(itemId || 'step')}">
      <div class="flow-map-head">
        <div>
          <h3>이 단계 설명과 해결 순서</h3>
          <p>카드를 누르면 이 단계가 왜 필요한지와 어디부터 확인하면 되는지를 쉬운 순서대로 보여줍니다.</p>
        </div>
        <div class="flow-pill">지금 보는 단계 <strong id="flow-map-selected-label">${esc(item.label || item.id || 'step')}</strong></div>
      </div>
      <div class="flow-map-hero">
        <div class="flow-map-copy">
          <span class="flow-kicker">이건 무엇인가</span>
          <strong id="flow-map-title">${esc(item.label || item.id || 'step')}</strong>
          <p id="flow-map-summary">${esc(blueprint.summary || '설명 없음')}</p>
        </div>
        <div class="flow-map-status">
          <span class="tag ${statusClass(item.status || 'pending')}" id="flow-map-status">${esc(item.status || 'pending')}</span>
          <code id="flow-map-command">${esc(item.command || '명령 없음')}</code>
        </div>
      </div>
      <div class="flow-map-summary-grid">
        <article class="flow-map-summary-card">
          <span>왜 지금 보나</span>
          <strong id="flow-map-why">${esc(blueprint.why || '설명 없음')}</strong>
        </article>
        <article class="flow-map-summary-card">
          <span>지금 보이는 이유</span>
          <strong id="flow-map-reason">${esc(item.reason || 'reason 없음')}</strong>
        </article>
        <article class="flow-map-summary-card">
          <span>주로 다루는 역할</span>
          <strong id="flow-map-owner">${esc(blueprint.owner || 'Operator')}</strong>
        </article>
      </div>
      <div class="flow-map-route">
        ${mapSteps.map((step, index) => `
        <article class="flow-map-step">
          <div class="flow-map-step-index">${index + 1}</div>
          <div class="flow-map-step-copy">
            <span>${esc(step.title || `단계 ${index + 1}`)}</span>
            <strong>${esc(step.detail || '')}</strong>
            ${step.href && step.hrefLabel ? `<a class="flow-chain-link" href="${esc(step.href)}">${esc(step.hrefLabel)}</a>` : ''}
          </div>
        </article>`).join('')}
      </div>
      <div class="flow-map-references">
        <span>바로 보면 좋은 기준</span>
        <div class="flow-map-reference-list">
          ${references.map((reference) => `<code>${esc(reference)}</code>`).join('')}
        </div>
      </div>
    </section>`;
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
  const chainBlueprints = buildHomeOperatorChainBlueprints({ bootstrap, operatorCockpit });
  const spotlightHtml = spotlightItem
    ? `
      <article class="flow-chain-spotlight" id="flow-chain-spotlight" data-chain-id="${esc(spotlightItem.id || 'step')}" role="button" tabindex="0" aria-controls="flow-chain-map-panel">
        <div class="flow-chain-spotlight-copy">
          <span class="flow-kicker">지금 실행할 카드</span>
          <strong id="flow-chain-spotlight-title">${esc(spotlightItem.label || spotlightItem.id || 'step')}</strong>
          <p id="flow-chain-spotlight-reason">${esc(spotlightItem.reason || '다음 단계 설명이 없습니다.')}</p>
          <span class="flow-chain-hint">카드를 클릭하면 상세 설명과 수정 맵이 아래에 열립니다.</span>
        </div>
        <div class="flow-chain-spotlight-actions">
          <span class="tag ${statusClass(spotlightItem.status || 'pending')}" id="flow-chain-spotlight-status">${esc(spotlightItem.status || 'pending')}</span>
          <code id="flow-chain-spotlight-command">${esc(spotlightItem.command || '')}</code>
          <div class="flow-chain-spotlight-links">
            <button type="button" class="flow-chain-link is-button" id="flow-chain-spotlight-copy" data-command="${esc(spotlightItem.command || '')}">명령 복사</button>
            <a class="flow-chain-link" id="flow-chain-spotlight-fill" href="${esc(spotlightExecutionMeta?.href || 'mindmap/index.html#execution-console')}" data-command="${esc(spotlightItem.command || '')}" data-chain-id="${esc(spotlightItem.id || '')}" data-label="${esc(spotlightItem.label || spotlightItem.id || '')}">실행 화면에 넣기</a>
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
      const blueprint = chainBlueprints[itemId] || {};
      return `
      <article class="flow-chain-item${spotlightItem && spotlightItem.id === itemId ? ' is-active' : ''}" data-chain-id="${esc(itemId || 'step')}" data-chain-scope="${esc(scope)}" data-chain-command="${esc(item.command || '')}" role="button" tabindex="0" aria-controls="flow-chain-map-panel">
        <span class="flow-chain-label">${esc(item.label || item.id || 'step')}</span>
        <span class="tag ${statusClass(item.status || 'pending')}">${esc(item.status || 'pending')}</span>
        <p class="flow-chain-summary">${esc(blueprint.summary || item.reason || '다음 단계 설명이 없습니다.')}</p>
        <code>${esc(item.command || '')}</code>
        <div class="flow-chain-delivery">
          <span class="flow-chain-delivery-pill" id="${esc(deliveryId)}" data-delivery-status="none">최근 전달 없음</span>
          <span class="flow-chain-delivery-meta" id="${esc(deliveryMetaId)}">실행 이력 없음</span>
        </div>
        <div class="flow-chain-actions">
          <span class="flow-chain-hint">클릭해서 수정 맵 보기</span>
          <a class="flow-chain-link" href="${esc(focusMeta.href)}">제어 센터에서 자세히 보기</a>
        </div>
      </article>`;
    }).join('')
    : '<div class="flow-chain-empty">operator chain 정보 없음</div>';
  const releaseEvidence = operatorCockpit?.promotion_evidence || {};
  const flowMapHtml = buildHomeOperatorChainMapPanel(spotlightItem, chainBlueprints);

  return `
    <div class="section-head" style="margin-top:36px">
      <div>
        <h2>지금 해야 할 일 안내 바</h2>
        <p>짧게 요청해도 지금 단계, 다음 할 일, 확인 순서를 같은 흐름으로 이어서 보여줍니다.</p>
      </div>
      <div class="flow-pill">짧게 말해도 <strong>흐름 유지</strong></div>
    </div>

    <section class="flow-strip" aria-label="지금 해야 할 일 요약">
      <article class="flow-card flow-card-primary">
        <div class="flow-card-head">
          <span class="flow-kicker">지금 단계</span>
          <span class="tag tone-green">${esc(currentLane.label)}</span>
        </div>
        <h3>${esc(focusPacket.id || 'NONE')}</h3>
        <p>${esc(focusPacket.goal || '지금 선택된 작업이 없습니다.')}</p>
        <div class="flow-meta">
          <span>단계 ${esc(focusPacket.stage || '—')}</span>
          <span>상태 ${esc(focusPacket.status || '—')}</span>
        </div>
      </article>

      <article class="flow-card">
        <div class="flow-card-head">
          <span class="flow-kicker">바로 다음 할 일</span>
          <span class="tag tone-amber">${esc(report.next_wp || nextActions?.next_wp || 'NONE')}</span>
        </div>
        <h3>다음으로 할 작업</h3>
        <p>${esc(nextActionLabel)}</p>
        <div class="flow-meta">
          <span>브랜치 ${esc(bootstrap?.git?.branch || 'unknown')}</span>
          <span>수정 흔적 ${bootstrap?.git?.dirty ? `${esc(bootstrap.git.dirty_count)}건` : '없음'}</span>
        </div>
      </article>

      <article class="flow-card">
        <div class="flow-card-head">
          <span class="flow-kicker">검사 상태</span>
          <span class="tag ${statusClass(qualityGateResult)}">${esc(qualityGateResult)}</span>
        </div>
        <h3>지금 확인할 검사</h3>
        <p>${validationCommands.length}개 검사 명령이 현재 작업에 연결되어 있습니다.</p>
        <div class="flow-code-list">
          ${validationCommands.slice(0, 3).map((command) => `<code>${esc(command)}</code>`).join('')}
        </div>
      </article>

      <article class="flow-card">
        <div class="flow-card-head">
          <span class="flow-kicker">먼저 볼 자료</span>
          <span class="tag tone-slate">${esc(bootstrap?.current_wp?.stage || '—')}</span>
        </div>
        <h3>상황 다시 맞추기</h3>
        <p>대화만 믿지 말고 기준 파일부터 읽어서 현재 상황을 먼저 맞춥니다.</p>
        <div class="flow-code-list">
          ${recommendedReads.map((item) => `<code>${esc(item)}</code>`).join('')}
        </div>
      </article>
    </section>

    <section class="flow-chain-panel" aria-label="문제 해결 순서">
      <div class="flow-chain-head">
        <div>
          <h3>문제 해결 순서</h3>
          <p>지금 어떤 순서로 확인하면 되는지 한 장씩 따라갈 수 있게 정리한 카드입니다.</p>
        </div>
        <div class="flow-chain-head-pills">
          <div class="flow-pill">최근 실행 출처 <strong id="flow-source-summary">아직 기록 없음</strong></div>
          <div class="flow-pill">배포 판단 증거 <strong>${esc(releaseEvidence.quality_gate_result || 'UNKNOWN')}</strong></div>
        </div>
      </div>
      ${spotlightHtml}
      <div class="flow-chain-grid">
        ${operatorChainHtml}
      </div>
    </section>

    ${flowMapHtml}

    <script>
      window.__HOME_INITIAL_OPERATOR_CHAIN__ = ${serializeForInlineScript(operatorChain)};
      window.__HOME_OPERATOR_CHAIN_BLUEPRINTS__ = ${serializeForInlineScript(chainBlueprints)};
    </script>`;
}

function buildHandoffLane({ report, nextActions, bootstrap, operatorCockpit }) {
  const lane = buildHandoffLaneData({ report, nextActions, bootstrap, operatorCockpit });

  return `
        <div class="handoff-lane" id="home-handoff-lane" aria-label="다음 작업 준비 상태">
          <div class="handoff-lane-head">
            <span>다음 작업 준비 상태</span>
            <strong class="tag ${statusClass(lane.drift_status)}" id="handoff-drift-status">${esc(lane.drift_status)}</strong>
          </div>
          <div class="handoff-lane-grid">
            <div><span>지금 작업</span><strong id="handoff-current-wp">${esc(lane.current_wp)}</strong></div>
            <div><span>다음 작업</span><strong id="handoff-next-wp">${esc(lane.next_wp)}</strong></div>
            <div><span>검사 상태</span><strong id="handoff-validation-state">${esc(lane.validation_state)}</strong></div>
            <div><span>증거 상태</span><strong id="handoff-evidence-state">${esc(lane.evidence_state)}</strong></div>
          </div>
          <div class="handoff-next-command">
            <span>다음에 실행할 명령</span>
            <code id="handoff-next-command">${esc(lane.next_command)}</code>
          </div>
          <p>${esc(lane.warning)}</p>
        </div>`;
}

function buildHandoffLaneData({ report, nextActions, bootstrap, operatorCockpit }) {
  return {
    current_wp: report.current_wp || bootstrap?.current_wp?.id || 'NONE',
    next_wp: report.next_wp || nextActions?.next_wp || 'NONE',
    drift_status: report.promotion_pipeline?.drift_status || 'unknown',
    validation_state: operatorCockpit?.commit_guard?.status
      || (report.promotion_pipeline?.promotion_ready ? 'ready' : 'review'),
    evidence_state: operatorCockpit?.promotion_evidence?.quality_gate_result
      || report.promotion_pipeline?.drift_status
      || 'UNKNOWN',
    next_command: operatorCockpit?.next_validation_command
      || (Array.isArray(bootstrap?.validation_profile?.commands) ? bootstrap.validation_profile.commands[0] : '')
      || 'npm run project:status',
    warning: operatorCockpit?.commit_guard?.next_action || 'handoff 상태 확인',
  };
}

function buildHomeMasterPanelBlueprints({ report, nextActions, bootstrap, operatorCockpit }) {
  const driftStatus = String(report?.promotion_pipeline?.drift_status || 'unknown').trim();
  const validationCommand = String(
    operatorCockpit?.next_validation_command
    || bootstrap?.validation_profile?.primary_command
    || (Array.isArray(bootstrap?.validation_profile?.commands) ? bootstrap.validation_profile.commands[0] : '')
    || 'npm run validate:requirements'
  ).trim();
  const branchCommand = String(operatorCockpit?.branch?.create_command || 'npm run branch:bootstrap').trim();
  const currentWp = String(report?.current_wp || bootstrap?.current_wp?.id || 'NONE').trim();
  const nextWp = String(report?.next_wp || nextActions?.next_wp || 'NONE').trim();
  const stage = String(report?.requirements_stage || bootstrap?.current_wp?.stage || '—').trim();
  const recentAction = String(operatorCockpit?.commit_guard?.next_action || '최근 실행 기록 없음').trim();
  const driftHref = buildStaticControlCenterHref('execution-failure', 'execution-console', {
    reason: '배포 준비 상태 점검',
    command: validationCommand,
    label: '배포 준비 상태',
    source: 'home-master-panel',
  });
  const guardHref = buildStaticControlCenterHref('guard', 'plan-board', {
    reason: '검사 상태 점검',
    command: validationCommand,
    label: '검사 상태',
    source: 'home-master-panel',
  });
  const summaryHref = buildStaticControlCenterHref('operator-summary', 'master-status', {
    reason: '전체 실행 상태 확인',
    command: 'npm run operator:cockpit',
    label: '전체 상황',
    source: 'home-master-panel',
  });

  return {
    stage: {
      label: '현재 진행 단계',
      current_value: stage,
      summary: '지금 작업이 전체 흐름에서 어느 단계에 있는지 보여줍니다.',
      detail: '단계를 알면 지금 해야 할 일이 분석인지, 구현인지, 검증인지 바로 구분할 수 있습니다.',
      help: '단계가 애매하면 계획 화면에서 현재 작업 카드를 먼저 확인하세요.',
      href: 'master-planner/index.html',
      href_label: '계획 화면 열기',
      command: 'npm run project:status',
    },
    'current-wp': {
      label: '지금 작업 카드',
      current_value: currentWp,
      summary: '지금 가장 먼저 보고 있는 작업 카드입니다.',
      detail: '현재 작업 카드에는 목표, 진행 상태, 다음 검사가 함께 연결됩니다.',
      help: '지금 무엇을 만들고 있는지 헷갈리면 이 카드부터 보세요.',
      href: 'master-planner/index.html',
      href_label: '현재 작업 열기',
      command: 'npm run project:status',
    },
    'next-wp': {
      label: '다음 작업 카드',
      current_value: nextWp,
      summary: '지금 작업이 끝나면 이어서 진행할 다음 카드입니다.',
      detail: '다음 작업을 먼저 알고 있으면 현재 작업 범위를 넘겨잡는 일을 줄일 수 있습니다.',
      help: '다음 카드 확인 후 지금 작업 범위를 좁혀서 진행하세요.',
      href: 'master-planner/index.html',
      href_label: '다음 작업 보기',
      command: 'npm run wp:next',
    },
    drift: {
      label: '배포 준비 상태',
      current_value: driftStatus,
      summary: '지금 변경을 반영할 준비가 되었는지 보는 신호입니다.',
      detail: 'drifted면 현재 상태와 기대 상태 사이에 어긋남이 있어 먼저 원인을 확인해야 합니다.',
      help: '문제가 있으면 검사 명령부터 다시 돌리고 실패 원인을 해결하세요.',
      href: driftHref,
      href_label: '문제 해결 화면 열기',
      command: validationCommand,
    },
    autosend: {
      label: '자동 실행',
      current_value: '상태 확인 중',
      summary: '도구가 일정한 간격으로 자동 입력을 보내는 기능입니다.',
      detail: '켜져 있으면 반복 작업을 줄일 수 있지만, 의도하지 않은 입력이 없는지 함께 확인해야 합니다.',
      help: '필요하면 바로 켜거나 끌 수 있습니다.',
      href: '#automation-bridge',
      href_label: '자동 실행 연결 보기',
      extra_label: '자동 실행 켜기/끄기',
      extra_action: 'toggle-autosend',
    },
    branch: {
      label: '현재 브랜치',
      current_value: String(bootstrap?.git?.branch || 'unknown').trim(),
      summary: '지금 수정하고 있는 코드 브랜치입니다.',
      detail: '권장 브랜치와 다르면 잘못된 위치를 수정할 수 있어 먼저 확인하는 편이 안전합니다.',
      help: '브랜치가 의심되면 브랜치 준비 명령을 먼저 실행하세요.',
      href: summaryHref,
      href_label: '전체 상황 열기',
      command: branchCommand,
    },
    terminals: {
      label: '연결된 터미널',
      current_value: '상태 확인 중',
      summary: '지금 이 화면에서 명령을 보낼 수 있는 터미널 수입니다.',
      detail: '터미널이 있어야 아래의 바로 실행 버튼이 실제로 동작합니다.',
      help: '터미널이 없으면 자동 실행 연결 영역에서 먼저 세션을 선택하세요.',
      href: '#automation-bridge',
      href_label: '터미널 연결 열기',
      extra_label: '터미널 탭으로 이동',
      extra_action: 'open-terminal-tab',
    },
    scheduler: {
      label: '자동 스케줄',
      current_value: '상태 확인 중',
      summary: '자동 실행 스케줄이 실제로 돌고 있는지 보여줍니다.',
      detail: '중지됨이면 자동 입력이 멈춘 상태이고, 실행 중이면 정해진 주기로 입력을 보냅니다.',
      help: '터미널 연결 탭에서 상태를 보고 바로 조정할 수 있습니다.',
      href: '#automation-bridge',
      href_label: '자동 실행 연결 열기',
      extra_label: '터미널 탭으로 이동',
      extra_action: 'open-terminal-tab',
    },
    flags: {
      label: '켜진 기능 스위치',
      current_value: '상태 확인 중',
      summary: '지금 켜져 있는 기능 스위치 수입니다.',
      detail: '특정 기능이 왜 보이거나 안 보이는지 확인할 때 가장 먼저 보는 영역입니다.',
      help: '기능이 이상하게 보이면 기능 스위치부터 확인하세요.',
      href: 'flags/index.html',
      href_label: '기능 스위치 열기',
      extra_label: '새 창으로 보기',
      extra_action: 'open-flags',
    },
    env: {
      label: '환경값 덮어쓰기',
      current_value: '상태 확인 중',
      summary: '환경값으로 기본 설정을 덮어쓴 항목 수입니다.',
      detail: '환경값이 적용되면 화면이나 실행 결과가 예상과 다르게 보일 수 있습니다.',
      help: '설정이 이상하면 기능 스위치와 환경값 적용 여부를 같이 보세요.',
      href: 'flags/index.html',
      href_label: '기능 스위치 열기',
      extra_label: '새 창으로 보기',
      extra_action: 'open-flags',
    },
    'recent-action': {
      label: '최근 실행 기록',
      current_value: '기록 없음',
      summary: '마지막으로 어떤 명령이나 액션이 준비되었는지 보여줍니다.',
      detail: '최근 기록이 있으면 방금 무엇을 하려 했는지 빠르게 복기할 수 있습니다.',
      help: '기록이 없으면 전체 상황부터 다시 읽는 편이 빠릅니다.',
      href: summaryHref,
      href_label: '전체 상황 열기',
      command: 'npm run operator:cockpit',
    },
    handoff: {
      label: '다음 작업 준비 상태',
      current_value: nextWp,
      summary: '지금 작업이 끝난 뒤 다음 카드로 넘어갈 준비가 되었는지 보여줍니다.',
      detail: '검사 상태, 증거 상태, 다음 명령을 같이 보면 어디에서 막히는지 빠르게 찾을 수 있습니다.',
      help: '검사 상태가 막혀 있으면 다음 명령부터 실행해 확인하세요.',
      href: guardHref,
      href_label: '검사 보드 열기',
      command: validationCommand,
    },
    loop: {
      label: '최근 자동 실행 기록',
      current_value: recentAction,
      summary: '최근 자동 실행 흐름에서 어떤 상태였는지 보여줍니다.',
      detail: '실패한 흔적이 있으면 문제 해결 화면에서 원인부터 보는 것이 가장 빠릅니다.',
      help: '최근 기록이 비어 있으면 전체 상황과 터미널 연결부터 다시 확인하세요.',
      href: summaryHref,
      href_label: '전체 상황 열기',
      command: 'npm run operator:cockpit',
    },
  };
}

function buildHomeMasterPanelSection({ report, nextActions, bootstrap, operatorCockpit }) {
  const blueprints = buildHomeMasterPanelBlueprints({ report, nextActions, bootstrap, operatorCockpit });
  const initialKey = report?.promotion_pipeline?.drift_status && String(report.promotion_pipeline.drift_status).trim() !== 'clean'
    ? 'drift'
    : 'current-wp';
  const initialPanel = blueprints[initialKey] || blueprints['current-wp'];
  return {
    blueprints,
    initialKey,
    html: `
      <div class="master-quick-grid" aria-label="빠른 실행">
        <button type="button" class="master-quick-btn is-primary" data-master-key="drift" onclick="openHomeMasterPanel('drift', true)">
          <span>문제 먼저 보기</span>
          <strong>배포 준비 상태</strong>
        </button>
        <button type="button" class="master-quick-btn" data-master-key="current-wp" onclick="openHomeMasterPanel('current-wp', true)">
          <span>지금 작업 확인</span>
          <strong>${esc(report?.current_wp || bootstrap?.current_wp?.id || 'NONE')}</strong>
        </button>
        <button type="button" class="master-quick-btn" data-master-key="next-wp" onclick="openHomeMasterPanel('next-wp', true)">
          <span>다음 작업 확인</span>
          <strong>${esc(report?.next_wp || nextActions?.next_wp || 'NONE')}</strong>
        </button>
        <button type="button" class="master-quick-btn" data-master-key="terminals" onclick="openHomeMasterPanel('terminals', true)">
          <span>바로 실행 준비</span>
          <strong>터미널 연결</strong>
        </button>
      </div>
      <div class="side-list">
        <button type="button" class="side-item side-item-action" data-master-key="stage" onclick="openHomeMasterPanel('stage', false)"><span class="muted">현재 진행 단계</span><strong>${esc(report.requirements_stage || '—')}</strong><em>눌러서 설명 보기</em></button>
        <button type="button" class="side-item side-item-action" data-master-key="current-wp" onclick="openHomeMasterPanel('current-wp', false)"><span class="muted">지금 작업 카드</span><strong id="live-current-wp">${esc(report.current_wp || 'NONE')}</strong><em>눌러서 열기</em></button>
        <button type="button" class="side-item side-item-action" data-master-key="next-wp" onclick="openHomeMasterPanel('next-wp', false)"><span class="muted">다음 작업 카드</span><strong id="live-next-wp">${esc(report.next_wp || 'NONE')}</strong><em>다음 순서 확인</em></button>
        <button type="button" class="side-item side-item-action" data-master-key="drift" onclick="openHomeMasterPanel('drift', false)"><span class="muted">배포 준비 상태</span><strong id="live-drift-status">${esc(report.promotion_pipeline?.drift_status || '—')}</strong><em>문제 원인 보기</em></button>
        <button type="button" class="side-item side-item-action" data-master-key="autosend" onclick="openHomeMasterPanel('autosend', false)"><span class="muted">자동 실행</span><strong id="live-autosend-state">—</strong><em>바로 켜고 끄기</em></button>
        <button type="button" class="side-item side-item-action" data-master-key="branch" onclick="openHomeMasterPanel('branch', false)"><span class="muted">현재 브랜치</span><strong id="live-branch-status">—</strong><em>브랜치 점검</em></button>
        <button type="button" class="side-item side-item-action" data-master-key="terminals" onclick="openHomeMasterPanel('terminals', false)"><span class="muted">연결된 터미널</span><strong id="live-pty-sessions">—</strong><em>바로 실행 준비</em></button>
        <button type="button" class="side-item side-item-action" data-master-key="scheduler" onclick="openHomeMasterPanel('scheduler', false)"><span class="muted">자동 스케줄</span><strong id="live-pty-scheduler">—</strong><em>실행 상태 보기</em></button>
        <button type="button" class="side-item side-item-action" data-master-key="flags" onclick="openHomeMasterPanel('flags', false)"><span class="muted">켜진 기능 스위치</span><strong id="live-active-flags">—</strong><em>설정 열기</em></button>
        <button type="button" class="side-item side-item-action" data-master-key="env" onclick="openHomeMasterPanel('env', false)"><span class="muted">환경값 덮어쓰기</span><strong id="live-env-overrides" style="color:var(--accent-2)">—</strong><em>환경 영향 보기</em></button>
        <button type="button" class="side-item side-item-action" data-master-key="recent-action" onclick="openHomeMasterPanel('recent-action', false)"><span class="muted">최근 실행 기록</span><strong id="live-operator-action">—</strong><em>최근 흐름 보기</em></button>
      </div>
      <section class="hero-master-panel" id="hero-master-panel" aria-live="polite" data-master-selected-key="${esc(initialKey)}">
        <div class="hero-master-panel-head">
          <div>
            <h3>간단 실행 마스터 패널</h3>
            <p>위 카드를 누르면 쉬운 설명과 함께 관련 화면 열기, 명령 넣기, 바로 실행까지 한 번에 할 수 있습니다.</p>
          </div>
          <span class="hero-master-pill">선택 영역 <strong id="hero-master-label">${esc(initialPanel.label)}</strong></span>
        </div>
        <div class="hero-master-body">
          <div class="hero-master-copy">
            <span class="hero-master-kicker">이 영역은 무엇인가</span>
            <strong id="hero-master-title">${esc(initialPanel.label)}</strong>
            <p id="hero-master-summary">${esc(initialPanel.summary)}</p>
          </div>
          <div class="hero-master-current">
            <span>현재 값</span>
            <strong id="hero-master-current-value">${esc(initialPanel.current_value)}</strong>
          </div>
        </div>
        <div class="hero-master-guide-grid">
          <article class="hero-master-guide-card">
            <span>왜 중요하나</span>
            <strong id="hero-master-detail">${esc(initialPanel.detail)}</strong>
          </article>
          <article class="hero-master-guide-card">
            <span>어떻게 보면 되나</span>
            <strong id="hero-master-help">${esc(initialPanel.help)}</strong>
          </article>
        </div>
        <div class="hero-master-actions">
          <button type="button" class="hero-master-action primary" onclick="runHomeMasterPanelAction('open')">관련 화면 열기</button>
          <button type="button" class="hero-master-action secondary" id="hero-master-fill-btn" onclick="runHomeMasterPanelAction('fill')">명령 넣기</button>
          <button type="button" class="hero-master-action secondary" id="hero-master-run-btn" onclick="runHomeMasterPanelAction('run')">바로 실행</button>
          <button type="button" class="hero-master-action ghost" id="hero-master-extra-btn" onclick="runHomeMasterPanelAction('extra')">추가 기능</button>
        </div>
        <div class="hero-master-command-box" id="hero-master-command-box">
          <span>실행할 명령</span>
          <code id="hero-master-command">${esc(initialPanel.command || '없음')}</code>
        </div>
        <p class="hero-master-note" id="hero-master-note">관련 화면을 먼저 열어 보고, 필요하면 아래 명령을 바로 실행하세요.</p>
      </section>
    `,
  };
}

function buildHtml({ report, navSummary, currentState, wpQueue, nextActions, bootstrap, operatorCockpit,
                     sysHealth = null, sysFlags = null, sysCatalog = null, sysQg = null }) {
  const improvements = Array.isArray(report.essential_improvements) ? report.essential_improvements : [];
  const issues = Array.isArray(report.known_issues) ? report.known_issues : [];
  const capabilities = Array.isArray(currentState?.working_capabilities) ? currentState.working_capabilities : [];
  const stageSummary = Array.isArray(report.stage_summary) ? report.stage_summary : [];
  const heroMasterPanel = buildHomeMasterPanelSection({ report, nextActions, bootstrap, operatorCockpit });

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

  .master-quick-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 12px;
  }

  .master-quick-btn {
    appearance: none;
    border: 1px solid rgba(220, 207, 186, 0.78);
    background: rgba(255, 248, 238, 0.95);
    border-radius: 16px;
    padding: 14px;
    text-align: left;
    cursor: pointer;
    display: grid;
    gap: 6px;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }

  .master-quick-btn span {
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .master-quick-btn strong {
    font-size: 15px;
    letter-spacing: -0.02em;
  }

  .master-quick-btn.is-primary {
    background: linear-gradient(135deg, rgba(15,118,110,0.14), rgba(29,78,216,0.10));
    border-color: rgba(15,118,110,0.26);
  }

  .master-quick-btn:hover,
  .side-item-action:hover,
  .hero-master-inline-btn:hover,
  .clickable-summary-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 10px 18px rgba(15, 118, 110, 0.12);
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

  .side-item-action {
    width: 100%;
    appearance: none;
    cursor: pointer;
    align-items: center;
    text-align: left;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto auto;
    background: rgba(255, 248, 238, 0.95);
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }

  .side-item-action span {
    grid-column: 1;
    grid-row: 1;
  }

  .side-item-action strong {
    grid-column: 1;
    grid-row: 2;
  }

  .side-item-action em {
    grid-column: 2;
    grid-row: 1 / span 2;
    justify-self: end;
    color: var(--accent);
    font-style: normal;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }

  .side-item-action.is-active {
    border-color: rgba(15,118,110,0.36);
    background: linear-gradient(135deg, rgba(15,118,110,0.10), rgba(29,78,216,0.06));
  }

  .hero-master-panel {
    margin-top: 14px;
    padding: 16px;
    border-radius: var(--radius-lg);
    background: linear-gradient(135deg, rgba(15,118,110,0.08), rgba(29,78,216,0.05));
    border: 1px solid rgba(15,118,110,0.2);
    display: grid;
    gap: 12px;
  }

  .hero-master-panel-head,
  .hero-master-body {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: flex-start;
  }

  .hero-master-panel-head h3 {
    margin: 0;
    font-size: 17px;
    letter-spacing: -0.02em;
  }

  .hero-master-panel-head p,
  .hero-master-copy p,
  .hero-master-note {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.6;
  }

  .hero-master-pill {
    display: inline-flex;
    align-items: center;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(255,255,255,0.76);
    border: 1px solid rgba(220,207,186,0.84);
    color: var(--muted);
    font-size: 12px;
  }

  .hero-master-pill strong {
    margin-left: 6px;
    color: var(--accent);
  }

  .hero-master-copy {
    display: grid;
    gap: 6px;
  }

  .hero-master-kicker {
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .hero-master-copy strong {
    font-size: 18px;
    letter-spacing: -0.03em;
  }

  .hero-master-current {
    min-width: 180px;
    padding: 12px;
    border-radius: 14px;
    background: rgba(255,255,255,0.76);
    border: 1px solid rgba(220,207,186,0.82);
    display: grid;
    gap: 6px;
  }

  .hero-master-current span,
  .hero-master-guide-card span,
  .hero-master-command-box span {
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .hero-master-current strong,
  .hero-master-guide-card strong {
    font-size: 13px;
    line-height: 1.55;
  }

  .hero-master-guide-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .hero-master-guide-card {
    padding: 12px;
    border-radius: 14px;
    background: rgba(255,255,255,0.76);
    border: 1px solid rgba(220,207,186,0.82);
    display: grid;
    gap: 6px;
  }

  .hero-master-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .hero-master-action,
  .hero-master-inline-btn {
    appearance: none;
    border: none;
    cursor: pointer;
    border-radius: 12px;
    padding: 10px 12px;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }

  .hero-master-action.primary {
    background: linear-gradient(135deg, #0f766e, #1d4ed8);
    color: white;
  }

  .hero-master-action.secondary {
    background: white;
    color: var(--text);
    border: 1px solid rgba(220,207,186,0.88);
  }

  .hero-master-action.ghost,
  .hero-master-inline-btn {
    background: rgba(255,255,255,0.72);
    color: var(--accent);
    border: 1px dashed rgba(15,118,110,0.28);
  }

  .hero-master-action:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .hero-master-command-box {
    padding: 12px;
    border-radius: 14px;
    background: rgba(255,255,255,0.76);
    border: 1px solid rgba(220,207,186,0.82);
    display: grid;
    gap: 8px;
  }

  .hero-master-command-box code {
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .hero-master-inline-btn {
    width: 100%;
    margin-top: 10px;
  }

  .clickable-summary-card {
    margin-top: 12px;
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }

  .handoff-lane {
    margin-top: 14px;
    padding: 14px;
    border-radius: var(--radius-lg);
    background: rgba(255,255,255,0.78);
    border: 1px solid rgba(15,118,110,0.24);
  }

  .handoff-lane-head,
  .handoff-next-command {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
  }

  .handoff-lane-head span,
  .handoff-next-command span,
  .handoff-lane-grid span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
  }

  .handoff-lane-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-top: 10px;
  }

  .handoff-lane-grid div {
    min-width: 0;
    padding: 10px;
    border-radius: var(--radius-md);
    background: rgba(255, 248, 238, 0.88);
    border: 1px solid rgba(220, 207, 186, 0.68);
  }

  .handoff-lane-grid strong,
  .handoff-next-command code {
    display: block;
    margin-top: 4px;
    overflow-wrap: anywhere;
    line-height: 1.35;
  }

  .handoff-next-command {
    margin-top: 10px;
    padding: 10px;
    border-radius: var(--radius-md);
    background: rgba(15,118,110,0.07);
    border: 1px solid rgba(15,118,110,0.18);
  }

  .handoff-next-command code {
    text-align: right;
  }

  .handoff-lane p {
    margin: 10px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted);
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

    .master-quick-grid,
    .hero-master-guide-grid {
      grid-template-columns: 1fr;
    }

    .hero-master-panel-head,
    .hero-master-body {
      flex-direction: column;
    }

    .hero-master-current {
      min-width: 0;
      width: 100%;
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
          <span>처음 보는 사람도 지금 상태와 다음 행동을 바로 이해하는 시작 화면</span>
        </div>
      </div>
      <button class="chip-link" aria-controls="home-stat-detail" style="cursor:pointer;border:none;background:rgba(15,118,110,0.08);border:1px solid rgba(15,118,110,0.3);border-radius:999px;padding:6px 12px;font-size:12px;color:#0f766e;" onclick="document.getElementById('home-stat-detail').scrollIntoView({behavior:'smooth'})">핵심 상태 요약 보기</button>
      <span id="live-autosend-badge" style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;background:rgba(220,207,186,0.4);color:#61707f;border:1px solid rgba(220,207,186,0.6);">상태 로딩...</span>
      <button id="btn-autosend-toggle" style="display:none;padding:4px 10px;border-radius:999px;font-size:11px;background:transparent;border:1px solid rgba(15,118,110,0.4);color:#0f766e;cursor:pointer;margin-left:4px;" aria-label="자동 전송 ON/OFF 전환">전환</button>
      <nav aria-label="주요 운영 화면">
      <div class="top-actions">
        <a class="chip-link" href="master-planner/index.html">계획 화면</a>
        <a class="chip-link" href="catalog-site/index.html">기능 목록</a>
        <a class="chip-link" href="study-guide/index.html">학습 자료</a>
        <a class="chip-link" href="flags/index.html">기능 스위치</a>
        <a class="chip-link" href="audit/index.html">기록 보기</a>
        <a class="chip-link" href="quality/index.html">품질 결과</a>
        <a class="chip-link" href="lifecycle/index.html">진행 단계</a>
        <a class="chip-link" href="#automation-bridge" style="background:linear-gradient(135deg,rgba(15,118,110,0.12),rgba(29,78,216,0.10));border-color:rgba(15,118,110,0.35);color:#0f766e;font-weight:700;" onclick="document.getElementById('automation-bridge').scrollIntoView({behavior:'smooth'});return false;">⚡ 자동 실행 연결</a>
      </div>
      </nav>
    </header>

    <section class="hero" id="main-content">
      <div>
        <div class="eyebrow">처음 볼 때 가장 먼저 여는 화면</div>
        <h1>지금 무슨 일이 진행 중인지,<br>다음에 무엇을 해야 하는지 바로 보입니다.</h1>
        <p>
          이 화면은 여러 운영 도구를 한곳에 모아 둔 시작점입니다.
          어려운 내부 용어보다 먼저, 지금 작업 상태와 다음 행동을 쉽게 읽을 수 있도록 정리했습니다.
        </p>
        <div class="loop-list" style="margin-top:18px">
          <div class="loop-row"><span class="muted">1. 지금 상태</span><strong>오른쪽 요약 카드에서 확인</strong></div>
          <div class="loop-row"><span class="muted">2. 지금 할 일</span><strong>아래 안내 바 카드 클릭</strong></div>
          <div class="loop-row"><span class="muted">3. 더 자세히 보기</span><strong>필요한 화면으로 바로 이동</strong></div>
        </div>
        <div class="hero-actions">
          <a class="cta cta-primary" href="master-planner/index.html">계획 화면 열기</a>
          <a class="cta cta-secondary" href="catalog-site/index.html">기능 목록 보기</a>
          <a class="cta cta-secondary" href="study-guide/index.html">초보자 안내 보기</a>
        </div>
      </div>
      <aside class="hero-side">
        <h2>핵심 상태 요약</h2>
        ${heroMasterPanel.html}
        <div class="clickable-summary-card" onclick="openHomeMasterPanel('handoff', false)" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openHomeMasterPanel('handoff', false);}">
          ${buildHandoffLane({ report, nextActions, bootstrap, operatorCockpit })}
        </div>
        <div class="loop-card">
          <h3>최근 자동 실행 기록</h3>
        <div class="loop-list">
          <div class="loop-row"><span class="muted">최근 상태</span><strong id="live-loop-status">—</strong></div>
          <div class="loop-row"><span class="muted">권장 브랜치</span><strong id="live-loop-branch">—</strong></div>
          <div class="loop-row"><span class="muted">다음 안전 점검</span><strong id="live-loop-next">—</strong></div>
        </div>
        <div class="loop-actions">
            <a id="live-loop-primary-link" class="page-link" href="mindmap/index.html?focus=execution-failure&reason=%EC%B5%9C%EA%B7%BC%20operator%20action%20%EC%8B%A4%ED%8C%A8&command=npm%20run%20operator%3Acockpit&source=home-loop#execution-console">문제 해결 화면 열기</a>
            <a id="live-loop-secondary-link" class="page-link" href="mindmap/index.html?focus=guard&reason=%EC%BB%A4%EB%B0%8B%20%EA%B0%80%EB%93%9C%20%ED%99%95%EC%9D%B8%20%ED%95%84%EC%9A%94&command=npm%20run%20commit%3Aguard&source=home-loop#plan-board">검사 보드 열기</a>
            <a id="live-loop-summary-link" class="page-link" href="mindmap/index.html?focus=operator-summary&reason=operator%20%EC%83%81%ED%83%9C%20%EC%A0%84%EC%B2%B4%20%ED%99%95%EC%9D%B8&command=npm%20run%20operator%3Acockpit&source=home-loop#master-status" style="display:none">전체 상황 열기</a>
        </div>
        <button type="button" class="hero-master-inline-btn" onclick="openHomeMasterPanel('loop', false)">이 영역 설명과 실행 보기</button>
      </div>
    </aside>
    </section>
    <script>
      window.__HOME_MASTER_PANEL_BLUEPRINTS__ = ${serializeForInlineScript(heroMasterPanel.blueprints)};
    </script>

    <section class="stats" id="home-stat-detail">
      <article class="stat-card">
        <div class="stat-label">전체 건강 점수</div>
        <div class="stat-value">${esc(currentState?.health_metrics?.last_known?.health_rating || '—')}</div>
        <div class="stat-note">품질 문 통과율 ${esc(currentState?.health_metrics?.last_known?.gate_pass_rate_pct || '—')}%</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">사용 가능한 기능 수</div>
        <div class="stat-value">${capabilities.length}</div>
        <div class="stat-note">현재 상태 기준으로 바로 쓸 수 있는 기능 수</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">잠금된 작업 수</div>
        <div class="stat-value">${esc(report.promotion_pipeline?.locked_tokens || 0)}</div>
        <div class="stat-note">동시에 바꾸지 않도록 묶어 둔 작업 수</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">아직 남은 이슈</div>
        <div class="stat-value">${issues.length}</div>
        <div class="stat-note">아직 해결되지 않은 문제 개수</div>
      </article>
    </section>

    ${buildFlowStatusSection({ report, currentState, nextActions, bootstrap, operatorCockpit })}

    ${buildKanbanSection(wpQueue)}

    <div class="section-head">
      <div>
        <h2>자주 여는 화면</h2>
        <p>지금 필요한 목적에 맞춰 바로 들어갈 수 있습니다.</p>
      </div>
    </div>
    <section class="page-grid">
      <article class="page-card">
        <h3>문제 해결 제어 센터</h3>
        <p>실행 상태, 실패 원인, 롤백, 기능 스위치를 한곳에서 보면서 직접 조작하는 화면입니다.</p>
        <a class="page-link" href="mindmap/index.html">이 화면 열기</a>
      </article>
      <article class="page-card">
        <h3>계획 화면</h3>
        <p>작업 카드, 단계, 계획 흐름을 한눈에 보고 다음 우선순위를 정하는 화면입니다.</p>
        <a class="page-link" href="master-planner/index.html">이 화면 열기</a>
      </article>
      <article class="page-card">
        <h3>기능 목록 화면</h3>
        <p>각 기능의 담당자, 연결 경로, 켜고 끄는 스위치를 빠르게 확인하는 화면입니다.</p>
        <a class="page-link" href="catalog-site/index.html">이 화면 열기</a>
      </article>
      <article class="page-card">
        <h3>초보자 안내 화면</h3>
        <p>처음 합류한 사람이 구조와 용어를 이해할 수 있도록 정리한 설명 화면입니다.</p>
        <a class="page-link" href="study-guide/index.html">이 화면 열기</a>
      </article>
    </section>

    <div class="section-head">
      <div>
        <h2>지금 상태 한눈에 보기</h2>
        <p>현재 단계와 개선이 필요한 곳을 빠르게 파악할 수 있습니다.</p>
      </div>
    </div>
    <section class="content-grid">
      <div class="panel">
        <h3>단계별 진행 상태</h3>
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
        <h3>우선 확인할 개선 항목</h3>
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
        <h2>메뉴와 연결 구조</h2>
        <p>어떤 메뉴가 어디로 연결되는지 쉽게 찾을 수 있게 정리했습니다.</p>
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
        <h2>자주 쓰는 명령</h2>
        <p>화면과 상태를 다시 맞출 때 가장 자주 쓰는 명령만 모았습니다.</p>
      </div>
    </div>
    <section class="panel">
      <div class="cmd-list">
        <div class="cmd-item">
          <strong>화면 전체 다시 만들기</strong>
          <code>npm run ui:build</code>
        </div>
        <div class="cmd-item">
          <strong>현재 상태 다시 확인</strong>
          <code>npm run project:status</code>
        </div>
        <div class="cmd-item">
          <strong>다음 작업 카드 찾기</strong>
          <code>npm run wp:next</code>
        </div>
      </div>
    </section>

    <p class="foot" style="font-size:12px;color:#61707f;margin-top:8px;">같은 자동화 요청을 다시 저장해도 중복으로 처리되지 않도록 안전장치가 들어 있습니다.</p>
    <p class="foot">이 화면은 <code>memory/current-state.yaml</code>, <code>memory/current-wp.yaml</code>, <code>master-shell/navigation/nav.yaml</code>, <code>master-shell/plugin-registry/registry.yaml</code>를 바탕으로 만들어집니다.</p>

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
var HOME_INITIAL_OPERATOR_CHAIN = Array.isArray(window.__HOME_INITIAL_OPERATOR_CHAIN__)
  ? window.__HOME_INITIAL_OPERATOR_CHAIN__
  : [];
var HOME_OPERATOR_CHAIN_BLUEPRINTS = window.__HOME_OPERATOR_CHAIN_BLUEPRINTS__ || {};
var HOME_MASTER_PANEL_BLUEPRINTS = window.__HOME_MASTER_PANEL_BLUEPRINTS__ || {};
var latestHomeOperatorCockpit = {
  operatorChain: HOME_INITIAL_OPERATOR_CHAIN,
};
var latestHomeAutomationConfig = {
  enabled: false,
};
function homeEscHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function homeStatusClass(value) {
  var normalized = String(value || '').toLowerCase();
  if (['pass', 'ready', 'active', 'clean', 'true', 'completed'].includes(normalized)) {
    return 'tone-green';
  }
  if (['blocked', 'fail', 'error'].includes(normalized)) {
    return 'tone-amber';
  }
  return 'tone-slate';
}
function homeText(id, fallback) {
  var element = document.getElementById(id);
  var value = element ? String(element.textContent || '').trim() : '';
  return value || String(fallback || '').trim();
}
function scrollToAutomationBridge() {
  var section = document.getElementById('automation-bridge');
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
function switchAutomationBridgeTab(tabId) {
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.ab-tab'));
  var target = tabs.find(function(button) {
    return String(button.getAttribute('onclick') || '').indexOf("'" + tabId + "'") >= 0;
  });
  if (target) {
    target.click();
  }
}
function currentHomeMasterPanelKey() {
  var panel = document.getElementById('hero-master-panel');
  return panel ? String(panel.dataset.masterSelectedKey || '').trim() : '';
}
function homeMasterPanelBlueprint(key) {
  return HOME_MASTER_PANEL_BLUEPRINTS[String(key || '').trim()] || null;
}
function homeMasterPanelCurrentValue(key, fallback) {
  if (key === 'stage') {
    var stageStrong = document.querySelector('.side-item-action[data-master-key="stage"] strong');
    return String(stageStrong && stageStrong.textContent || fallback || '').trim();
  }
  if (key === 'current-wp') return homeText('live-current-wp', fallback);
  if (key === 'next-wp') return homeText('live-next-wp', fallback);
  if (key === 'drift') return homeText('live-drift-status', fallback);
  if (key === 'autosend') return homeText('live-autosend-state', latestHomeAutomationConfig.enabled ? 'ON' : 'OFF');
  if (key === 'branch') return homeText('live-branch-status', fallback);
  if (key === 'terminals') return homeText('live-pty-sessions', fallback);
  if (key === 'scheduler') return homeText('live-pty-scheduler', fallback);
  if (key === 'flags') return homeText('live-active-flags', fallback);
  if (key === 'env') return homeText('live-env-overrides', fallback);
  if (key === 'recent-action') return homeText('live-operator-action', fallback);
  if (key === 'handoff') return homeText('handoff-next-wp', fallback);
  if (key === 'loop') return homeText('live-loop-status', fallback);
  return String(fallback || '').trim();
}
function homeMasterPanelConfig(key) {
  var blueprint = homeMasterPanelBlueprint(key);
  if (!blueprint) {
    return null;
  }
  return {
    key: key,
    label: String(blueprint.label || key || '영역'),
    current_value: homeMasterPanelCurrentValue(key, blueprint.current_value || ''),
    summary: String(blueprint.summary || '').trim(),
    detail: String(blueprint.detail || '').trim(),
    help: String(blueprint.help || '').trim(),
    href: String(blueprint.href || '').trim(),
    href_label: String(blueprint.href_label || '관련 화면 열기').trim(),
    command: String(blueprint.command || '').trim(),
    extra_label: String(blueprint.extra_label || '').trim(),
    extra_action: String(blueprint.extra_action || '').trim(),
  };
}
function refreshHomeMasterPanelUi(config) {
  if (!config) {
    return;
  }
  var panel = document.getElementById('hero-master-panel');
  if (panel) {
    panel.dataset.masterSelectedKey = config.key;
  }
  var labelEl = document.getElementById('hero-master-label');
  var titleEl = document.getElementById('hero-master-title');
  var summaryEl = document.getElementById('hero-master-summary');
  var currentEl = document.getElementById('hero-master-current-value');
  var detailEl = document.getElementById('hero-master-detail');
  var helpEl = document.getElementById('hero-master-help');
  var noteEl = document.getElementById('hero-master-note');
  var commandEl = document.getElementById('hero-master-command');
  var commandBoxEl = document.getElementById('hero-master-command-box');
  var fillBtn = document.getElementById('hero-master-fill-btn');
  var runBtn = document.getElementById('hero-master-run-btn');
  var extraBtn = document.getElementById('hero-master-extra-btn');
  if (labelEl) labelEl.textContent = config.label;
  if (titleEl) titleEl.textContent = config.label;
  if (summaryEl) summaryEl.textContent = config.summary;
  if (currentEl) currentEl.textContent = config.current_value || '없음';
  if (detailEl) detailEl.textContent = config.detail;
  if (helpEl) helpEl.textContent = config.help;
  if (noteEl) {
    noteEl.textContent = config.command
      ? '관련 화면을 먼저 열어 보고, 필요하면 아래 명령을 바로 실행하세요.'
      : '이 영역은 관련 화면을 열거나 추가 기능 버튼으로 바로 이동할 수 있습니다.';
  }
  if (commandEl) commandEl.textContent = config.command || '없음';
  if (commandBoxEl) commandBoxEl.style.display = config.command ? '' : 'none';
  if (fillBtn) fillBtn.disabled = !config.command;
  if (runBtn) runBtn.disabled = !config.command;
  if (extraBtn) {
    extraBtn.disabled = !config.extra_action;
    extraBtn.textContent = config.extra_label || '추가 기능';
    extraBtn.style.display = config.extra_action ? '' : 'none';
  }
  document.querySelectorAll('.side-item-action[data-master-key], .master-quick-btn[data-master-key]').forEach(function(button) {
    button.classList.toggle('is-active', String(button.dataset.masterKey || '') === config.key);
  });
}
window.openHomeMasterPanel = function(key, shouldScroll) {
  var config = homeMasterPanelConfig(key);
  if (!config) {
    return;
  }
  refreshHomeMasterPanelUi(config);
  if (shouldScroll) {
    var panel = document.getElementById('hero-master-panel');
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
};
window.runHomeMasterPanelAction = function(kind) {
  var key = currentHomeMasterPanelKey();
  var config = homeMasterPanelConfig(key);
  if (!config) {
    return;
  }
  if (kind === 'open') {
    if (!config.href) {
      return;
    }
    if (config.href.charAt(0) === '#') {
      var target = document.querySelector(config.href);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    window.location.href = config.href;
    return;
  }
  if (kind === 'fill') {
    if (!config.command) {
      return;
    }
    scrollToAutomationBridge();
    switchAutomationBridgeTab('terminal');
    if (typeof window.abFillCmd === 'function') {
      window.abFillCmd(config.command);
    }
    return;
  }
  if (kind === 'run') {
    if (!config.command) {
      return;
    }
    scrollToAutomationBridge();
    switchAutomationBridgeTab('terminal');
    if (typeof window.abSendCmd2 === 'function') {
      window.abSendCmd2(config.command);
    }
    return;
  }
  if (kind === 'extra') {
    if (config.extra_action === 'toggle-autosend') {
      var toggle = document.getElementById('btn-autosend-toggle');
      if (toggle) toggle.click();
      return;
    }
    if (config.extra_action === 'open-terminal-tab') {
      scrollToAutomationBridge();
      switchAutomationBridgeTab('terminal');
      return;
    }
    if (config.extra_action === 'open-flags') {
      window.open('/flags', '_blank');
    }
  }
};
function refreshSelectedHomeMasterPanel() {
  var selectedKey = currentHomeMasterPanelKey() || 'drift';
  window.openHomeMasterPanel(selectedKey, false);
}
function homeOperatorChainItems() {
  if (latestHomeOperatorCockpit) {
    if (Array.isArray(latestHomeOperatorCockpit.operatorChain)) {
      return latestHomeOperatorCockpit.operatorChain;
    }
    if (Array.isArray(latestHomeOperatorCockpit.operator_chain)) {
      return latestHomeOperatorCockpit.operator_chain;
    }
  }
  return HOME_INITIAL_OPERATOR_CHAIN;
}
function homeOperatorChainBlueprint(itemId) {
  if (!itemId) {
    return null;
  }
  return HOME_OPERATOR_CHAIN_BLUEPRINTS[String(itemId)] || null;
}
function homeOperatorChainMapHtml(item) {
  if (!item || typeof item !== 'object') {
    return '<section class="flow-map-panel" id="flow-chain-map-panel" aria-live="polite">' +
      '<div class="flow-map-empty">operator chain을 선택하면 상세 설명과 수정 맵이 여기에 표시됩니다.</div>' +
    '</section>';
  }
  var blueprint = homeOperatorChainBlueprint(item.id) || {
    owner: 'Operator',
    summary: '현재 operator chain 단계 설명이 아직 정의되지 않았습니다.',
    why: 'reason 값을 기준으로 control center에서 우선 확인하세요.',
    references: ['추가 기준 없음'],
    mapSteps: [
      { title: '시작 지점', detail: String(item.reason || 'reason 없음') },
      { title: '수정 포인트', detail: 'control center에서 현재 단계와 연결된 화면을 먼저 확인합니다.' },
      { title: '검증 루프', detail: String(item.command || '명령 없음') },
    ],
  };
  var mapSteps = Array.isArray(blueprint.mapSteps) ? blueprint.mapSteps : [];
  var references = Array.isArray(blueprint.references) ? blueprint.references.filter(Boolean) : [];
  return '<section class="flow-map-panel" id="flow-chain-map-panel" aria-live="polite" data-selected-chain-id="' + homeEscHtml(item.id || 'step') + '">' +
    '<div class="flow-map-head">' +
      '<div>' +
        '<h3>상세 설명 + 수정 맵</h3>' +
        '<p>오퍼레이터 바 카드를 클릭하면 어디서 확인하고 어디부터 고칠지 맵 형식으로 바로 안내합니다.</p>' +
      '</div>' +
      '<div class="flow-pill">선택 단계 <strong id="flow-map-selected-label">' + homeEscHtml(item.label || item.id || 'step') + '</strong></div>' +
    '</div>' +
    '<div class="flow-map-hero">' +
      '<div class="flow-map-copy">' +
        '<span class="flow-kicker">무슨 단계인가</span>' +
        '<strong id="flow-map-title">' + homeEscHtml(item.label || item.id || 'step') + '</strong>' +
        '<p id="flow-map-summary">' + homeEscHtml(blueprint.summary || '설명 없음') + '</p>' +
      '</div>' +
      '<div class="flow-map-status">' +
        '<span class="tag ' + homeStatusClass(String(item.status || 'pending')) + '" id="flow-map-status">' + homeEscHtml(item.status || 'pending') + '</span>' +
        '<code id="flow-map-command">' + homeEscHtml(item.command || '명령 없음') + '</code>' +
      '</div>' +
    '</div>' +
    '<div class="flow-map-summary-grid">' +
      '<article class="flow-map-summary-card">' +
        '<span>왜 지금 필요한가</span>' +
        '<strong id="flow-map-why">' + homeEscHtml(blueprint.why || '설명 없음') + '</strong>' +
      '</article>' +
      '<article class="flow-map-summary-card">' +
        '<span>현재 시그널</span>' +
        '<strong id="flow-map-reason">' + homeEscHtml(item.reason || 'reason 없음') + '</strong>' +
      '</article>' +
      '<article class="flow-map-summary-card">' +
        '<span>담당 레인</span>' +
        '<strong id="flow-map-owner">' + homeEscHtml(blueprint.owner || 'Operator') + '</strong>' +
      '</article>' +
    '</div>' +
    '<div class="flow-map-route">' +
      mapSteps.map(function(step, index) {
        var href = String(step && step.href || '').trim();
        var hrefLabel = String(step && step.hrefLabel || '').trim();
        return '<article class="flow-map-step">' +
          '<div class="flow-map-step-index">' + String(index + 1) + '</div>' +
          '<div class="flow-map-step-copy">' +
            '<span>' + homeEscHtml(step && step.title || ('단계 ' + String(index + 1))) + '</span>' +
            '<strong>' + homeEscHtml(step && step.detail || '') + '</strong>' +
            (href && hrefLabel ? '<a class="flow-chain-link" href="' + homeEscHtml(href) + '">' + homeEscHtml(hrefLabel) + '</a>' : '') +
          '</div>' +
        '</article>';
      }).join('') +
    '</div>' +
    '<div class="flow-map-references">' +
      '<span>바로 볼 기준</span>' +
      '<div class="flow-map-reference-list">' +
        references.map(function(reference) {
          return '<code>' + homeEscHtml(reference) + '</code>';
        }).join('') +
      '</div>' +
    '</div>' +
  '</section>';
}
function updateHomeOperatorChainMap(item) {
  var panel = document.getElementById('flow-chain-map-panel');
  if (!panel) {
    return;
  }
  panel.outerHTML = homeOperatorChainMapHtml(item);
}
function focusHomeOperatorChainDetails(itemId, shouldScroll) {
  var chain = homeOperatorChainItems();
  var selectedItem = chain.find(function(entry) {
    return String(entry && entry.id || '').trim() === String(itemId || '').trim();
  });
  if (!selectedItem) {
    return;
  }
  updateHomeOperatorChainSpotlight(selectedItem);
  if (shouldScroll) {
    var panel = document.getElementById('flow-chain-map-panel');
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}
function bindHomeOperatorChainInteractions() {
  var selectors = ['#flow-chain-spotlight[data-chain-id]', '.flow-chain-item[data-chain-id]'];
  document.querySelectorAll(selectors.join(',')).forEach(function(element) {
    if (element.dataset.homeChainBound === 'true') {
      return;
    }
    element.dataset.homeChainBound = 'true';
    element.addEventListener('click', function(event) {
      if (event.target && typeof event.target.closest === 'function' && event.target.closest('a,button')) {
        return;
      }
      focusHomeOperatorChainDetails(element.dataset.chainId || '', true);
    });
    element.addEventListener('keydown', function(event) {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      focusHomeOperatorChainDetails(element.dataset.chainId || '', true);
    });
  });
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
  updateHomeOperatorChainMap(item);
  if (!spotlight || !titleEl || !reasonEl || !statusEl || !commandEl || !copyBtn || !fillEl || !linkEl || !item) {
    return;
  }
  var itemId = String(item.id || '').trim();
  var targetId = itemId === 'verify' || itemId === 'commit-guard' ? 'plan-board' : 'master-status';
  var focus = itemId === 'verify' || itemId === 'commit-guard' ? 'guard' : 'operator-summary';
  spotlight.dataset.chainId = itemId || '';
  titleEl.textContent = String(item.label || item.id || 'step');
  reasonEl.textContent = String(item.reason || '다음 단계 설명이 없습니다.');
  statusEl.textContent = String(item.status || 'pending');
  statusEl.className = 'tag ' + homeStatusClass(String(item.status || 'pending'));
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
  latestHomeAutomationConfig = autoSend && typeof autoSend === 'object'
    ? autoSend
    : { enabled: false };
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
  refreshSelectedHomeMasterPanel();
}
document.addEventListener('DOMContentLoaded', async () => {
  bindHomeOperatorChainInteractions();
  openHomeMasterPanel('drift', false);
  var initialChainId = document.getElementById('flow-chain-spotlight')
    ? document.getElementById('flow-chain-spotlight').dataset.chainId
    : '';
  var initialItem = homeOperatorChainItems().find(function(entry) {
    return String(entry && entry.id || '').trim() === String(initialChainId || '').trim();
  }) || HOME_INITIAL_OPERATOR_CHAIN[0] || null;
  updateHomeOperatorChainMap(initialItem);
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
  latestHomeOperatorCockpit = operatorCockpit || latestHomeOperatorCockpit;
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
  bindHomeOperatorChainInteractions();
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
      ? String(latestHomeRecentAction.delivery_message || latestHomeRecentAction.label || '최근 실행이 실패했습니다.').trim()
      : String(
        operatorCockpit && operatorCockpit.commit_guard
          ? operatorCockpit.commit_guard.next_action || '최근 자동 실행 상태 확인'
          : '최근 자동 실행 상태 확인'
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
    recentLoopPrimaryLinkEl.textContent = failedAction ? '문제 해결 화면 열기' : '전체 상황 열기';
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
        : '실행 화면에서 다음 작업 명령을 준비하세요.'
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
    recentLoopSecondaryLinkEl.textContent = guardBlocked ? '검사 보드 열기' : '실행 화면 열기';
  }
  refreshSelectedHomeMasterPanel();
});
</script>
${buildMpoPanel()}
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

  const PAGE_SIZE = 5;

  const laneHtml = KANBAN_LANES.map((lane) => {
    const cards = laneMap[lane.id];
    const laneId = `kb-lane-${lane.id}`;

    let bodyContent;
    if (cards.length === 0) {
      bodyContent = `<div class="kb-empty">없음</div>`;
    } else {
      // Split cards into pages
      const pages = [];
      for (let i = 0; i < cards.length; i += PAGE_SIZE) {
        pages.push(cards.slice(i, i + PAGE_SIZE));
      }
      const pagesHtml = pages.map((pageCards, pageIdx) => `
        <div class="kb-page" data-page="${pageIdx}" style="${pageIdx === 0 ? '' : 'display:none'}">
          ${pageCards.map((wp) => `
          <div class="kb-card">
            <div class="kb-card-head">
              <span class="kb-id">${esc(wp.id || '—')}</span>
              ${tierBadge(wp)}
            </div>
            <div class="kb-goal">${esc(wp.goal || wp.name || '—')}</div>
            <div class="kb-stages">${stageBadges(wp)}</div>
          </div>`).join('')}
        </div>`).join('');

      const navHtml = pages.length > 1 ? `
        <div class="kb-page-nav">
          <button class="kb-nav-btn" onclick="kbPrevPage(this)" disabled aria-label="이전">‹</button>
          <span class="kb-page-ind">1 / ${pages.length}</span>
          <button class="kb-nav-btn" onclick="kbNextPage(this)" ${pages.length === 1 ? 'disabled' : ''} aria-label="다음">›</button>
        </div>` : '';

      bodyContent = `<div class="kb-cards">${pagesHtml}${navHtml}</div>`;
    }

    return `
      <div class="kb-lane" id="${laneId}">
        <div class="kb-lane-head" style="border-top:3px solid ${lane.color}">
          <span class="kb-lane-label">${lane.label}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="kb-lane-count">${cards.length}</span>
            <button class="kb-lane-toggle" onclick="kbToggleLane('${laneId}',this)" title="접기 / 펼치기" aria-expanded="true">▾</button>
          </div>
        </div>
        <div class="kb-lane-body" id="${laneId}-body">${bodyContent}</div>
      </div>`;
  }).join('');

  // Spiral model
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

  // Summary pill bar (always visible even when section collapsed)
  const summaryPills = KANBAN_LANES.map((lane) => {
    const count = laneMap[lane.id].length;
    return `<span class="kb-sum-pill" style="border-color:${lane.color}44;color:${lane.color};background:${lane.color}11;">${lane.label} <strong>${count}</strong></span>`;
  }).join('');

  return `
    <div class="section-head kb-section-head" style="margin-top:40px" id="kb-section-header">
      <div>
        <h2>작업 진행판</h2>
        <p>레인별 WP 카드 · A→E 배지는 나선형 반복 주기를 나타냅니다.</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <div class="spiral-iteration">반복 <strong>#${iteration}</strong> / ${totalCaps}개 기능</div>
        <button class="kb-section-toggle" id="kb-section-toggle-btn" onclick="kbToggleSection()" title="섹션 접기 / 펼치기" aria-expanded="true">▾ 접기</button>
      </div>
    </div>

    <div class="kb-summary-bar">${summaryPills}</div>

    <div id="kb-section-body">
      <div class="spiral-row">${spiralHtml}</div>
      <section class="kb-board" aria-label="칸반 보드">
        ${laneHtml}
      </section>
    </div>

    <script>
    (function() {
      function kbToggleSection() {
        var body = document.getElementById('kb-section-body');
        var btn = document.getElementById('kb-section-toggle-btn');
        if (!body || !btn) return;
        var collapsed = body.style.display === 'none';
        body.style.display = collapsed ? '' : 'none';
        btn.textContent = collapsed ? '▾ 접기' : '▸ 펼치기';
        btn.setAttribute('aria-expanded', String(collapsed));
      }
      window.kbToggleSection = kbToggleSection;

      function kbToggleLane(laneId, btn) {
        var bodyEl = document.getElementById(laneId + '-body');
        if (!bodyEl) return;
        var collapsed = bodyEl.style.display === 'none';
        bodyEl.style.display = collapsed ? '' : 'none';
        btn.textContent = collapsed ? '▾' : '▸';
        btn.setAttribute('aria-expanded', String(collapsed));
      }
      window.kbToggleLane = kbToggleLane;

      function getPageNav(btn) {
        var nav = btn.closest('.kb-page-nav');
        if (!nav) return null;
        var cards = nav.closest('.kb-cards');
        if (!cards) return null;
        var pages = Array.from(cards.querySelectorAll('.kb-page'));
        var ind = nav.querySelector('.kb-page-ind');
        var currentPage = pages.findIndex(function(p) { return p.style.display !== 'none'; });
        return { pages: pages, ind: ind, currentPage: currentPage, prevBtn: nav.querySelector('[aria-label="이전"]'), nextBtn: nav.querySelector('[aria-label="다음"]') };
      }

      function kbGoToPage(btn, delta) {
        var nav = getPageNav(btn);
        if (!nav) return;
        var target = nav.currentPage + delta;
        if (target < 0 || target >= nav.pages.length) return;
        nav.pages[nav.currentPage].style.display = 'none';
        nav.pages[target].style.display = '';
        if (nav.ind) nav.ind.textContent = (target + 1) + ' / ' + nav.pages.length;
        if (nav.prevBtn) nav.prevBtn.disabled = target === 0;
        if (nav.nextBtn) nav.nextBtn.disabled = target === nav.pages.length - 1;
      }

      window.kbPrevPage = function(btn) { kbGoToPage(btn, -1); };
      window.kbNextPage = function(btn) { kbGoToPage(btn, +1); };
    })();
    </script>`;
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
    cursor: pointer;
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
  .flow-chain-hint {
    font-size: 11px;
    color: var(--accent);
    font-weight: 700;
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
    cursor: pointer;
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
  .flow-chain-summary {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.55;
  }
  .flow-chain-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
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
  .flow-map-panel {
    background: var(--surface);
    border: 1px solid rgba(220,207,186,0.92);
    border-radius: var(--radius-lg);
    padding: 18px;
    box-shadow: var(--shadow);
    margin-bottom: 18px;
  }
  .flow-map-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 14px;
    margin-bottom: 14px;
  }
  .flow-map-head h3 {
    margin: 0;
    font-size: 18px;
    letter-spacing: -0.03em;
  }
  .flow-map-head p {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.55;
  }
  .flow-map-hero {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 14px;
    border-radius: 16px;
    padding: 16px;
    background: linear-gradient(135deg, rgba(15,118,110,0.08), rgba(29,78,216,0.06));
    border: 1px solid rgba(15,118,110,0.16);
  }
  .flow-map-copy {
    display: grid;
    gap: 6px;
  }
  .flow-map-copy strong {
    font-size: 18px;
    letter-spacing: -0.03em;
  }
  .flow-map-copy p {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.6;
  }
  .flow-map-status {
    min-width: min(100%, 340px);
    display: grid;
    justify-items: end;
    gap: 8px;
  }
  .flow-map-status code {
    width: 100%;
    padding: 8px 10px;
    border-radius: 12px;
    background: rgba(255,255,255,0.82);
    border: 1px solid rgba(220,207,186,0.9);
    font-size: 11px;
    text-align: right;
    word-break: break-word;
  }
  .flow-map-summary-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 12px;
  }
  .flow-map-summary-card {
    padding: 14px;
    border-radius: 14px;
    background: #fbf7ef;
    border: 1px solid rgba(220,207,186,0.76);
    display: grid;
    gap: 6px;
  }
  .flow-map-summary-card span,
  .flow-map-step-copy span,
  .flow-map-references span {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .flow-map-summary-card strong,
  .flow-map-step-copy strong {
    font-size: 13px;
    line-height: 1.6;
  }
  .flow-map-route {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-top: 14px;
  }
  .flow-map-step {
    padding: 14px;
    border-radius: 14px;
    background: var(--surface-strong);
    border: 1px solid rgba(220,207,186,0.82);
    display: grid;
    gap: 10px;
  }
  .flow-map-step-index {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: rgba(15,118,110,0.12);
    color: var(--accent);
    font-size: 12px;
    font-weight: 800;
  }
  .flow-map-step-copy {
    display: grid;
    gap: 8px;
  }
  .flow-map-references {
    display: grid;
    gap: 10px;
    margin-top: 14px;
    padding: 14px;
    border-radius: 14px;
    background: rgba(255,248,238,0.92);
    border: 1px solid rgba(220,207,186,0.78);
  }
  .flow-map-reference-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .flow-map-reference-list code {
    font-size: 11px;
    padding: 5px 8px;
    border-radius: 10px;
    background: rgba(255,255,255,0.82);
    border: 1px solid rgba(220,207,186,0.9);
  }
  .flow-map-empty {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.6;
  }
  /* ── Kanban Board ─────────────────────────── */
  /* ── Kanban section controls ─────────────────── */
  .kb-section-head {
    align-items: center;
  }
  .kb-section-toggle {
    font-size: 12px;
    font-weight: 700;
    padding: 5px 12px;
    border-radius: 99px;
    border: 1px solid rgba(220,207,186,0.9);
    background: var(--surface);
    cursor: pointer;
    color: var(--muted);
    white-space: nowrap;
    transition: background .15s;
  }
  .kb-section-toggle:hover { background: rgba(15,118,110,0.06); }
  .kb-summary-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }
  .kb-sum-pill {
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 99px;
    border: 1px solid;
    font-weight: 600;
  }
  .kb-sum-pill strong { margin-left: 4px; }
  /* ── Lane toggle ─────────────────────────────── */
  .kb-lane-toggle {
    border: none;
    background: rgba(0,0,0,0.05);
    border-radius: 6px;
    width: 22px;
    height: 22px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    color: var(--muted);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background .13s;
    flex-shrink: 0;
  }
  .kb-lane-toggle:hover { background: rgba(0,0,0,0.1); }
  /* ── Paging ──────────────────────────────────── */
  .kb-page-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 6px 10px 8px;
    border-top: 1px solid rgba(220,207,186,0.5);
    margin-top: 4px;
  }
  .kb-nav-btn {
    border: 1px solid rgba(220,207,186,0.9);
    background: var(--surface);
    border-radius: 6px;
    width: 26px;
    height: 26px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background .13s;
  }
  .kb-nav-btn:hover:not(:disabled) { background: rgba(15,118,110,0.08); }
  .kb-nav-btn:disabled { opacity: 0.3; cursor: default; }
  .kb-page-ind { font-size: 11px; color: var(--muted); min-width: 36px; text-align: center; }
  /* ── Board & Lane ────────────────────────────── */
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
  .kb-cards { display: grid; gap: 0; }
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
  .kb-page { display: grid; gap: 8px; padding: 10px; }
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
    .flow-map-head,
    .flow-map-hero {
      flex-direction: column;
    }
    .flow-map-status {
      width: 100%;
      justify-items: flex-start;
    }
    .flow-map-status code {
      text-align: left;
    }
    .flow-map-summary-grid {
      grid-template-columns: 1fr;
    }
    .flow-map-route {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .flow-chain-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .kb-board { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .kb-summary-bar { gap: 4px; }
  }
  @media (max-width: 600px) {
    .flow-strip { grid-template-columns: 1fr; }
    .flow-map-route { grid-template-columns: 1fr; }
    .flow-chain-grid { grid-template-columns: 1fr; }
    .kb-board { grid-template-columns: 1fr; }
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
  return {
    html,
    homeData: {
      report: data.report,
      handoff_lane: buildHandoffLaneData(data),
      generatedAt: new Date().toISOString(),
    },
  };
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
          <h2>⚡ 자동 실행 연결</h2>
          <p>이 영역에서는 터미널 연결, 자주 쓰는 명령, 파일 열기, 빠른 실행 키워드를 한 화면에서 다룰 수 있습니다.</p>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
        <span class="ab-badge"><span class="ab-status-dot" id="ab-conn-dot"></span><span id="ab-conn-label">서버 연결 중...</span></span>
        <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abRefreshSessions()">⟳ 터미널 새로고침</button>
      </div>
    </div>
    <div class="ab-state-bar">
      <span class="ab-state-pill">현재 작업 <strong id="ab-wp-live">—</strong></span>
      <span class="ab-state-pill">브랜치 <strong id="ab-branch-live">—</strong></span>
      <span class="ab-state-pill">열린 터미널 <strong id="ab-pty-live">—</strong></span>
      <span class="ab-state-pill">선택한 터미널 <strong id="ab-target-pts">미선택</strong></span>
      <span class="ab-state-pill" style="margin-left:auto;">서버 <strong id="ab-server-status">localhost:8080</strong></span>
    </div>
    <div class="ab-tabs">
      <button class="ab-tab ab-active" onclick="abSwitchTab('guide',this)">📖 처음 보는 사람 안내</button>
      <button class="ab-tab" onclick="abSwitchTab('terminal',this)">🖥 터미널 연결</button>
      <button class="ab-tab" onclick="abSwitchTab('commands',this)">⚡ 자주 쓰는 명령</button>
      <button class="ab-tab" onclick="abSwitchTab('files',this)">📂 파일 바로 열기</button>
      <button class="ab-tab" onclick="abSwitchTab('keywords',this)">🔑 빠른 키워드</button>
    </div>

    <!-- 사용법 가이드 -->
    <div class="ab-panel ab-active" id="ab-panel-guide">
      <div class="ab-guide-grid">
        <div class="ab-guide-block ab-open">
          <div class="ab-guide-block-head" onclick="abToggleGuide(this)">
            <div class="ab-guide-block-title"><span>🗺</span><span>먼저 이해하기 — 이 시스템은 무엇을 하나요?</span></div>
            <span class="ab-guide-chevron">▼</span>
          </div>
          <div class="ab-guide-body">
            <p>이 시스템은 요구사항 정리부터 구현, 검증까지의 흐름을 <strong>작업 카드(Work Packet)</strong> 단위로 추적하고 실행하도록 돕습니다.</p>
            <div class="ab-stage-flow">
              <div class="ab-stage-node"><span class="ab-stage-pill ab-stage-a" onclick="abSendKeyword('A 도메인명')">A 분석</span><span class="ab-arrow">→</span></div>
              <div class="ab-stage-node"><span class="ab-stage-pill ab-stage-b" onclick="abSendKeyword('B_review 도메인명')">B 리뷰</span><span class="ab-arrow">→</span></div>
              <div class="ab-stage-node"><span class="ab-stage-pill ab-stage-c" onclick="abSendKeyword('계속')">C 쉘</span><span class="ab-arrow">→</span></div>
              <div class="ab-stage-node"><span class="ab-stage-pill ab-stage-d" onclick="abSendKeyword('D 도메인명')">D 구현</span><span class="ab-arrow">→</span></div>
              <div class="ab-stage-node"><span class="ab-stage-pill ab-stage-e" onclick="abSendKeyword('E 도메인명')">E 검증</span></div>
            </div>
            <ul>
              <li><strong>사람이 하는 일</strong>: 요구사항과 우선순위를 정하고 <code>requirements/requirements.yaml</code>를 관리합니다.</li>
              <li><strong>도구가 하는 일</strong>: 한 번에 하나의 작업 카드를 끝까지 처리하려고 시도합니다.</li>
              <li><strong>상태 확인</strong>: <code>memory/L0-hot/current-state.yaml</code>에서 현재 단계를 봅니다.</li>
              <li><strong>가장 쉬운 시작</strong>: 터미널에 <code>npm run project:status</code> 실행</li>
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
            <div class="ab-guide-block-title"><span>🚀</span><span>5분 안에 시작하기</span></div>
            <span class="ab-guide-chevron">▼</span>
          </div>
          <div class="ab-guide-body">
            <p><strong>Step 1</strong>: <code>requirements/requirements.yaml</code>에 도메인 추가</p>
            <p><strong>Step 2</strong>: 터미널에 실행 키워드 입력 (아래 빠른 키워드 탭 또는 터미널 연결 탭 사용)</p>
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
            <div class="ab-guide-block-title"><span>🔑</span><span>짧은 키워드로 실행하기</span></div>
            <span class="ab-guide-chevron">▼</span>
          </div>
          <div class="ab-guide-body">
            <p>키워드를 누르면 선택한 터미널로 바로 전송됩니다. 먼저 터미널 연결 탭에서 터미널을 선택하세요.</p>
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
          <div class="ab-card-title">VS Code 터미널 선택</div>
          <div class="ab-session-list" id="ab-session-list"><div style="font-size:12px;color:var(--muted);padding:8px;">터미널 목록 불러오는 중...</div></div>
          <div style="margin-top:10px;display:flex;gap:6px;">
            <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abRefreshSessions()">⟳ 새로고침</button>
            <button class="ab-btn ab-btn-secondary ab-btn-sm" onclick="abSendEnter()">↵ Enter</button>
          </div>
        </div>
        <div class="ab-card">
          <div class="ab-card-title">명령 보내기</div>
          <input class="ab-cmd-input" id="ab-cmd-input" type="text" placeholder="명령어 또는 실행 키워드 입력... (Enter로 전송)" autocomplete="off" spellcheck="false">
          <div class="ab-btn-row">
            <button class="ab-btn ab-btn-primary" onclick="abSendCmd()">▶ 보내고 실행</button>
            <button class="ab-btn ab-btn-secondary" onclick="abSendCmdNoEnter()">입력만</button>
          </div>
          <div id="ab-send-result" class="ab-result"></div>
          <div style="margin-top:14px;">
            <div class="ab-card-title" style="margin-bottom:8px;">자주 쓰는 키워드</div>
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
            <div class="ab-card-title" style="margin-bottom:8px;">특정 기능만 실행</div>
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
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">파일을 누르면 바로 열 수 있습니다. 옆 버튼으로는 경로를 터미널에 보낼 수 있습니다.</p>
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
          <a class="ab-file-item" href="master-planner/index.html" target="_blank"><span>🗂</span><span class="ab-file-name">계획 화면</span></a>
          <a class="ab-file-item" href="catalog-site/index.html" target="_blank"><span>📚</span><span class="ab-file-name">기능 목록 화면</span></a>
          <a class="ab-file-item" href="mindmap/index.html" target="_blank"><span>🎛</span><span class="ab-file-name">문제 해결 제어 센터</span></a>
          <a class="ab-file-item" href="quality/index.html" target="_blank"><span>✅</span><span class="ab-file-name">품질 게이트</span></a>
          <a class="ab-file-item" href="audit/index.html" target="_blank"><span>🔍</span><span class="ab-file-name">감사 로그</span></a>
          <a class="ab-file-item" href="study-guide/index.html" target="_blank"><span>🎓</span><span class="ab-file-name">초보자 안내 화면</span></a>
        </div></div>
      </div>
    </div>

    <!-- 키워드 실행표 -->
    <div class="ab-panel" id="ab-panel-keywords">
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px;">키워드를 누르면 선택한 VS Code 터미널로 바로 보냅니다. 기능 이름이 필요한 경우 아래 입력칸을 같이 사용하세요.</p>
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
