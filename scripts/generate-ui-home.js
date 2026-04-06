#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { buildReport } = require('./project_status');
const { readYaml } = require('./run_stage');

const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'artifacts', 'index.html');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function buildHtml({ report, navSummary, currentState }) {
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
</style>
</head>
<body>
  <a href="#main-content" class="skip-link">본문으로 건너뛰기</a>
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
const pendingIdempotencyKeys = {};
function stableStringifyForIdempotency(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((item) => stableStringifyForIdempotency(item)).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringifyForIdempotency(value[key])).join(',') + '}';
}
function createIdempotencyKey(scope) {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return scope + ':' + window.crypto.randomUUID();
  }
  return scope + ':' + Date.now() + ':' + Math.random().toString(16).slice(2);
}
function reserveIdempotencyKey(scope, payload) {
  const fingerprint = stableStringifyForIdempotency(payload || {});
  const existing = pendingIdempotencyKeys[scope];
  if (existing && existing.fingerprint === fingerprint) return existing.key;
  const key = createIdempotencyKey(scope);
  pendingIdempotencyKeys[scope] = { key, fingerprint };
  return key;
}
function releaseIdempotencyKey(scope, key) {
  const existing = pendingIdempotencyKeys[scope];
  if (existing && existing.key === key) delete pendingIdempotencyKeys[scope];
}
async function callPlanningApi(endpoint, body) {
  let idemScope = '';
  let idemKey = '';
  try {
    const opts = body
      ? (() => {
        idemScope = 'planning-studio:' + endpoint;
        idemKey = reserveIdempotencyKey(idemScope, body);
        return {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'Idempotency-Key': idemKey },
          body: JSON.stringify(body),
        };
      })()
      : {};
    const resp = await fetch('/api/planning-studio/' + endpoint, opts);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) { return null; }
  finally {
    if (idemScope && idemKey) releaseIdempotencyKey(idemScope, idemKey);
  }
}
async function callJson(path, { method = 'GET', body } = {}) {
  try {
    const opts = { method };
    if (body) { opts.headers = { 'content-type': 'application/json' }; opts.body = JSON.stringify(body); }
    const resp = await fetch(path, opts);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) { return null; }
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
});
</script>
</body>
</html>`;
}

function buildHomeData() {
  const report = buildReport();
  const nav = readYaml('master-shell/navigation/nav.yaml');
  const registry = readYaml('master-shell/plugin-registry/registry.yaml');
  const currentState = readYaml('memory/current-state.yaml');
  const navSummary = buildNavigationSummary(nav, registry);
  return { report, nav, registry, currentState, navSummary };
}

function buildHomeRuntime() {
  const { report, navSummary, currentState } = buildHomeData();
  const html = buildHtml({ report, navSummary, currentState });
  return { html, homeData: { report, generatedAt: new Date().toISOString() } };
}

function main() {
  const { report, navSummary, currentState } = buildHomeData();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, buildHtml({ report, navSummary, currentState }), 'utf8');
  process.stdout.write('생성 완료: artifacts/index.html\n');
}

if (require.main === module) {
  main();
}

module.exports = { buildHomeRuntime };
