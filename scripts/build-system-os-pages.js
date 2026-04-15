#!/usr/bin/env node
'use strict';
/**
 * scripts/build-system-os-pages.js
 * Workflow OS — System OS 페이지 5종 일괄 생성
 *
 * WP:  WP-UI-008 (flags)  WP-UI-009 (audit)  WP-UI-010 (quality)
 *      WP-UI-011 (lifecycle)  WP-UI-012 (rollback)
 * Stage: D (Implementation)
 *
 * 생성 목록:
 *   artifacts/flags/index.html       — 피처 플래그 관리 패널
 *   artifacts/audit/index.html       — 감사 로그 뷰어
 *   artifacts/quality/index.html     — 품질 게이트 현황판
 *   artifacts/lifecycle/index.html   — 도메인 라이프사이클 맵
 *   artifacts/rollback/index.html    — 롤백 콘솔 (system.admin 전용)
 *
 * 사용:
 *   node scripts/build-system-os-pages.js
 *   npm run build:system-os-pages
 */

const fs   = require('node:fs');
const path = require('node:path');

const { generateShellHeader, generateDesignSystem, generateShellScript } = require('./lib/ui-shell');
const { SystemApiClient } = require('./lib/system-api-client');

const ROOT    = path.resolve(__dirname, '..');
const client  = new SystemApiClient({ mode: 'file' });

// ── Shared helpers ────────────────────────────────────────────────────────────

function esc(v) {
  return String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function shellPage({ title, currentPage, head = '', body }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — Workflow OS</title>
${generateDesignSystem()}
${head}
${generateShellScript()}
</head>
<body>
${generateShellHeader({ currentPage, title: 'Workflow OS' })}
<span data-sse-connect="/api/v1/system/events" hidden aria-hidden="true"></span>
<main class="wf-page" id="main-content">
${body}
</main>
</body>
</html>`;
}

function write(relPath, html) {
  const abs = path.join(ROOT, 'artifacts', relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, html, 'utf8');
  process.stdout.write(`생성: artifacts/${relPath} (${html.length} bytes)\n`);
}

// ── WP-UI-008: 피처 플래그 관리 패널 ────────────────────────────────────────

function buildFlagsPage() {
  const { flags, total } = client._readFlagsFile();

  const groupMap = {};
  for (const f of flags) {
    const g = f.domain || 'global';
    if (!groupMap[g]) groupMap[g] = [];
    groupMap[g].push(f);
  }

  const groupsHtml = Object.entries(groupMap).map(([groupId, groupFlags]) => {
    const rows = groupFlags.map(f => {
      const stageColor = { released: '#22c55e', beta: '#6366f1', internal: '#f59e0b', deprecated: '#64748b' }[f.stage] || '#64748b';
      return `
    <div class="wf-card" data-flag-id="${esc(f.id)}" style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:1rem;padding:.75rem 1rem;">
      <div>
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem;">
          <code style="font-size:.85rem;font-family:var(--wf-font-mono);">${esc(f.id)}</code>
          <span class="wf-badge" style="background:${stageColor}1a;color:${stageColor};">${esc(f.stage)}</span>
        </div>
        <div class="wf-card__meta">도메인: ${esc(f.domain || '—')}</div>
      </div>
      <label class="wf-toggle" title="${f.enabled ? '활성' : '비활성'}"
             data-disable-without-permission="system.admin">
        <input type="checkbox" ${f.enabled ? 'checked' : ''} disabled
               aria-label="${esc(f.id)} 토글"
               onchange="handleFlagToggle(event,'${esc(f.id)}')">
        <span style="font-size:.8rem;color:${f.enabled ? 'var(--wf-color-pass)' : 'var(--wf-color-neutral)'};">
          ${f.enabled ? 'ON' : 'OFF'}
        </span>
      </label>
    </div>`;
    }).join('');

    return `
  <section class="wf-section">
    <div class="wf-section__title">${esc(groupId)}</div>
    <div style="display:flex;flex-direction:column;gap:.5rem;">${rows}</div>
  </section>`;
  }).join('');

  const body = `
  <div class="wf-status-bar">
    <div class="wf-status-item">
      <span class="wf-status-item__label">전체 플래그</span>
      <span class="wf-status-item__value">${total}</span>
    </div>
    <div class="wf-status-item">
      <span class="wf-status-item__label">활성</span>
      <span class="wf-status-item__value" style="color:var(--wf-color-pass);">${flags.filter(f=>f.enabled).length}</span>
    </div>
    <div class="wf-status-item">
      <span class="wf-status-item__label">비활성</span>
      <span class="wf-status-item__value" style="color:var(--wf-color-neutral);">${flags.filter(f=>!f.enabled).length}</span>
    </div>
    <div style="flex:1;"></div>
    <div id="flag-toggle-notice" class="wf-badge wf-badge--warn" style="display:none;">
      system_api.flag_toggle_ui.enabled=false — 읽기 전용
    </div>
  </div>

  ${groupsHtml}

  <!-- 확인 모달 (FlagToggle flow step 1~4) -->
  <div id="flag-modal" class="wf-modal-overlay" hidden>
    <div class="wf-modal">
      <div class="wf-modal__title">피처 플래그 변경</div>
      <div class="wf-modal__body" id="flag-modal-body"></div>
      <div class="wf-modal__actions">
        <button class="wf-btn wf-btn--ghost" onclick="closeFlagModal()">취소</button>
        <button class="wf-btn wf-btn--primary" id="flag-modal-confirm">확인</button>
      </div>
    </div>
  </div>

  <script>
  // INV-SYS-004: flag_toggle_ui.enabled=false 시 모든 토글 비활성화
  document.addEventListener('DOMContentLoaded', function() {
    fetch('/api/v1/system/flags')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){
        if (!data) return;
        var toggleEnabled = data.flags.some(function(f){ return f.id === 'system_api.flag_toggle_ui.enabled' && f.enabled; });
        if (!toggleEnabled) {
          document.getElementById('flag-toggle-notice').style.display = '';
        }
        // Update each flag state from live data
        data.flags.forEach(function(f){
          var card = document.querySelector('[data-flag-id="' + f.id + '"]');
          if (!card) return;
          var input = card.querySelector('input[type=checkbox]');
          var label = card.querySelector('.wf-toggle span');
          if (input) input.checked = f.enabled;
          if (label) {
            label.textContent = f.enabled ? 'ON' : 'OFF';
            label.style.color = f.enabled ? 'var(--wf-color-pass)' : 'var(--wf-color-neutral)';
          }
        });
      })
      .catch(function(){});
  });

  function handleFlagToggle(evt, flagId) {
    evt.preventDefault();
    var newVal = evt.target.checked;
    document.getElementById('flag-modal-body').textContent =
      flagId + ' 을(를) ' + (newVal ? '활성화' : '비활성화') + '하시겠습니까?';
    var modal = document.getElementById('flag-modal');
    modal.hidden = false;
    document.getElementById('flag-modal-confirm').onclick = function() {
      closeFlagModal();
      fetch('/api/v1/system/flags/' + encodeURIComponent(flagId), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-system-role': 'system.admin' },
        body: JSON.stringify({ enabled: newVal, reason: 'UI toggle' }),
      })
      .then(function(r){ return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function(){ WfShell.toast(flagId + ' 변경 완료', 'pass'); })
      .catch(function(e){ WfShell.toast('변경 실패: ' + e, 'fail'); });
    };
  }

  function closeFlagModal() {
    document.getElementById('flag-modal').hidden = true;
  }

  // SSE: system.flag.toggled — already handled by shell.js WfShell.sse
  </script>`;

  return shellPage({ title: '피처 플래그', currentPage: '/flags', body });
}

// ── WP-UI-009: 감사 로그 뷰어 ────────────────────────────────────────────────

function buildAuditPage() {
  const { entries, total } = client._readAuditFile({ limit: 50, offset: 0 });

  const rows = entries.slice(0, 50).map(e => {
    const rClass = e.result === 'PASS' ? 'pass' : e.result === 'FAIL' ? 'fail' : 'warn';
    const ts = e.timestamp ? new Date(e.timestamp).toLocaleString('ko-KR', { hour12: false }) : '—';
    return `
    <div class="wf-timeline-row" data-entry-seq="${esc(e.seq)}">
      <span class="wf-timeline-row__time" title="${esc(e.timestamp)}">${esc(ts.slice(-8))}</span>
      <span class="wf-timeline-row__domain">
        <span class="wf-badge wf-badge--stage">${esc(e.stage || '—')}</span>
        ${esc(e.domain || '—')}
      </span>
      <span class="wf-timeline-row__action">${esc(e.action || '—')}</span>
      <span class="wf-badge wf-badge--${rClass}">${esc(e.result)}</span>
    </div>`;
  }).join('') || '<div style="color:var(--wf-color-neutral);padding:1rem;">감사 로그 없음</div>';

  const body = `
  <div class="wf-status-bar">
    <div class="wf-status-item">
      <span class="wf-status-item__label">전체 항목</span>
      <span class="wf-status-item__value">${total}</span>
    </div>
    <div class="wf-status-item">
      <span class="wf-status-item__label">표시</span>
      <span class="wf-status-item__value">${Math.min(50, entries.length)}</span>
    </div>
  </div>

  <!-- 필터 바 -->
  <div class="wf-section">
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem;">
      <input id="audit-search" type="search" placeholder="액션 검색..."
             style="padding:.35rem .75rem;background:var(--wf-color-surface);border:1px solid var(--wf-color-border);color:var(--wf-color-text);border-radius:var(--wf-radius);font-size:.875rem;min-width:180px;"
             oninput="filterAudit()">
      <select id="audit-result-filter" onchange="filterAudit()"
              style="padding:.35rem .75rem;background:var(--wf-color-surface);border:1px solid var(--wf-color-border);color:var(--wf-color-text);border-radius:var(--wf-radius);font-size:.875rem;">
        <option value="">결과 전체</option>
        <option value="PASS">PASS</option>
        <option value="FAIL">FAIL</option>
        <option value="PARTIAL">PARTIAL</option>
      </select>
      <button class="wf-btn wf-btn--ghost wf-btn--sm" onclick="exportAudit('csv')">CSV 내보내기</button>
      <button class="wf-btn wf-btn--ghost wf-btn--sm" onclick="exportAudit('jsonl')">JSONL 내보내기</button>
    </div>
  </div>

  <!-- 타임라인 -->
  <div class="wf-section">
    <div class="wf-section__title">감사 로그 (최신순)</div>
    <div class="wf-timeline" id="audit-timeline" data-quality-timeline>
      ${rows}
    </div>
  </div>

  <script>
  function filterAudit() {
    var q   = document.getElementById('audit-search').value.toLowerCase();
    var res = document.getElementById('audit-result-filter').value;
    document.querySelectorAll('#audit-timeline .wf-timeline-row').forEach(function(row) {
      var action = (row.querySelector('.wf-timeline-row__action') || {}).textContent || '';
      var result = (row.querySelector('.wf-badge') || {}).textContent || '';
      var show = (!q || action.toLowerCase().includes(q)) && (!res || result.trim() === res);
      row.style.display = show ? '' : 'none';
    });
  }

  function exportAudit(format) {
    fetch('/api/v1/system/audit?limit=200')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){
        if (!data) { WfShell.toast('내보내기 실패', 'fail'); return; }
        var content, mime, ext;
        if (format === 'csv') {
          var header = 'seq,timestamp,domain,stage,action,result,hash';
          var lines  = data.entries.map(function(e){
            return [e.seq, e.timestamp, e.domain, e.stage, '"' + (e.action||'').replace(/"/g,'""') + '"', e.result, e.hash].join(',');
          });
          content = [header].concat(lines).join('\\n');
          mime = 'text/csv'; ext = 'csv';
        } else {
          content = data.entries.map(function(e){ return JSON.stringify(e); }).join('\\n');
          mime = 'application/x-ndjson'; ext = 'jsonl';
        }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([content], { type: mime }));
        a.download = 'audit-log.' + ext;
        a.click();
        WfShell.toast('내보내기 완료', 'pass');
      });
  }

  // SSE: 신규 항목이 오면 타임라인 선두에 추가 (shell.js의 system.quality-gate.updated 핸들러가 담당)
  </script>`;

  return shellPage({ title: '감사 로그', currentPage: '/audit', body });
}

// ── WP-UI-010: 품질 게이트 현황판 ────────────────────────────────────────────

function buildQualityPage() {
  const qg = client._readQualityGateFile();
  const health = client._readHealthFile();

  const GATE_COLS   = ['unit_test','contract','lint','authz','e2e_smoke','supply_chain','observability','rollback'];
  const COL_LABELS  = { unit_test:'단위 테스트', contract:'계약 드리프트', lint:'린트·정적분석',
    authz:'authz 회귀', e2e_smoke:'E2E 스모크', supply_chain:'공급망', observability:'관측성', rollback:'롤백' };
  const DOMAIN_ROWS = ['task-tracking','billing','video','system-api'];
  const DOMAIN_LABELS = { 'task-tracking':'작업 관리','billing':'정산관리','video':'비디오','system-api':'System OS' };

  // Build a lookup map for gate results
  const gateMap = {};
  for (const g of qg.gates) {
    gateMap[g.id] = g.result;
  }

  const matrixRows = DOMAIN_ROWS.map(domain => {
    const cells = GATE_COLS.map(col => {
      const result = gateMap[col] || (qg.overall === 'PASS' ? 'PASS' : 'SKIP');
      const cls    = result === 'PASS' ? 'pass' : result === 'FAIL' ? 'fail' : 'skip';
      const icon   = result === 'PASS' ? '✓' : result === 'FAIL' ? '✗' : '—';
      return `<td class="${cls}" title="${esc(COL_LABELS[col])} — ${esc(result)}">${icon}</td>`;
    }).join('');
    return `<tr><th style="text-align:left;padding:.4rem .75rem;background:var(--wf-color-surface);border:1px solid var(--wf-color-border);">${esc(DOMAIN_LABELS[domain]||domain)}</th>${cells}</tr>`;
  }).join('');

  const colHeaders = GATE_COLS.map(col => `<th title="${esc(COL_LABELS[col])}">${esc((COL_LABELS[col]||col).slice(0,6))}</th>`).join('');

  const passCount  = qg.gates.filter(g => g.result === 'PASS').length;
  const totalCount = qg.gates.length;
  const lastRun    = qg.last_run_at
    ? new Date(qg.last_run_at).toLocaleString('ko-KR', { hour12: false }) : '—';
  const overallColor = qg.overall === 'PASS' ? 'var(--wf-color-pass)' : 'var(--wf-color-fail)';

  // Domain health summary for status bar
  const healthItems = health.domains.map(d =>
    `<div class="wf-status-item">
      <span class="wf-status-item__label">${esc(d.name || d.id)}</span>
      <span class="wf-status-item__value" data-domain-id="${esc(d.id)}"
            style="font-size:.95rem;color:${d.health_score>=90?'var(--wf-color-pass)':d.health_score>=70?'var(--wf-color-warn)':'var(--wf-color-fail)'};">
        <span data-health-score>${d.health_score}</span>
      </span>
    </div>`
  ).join('');

  const body = `
  <div class="wf-status-bar">
    <div class="wf-status-item">
      <span class="wf-status-item__label">전체 결과</span>
      <span class="wf-status-item__value" style="color:${overallColor};">${esc(qg.overall)}</span>
    </div>
    <div class="wf-status-item">
      <span class="wf-status-item__label">게이트</span>
      <span class="wf-status-item__value">${passCount}/${totalCount} PASS</span>
    </div>
    <div class="wf-status-item">
      <span class="wf-status-item__label">마지막 실행</span>
      <span class="wf-status-item__value" style="font-size:.8rem;">${esc(lastRun)}</span>
    </div>
  </div>

  <!-- 도메인 헬스 요약 -->
  <div class="wf-section">
    <div class="wf-section__title">도메인 헬스 점수 (실시간)</div>
    <div class="wf-status-bar">${healthItems}</div>
  </div>

  <!-- 게이트 매트릭스 -->
  <div class="wf-section">
    <div class="wf-section__title">게이트 매트릭스 (도메인 × 게이트)</div>
    <div style="overflow-x:auto;">
      <table class="wf-matrix">
        <thead><tr><th style="text-align:left;">도메인</th>${colHeaders}</tr></thead>
        <tbody>${matrixRows}</tbody>
      </table>
    </div>
    <p style="color:var(--wf-color-neutral);font-size:.75rem;margin-top:.5rem;">
      ✓ PASS &nbsp; ✗ FAIL &nbsp; — SKIP &nbsp;&nbsp; FAIL 셀 클릭 시 상세 표시
    </p>
  </div>

  <!-- 드릴다운 패널 -->
  <div id="gate-detail-panel" hidden
       style="position:fixed;right:0;top:56px;width:320px;height:calc(100vh - 56px);background:var(--wf-color-surface);border-left:1px solid var(--wf-color-border);padding:1rem;overflow-y:auto;z-index:50;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <strong id="gate-detail-title">게이트 상세</strong>
      <button class="wf-btn wf-btn--ghost wf-btn--sm" onclick="document.getElementById('gate-detail-panel').hidden=true">✕</button>
    </div>
    <div id="gate-detail-content"></div>
  </div>

  <script>
  document.querySelectorAll('.wf-matrix td.fail').forEach(function(cell) {
    cell.addEventListener('click', function() {
      document.getElementById('gate-detail-title').textContent = cell.title;
      document.getElementById('gate-detail-content').innerHTML =
        '<p style="color:var(--wf-color-fail);">이 게이트는 FAIL 상태입니다.</p>' +
        '<p style="color:var(--wf-color-neutral);font-size:.85rem;">감사 로그에서 상세 내용을 확인하세요.</p>' +
        '<a href="../audit/index.html" class="wf-btn wf-btn--ghost wf-btn--sm">감사 로그 열기</a>';
      document.getElementById('gate-detail-panel').hidden = false;
    });
  });
  </script>`;

  return shellPage({ title: '품질 게이트', currentPage: '/quality', body });
}

// ── WP-UI-011: 도메인 라이프사이클 맵 ────────────────────────────────────────

function buildLifecyclePage() {
  const { domains } = client._readLifecycleFile();
  const STAGES = ['A','B','C','D','E'];

  const domainCards = domains.map(d => {
    const pipeline = STAGES.map((s, i) => {
      const stageData = d.stages[s] || {};
      const cls = stageData.status === 'PASS' ? 'pass'
        : s === d.current_stage ? 'current' : 'pending';
      const arrow = i < STAGES.length - 1
        ? '<span class="wf-pipeline-arrow" aria-hidden="true">›</span>' : '';
      return `<span class="wf-pipeline-stage wf-pipeline-stage--${cls}"
                    title="${esc(s + ': ' + (stageData.status||'PENDING'))}"
                    data-stage="${esc(s)}">${esc(s)}</span>${arrow}`;
    }).join('');

    const ejectBadge = d.ejectable
      ? '<span class="wf-badge wf-badge--pass" style="margin-left:.5rem;">분리 가능</span>' : '';

    return `
    <div class="wf-card">
      <div class="wf-card__title" style="display:flex;align-items:center;justify-content:space-between;">
        <span>${esc(d.name)}</span>
        <div style="display:flex;align-items:center;gap:.4rem;">
          <span class="wf-badge wf-badge--stage">Stage ${esc(d.current_stage)}</span>
          ${ejectBadge}
        </div>
      </div>
      <div class="wf-pipeline" style="margin-top:.75rem;">${pipeline}</div>
    </div>`;
  }).join('');

  const body = `
  <div class="wf-status-bar">
    <div class="wf-status-item">
      <span class="wf-status-item__label">전체 도메인</span>
      <span class="wf-status-item__value">${domains.length}</span>
    </div>
    <div class="wf-status-item">
      <span class="wf-status-item__label">Stage E 완료</span>
      <span class="wf-status-item__value" style="color:var(--wf-color-pass);">${domains.filter(d=>d.current_stage==='E').length}</span>
    </div>
    <div class="wf-status-item">
      <span class="wf-status-item__label">분리 가능</span>
      <span class="wf-status-item__value" style="color:var(--wf-color-accent);">${domains.filter(d=>d.ejectable).length}</span>
    </div>
  </div>

  <div class="wf-section">
    <div class="wf-section__title">도메인 Stage 파이프라인</div>
    <div class="wf-grid wf-grid--2">${domainCards}</div>
  </div>

  <div class="wf-section">
    <div class="wf-section__title">범례</div>
    <div style="display:flex;gap:1rem;flex-wrap:wrap;font-size:.82rem;color:var(--wf-color-neutral);">
      <span><span class="wf-pipeline-stage wf-pipeline-stage--pass" style="display:inline-flex;width:1.5rem;height:1.5rem;font-size:.65rem;">✓</span> PASS</span>
      <span><span class="wf-pipeline-stage wf-pipeline-stage--current" style="display:inline-flex;width:1.5rem;height:1.5rem;font-size:.65rem;">▶</span> 현재 진행</span>
      <span><span class="wf-pipeline-stage" style="display:inline-flex;width:1.5rem;height:1.5rem;font-size:.65rem;border:2px solid var(--wf-color-border);">?</span> 미착수</span>
    </div>
  </div>`;

  return shellPage({ title: '라이프사이클', currentPage: '/lifecycle', body });
}

// ── WP-UI-012: 롤백 콘솔 ─────────────────────────────────────────────────────

function buildRollbackPage() {
  const catalog = client._readCatalogFile();
  const domains = catalog.domains.length > 0
    ? catalog.domains
    : [{ id: 'task-tracking', name: '작업 관리' }, { id: 'billing', name: '정산관리' },
       { id: 'video', name: '비디오 관리' }];

  const domainCards = domains.map(d => `
    <div class="wf-card" style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div class="wf-card__title">${esc(d.name || d.id)}</div>
        <div class="wf-card__meta">id: ${esc(d.id)}</div>
      </div>
      <button class="wf-btn wf-btn--danger"
              data-disable-without-permission="system.admin"
              onclick="handleRollback('${esc(d.id)}','${esc(d.name||d.id)}')"
              aria-label="${esc(d.name||d.id)} 롤백">롤백</button>
    </div>`).join('');

  const body = `
  <div class="wf-card" style="border-color:var(--wf-color-fail);margin-bottom:1.5rem;">
    <div style="display:flex;align-items:flex-start;gap:.75rem;">
      <span style="font-size:1.5rem;">⚠</span>
      <div>
        <div class="wf-card__title" style="color:var(--wf-color-fail);">system.admin 전용 — 롤백 콘솔</div>
        <div class="wf-card__meta">
          이 페이지에서 실행되는 모든 작업은 감사 로그에 기록됩니다.
          롤백을 실행하면 해당 도메인의 플래그가 비활성화되고 롤백 플레이북이 실행됩니다.
          <code style="font-family:var(--wf-font-mono);font-size:.8rem;">system_api.rollback_ui.enabled</code> 플래그가 활성화된 경우에만 작동합니다.
        </div>
      </div>
    </div>
  </div>

  <div id="rollback-disabled-notice" class="wf-badge wf-badge--warn" style="display:none;margin-bottom:1rem;padding:.5rem 1rem;">
    system_api.rollback_ui.enabled = false — 롤백 UI 비활성 상태
  </div>

  <div class="wf-section">
    <div class="wf-section__title">도메인 롤백</div>
    <div style="display:flex;flex-direction:column;gap:.5rem;">${domainCards}</div>
  </div>

  <script>
  // INV-SYS-005: rollback_ui.enabled=false 시 롤백 버튼 비활성화
  document.addEventListener('DOMContentLoaded', function() {
    fetch('/api/v1/system/flags')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data) return;
        var rollbackEnabled = data.flags.some(function(f){
          return f.id === 'system_api.rollback_ui.enabled' && f.enabled;
        });
        if (!rollbackEnabled) {
          document.getElementById('rollback-disabled-notice').style.display = '';
          document.querySelectorAll('.wf-btn--danger').forEach(function(btn){
            btn.disabled = true;
            btn.setAttribute('aria-disabled','true');
            btn.title = 'system_api.rollback_ui.enabled=false';
          });
        }
      })
      .catch(function(){});
  });

  function handleRollback(domainId, domainName) {
    WfShell.confirm({
      title: domainName + ' 롤백',
      body: '이 작업은 되돌릴 수 없습니다. 도메인 플래그가 비활성화되고 롤백 플레이북이 실행됩니다.',
      confirmText: 'ROLLBACK ' + domainId,
      dangerLabel: '롤백 실행',
    }).then(function(confirmed) {
      if (!confirmed) return;
      fetch('/api/v1/system/rollback/' + encodeURIComponent(domainId), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-system-role': 'system.admin' },
        body: JSON.stringify({ confirmation: 'ROLLBACK ' + domainId, reason: 'UI rollback' }),
      })
      .then(function(r){ return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function(data){ WfShell.toast('롤백 시작: ' + domainName + ' (' + (data.rollback_id||'') + ')', 'warn'); })
      .catch(function(e){ WfShell.toast('롤백 실패: ' + e, 'fail'); });
    });
  }
  </script>`;

  return shellPage({ title: '롤백 콘솔', currentPage: '/rollback',
    head: '<meta name="robots" content="noindex">',
    body });
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  write('flags/index.html',     buildFlagsPage());
  write('audit/index.html',     buildAuditPage());
  write('quality/index.html',   buildQualityPage());
  write('lifecycle/index.html', buildLifecyclePage());
  write('rollback/index.html',  buildRollbackPage());
  process.stdout.write('System OS 페이지 5종 생성 완료\n');
}

if (require.main === module) {
  main();
}

module.exports = { buildFlagsPage, buildAuditPage, buildQualityPage, buildLifecyclePage, buildRollbackPage };
