'use strict';
/**
 * src/tests/smoke/systemOsPages.smoke.test.js
 * WP-UI-015~017 — Stage E 적대적 검증
 *
 * 검증 범위:
 *   E-1  authz regression  — system.admin 없는 변이 요청 → 403
 *   E-2  flag gate         — system_api.enabled=false → /api/v1/system/* → 404
 *   E-3  SSE availability  — GET /events → text/event-stream
 *   E-4  artifact files    — 7개 HTML 파일 존재 + Shell 통합 확인
 *   E-5  ui-shell module   — generateShellHeader, SystemApiClient API 형태 검증
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const { startServer }      = require('../../server/createServer');
const { startServerOrSkip } = require('./support/networkTestRuntime');

const ROOT = path.resolve(__dirname, '../../..');

// ── E-4: 아티팩트 파일 존재 확인 (네트워크 불필요) ─────────────────────────

test('[Stage E] 7개 System OS 아티팩트 파일 존재', () => {
  const pages = [
    'artifacts/index.html',
    'artifacts/catalog-site/index.html',
    'artifacts/flags/index.html',
    'artifacts/audit/index.html',
    'artifacts/quality/index.html',
    'artifacts/lifecycle/index.html',
    'artifacts/rollback/index.html',
  ];
  for (const rel of pages) {
    const abs = path.join(ROOT, rel);
    assert.ok(fs.existsSync(abs), `파일 없음: ${rel}`);
  }
});

test('[Stage E] 모든 아티팩트에 shell.js + data-sse-connect 통합 확인', () => {
  const pages = [
    'artifacts/index.html',
    'artifacts/catalog-site/index.html',
    'artifacts/flags/index.html',
    'artifacts/audit/index.html',
    'artifacts/quality/index.html',
    'artifacts/lifecycle/index.html',
    'artifacts/rollback/index.html',
  ];
  for (const rel of pages) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(
      html.includes('shell.js') || html.includes('WfShell'),
      `${rel}: shell.js 미통합`
    );
    assert.ok(
      html.includes('data-sse-connect') || html.includes('WfShell.sse'),
      `${rel}: SSE 연결 트리거 없음`
    );
  }
});

test('[Stage E] shared 자산 파일 존재 및 최소 크기', () => {
  const assets = {
    'artifacts/shared/shell.css': 5000,
    'artifacts/shared/shell.js':  5000,
  };
  for (const [rel, minBytes] of Object.entries(assets)) {
    const abs  = path.join(ROOT, rel);
    const stat = fs.statSync(abs);
    assert.ok(stat.size >= minBytes, `${rel}: ${stat.size}B < ${minBytes}B`);
  }
});

// ── E-5: ui-shell 모듈 계약 검증 ──────────────────────────────────────────

test('[Stage E] ui-shell.js 모듈 API 계약', () => {
  const uiShell = require('../../../scripts/lib/ui-shell');
  assert.strictEqual(typeof uiShell.generateShellHeader,  'function', 'generateShellHeader');
  assert.strictEqual(typeof uiShell.generateDesignSystem, 'function', 'generateDesignSystem');
  assert.strictEqual(typeof uiShell.generateShellScript,  'function', 'generateShellScript');
  assert.strictEqual(typeof uiShell.parseNavYaml,         'function', 'parseNavYaml');
  assert.strictEqual(typeof uiShell.parseEnabledFlags,    'function', 'parseEnabledFlags');
  assert.strictEqual(typeof uiShell.getDesignSystemCss,   'function', 'getDesignSystemCss');
  assert.strictEqual(typeof uiShell.getShellRuntimeJs,    'function', 'getShellRuntimeJs');

  // generateShellHeader 출력 구조 검증
  const h = uiShell.generateShellHeader({ currentPage: '/flags', title: 'Test' });
  assert.ok(h.includes('wf-shell-header'),   'nav header class');
  assert.ok(h.includes('data-sse-indicator'),'SSE indicator');
  assert.ok(h.includes('/flags'),            'currentPage active link');
  assert.ok(h.includes('wf-nav-link--active'), 'active class');

  // CSS 검증
  const css = uiShell.getDesignSystemCss();
  assert.ok(css.includes('--wf-color-pass'),  'color-pass token');
  assert.ok(css.includes('--wf-color-fail'),  'color-fail token');
  assert.ok(css.includes('--wf-color-accent'),'color-accent token');
  assert.ok(css.includes('.wf-card'),         '.wf-card class');
  assert.ok(css.includes('.wf-badge'),        '.wf-badge class');
  assert.ok(css.includes('.wf-btn'),          '.wf-btn class');
  assert.ok(css.includes('.wf-toggle'),       '.wf-toggle class');
  assert.ok(css.includes('.wf-modal'),        '.wf-modal class');

  // JS 검증
  const js = uiShell.getShellRuntimeJs();
  assert.ok(js.includes('WfShell.sse'),       'WfShell.sse');
  assert.ok(js.includes('WfShell.toast'),     'WfShell.toast');
  assert.ok(js.includes('WfShell.confirm'),   'WfShell.confirm');
  assert.ok(js.includes('WfShell.permissions'),'WfShell.permissions');
  assert.ok(js.includes('EventSource'),       'EventSource usage');
});

test('[Stage E] SystemApiClient file mode 6개 메서드 응답 형태', async () => {
  const { SystemApiClient } = require('../../../scripts/lib/system-api-client');
  const c = new SystemApiClient({ mode: 'file' });

  const health = await c.getSystemHealth();
  assert.strictEqual(typeof health.overall_score, 'number', 'health.overall_score');
  assert.ok(['ELITE','HIGH','MEDIUM','LOW','CRITICAL'].includes(health.rating), 'health.rating enum');
  assert.ok(Array.isArray(health.domains), 'health.domains array');

  const flags = await c.listFeatureFlags();
  assert.ok(Array.isArray(flags.flags),    'flags.flags array');
  assert.strictEqual(typeof flags.total, 'number', 'flags.total');
  assert.ok(flags.total > 0, 'flags.total > 0');

  const catalog = await c.getDomainCatalog();
  assert.ok(Array.isArray(catalog.domains), 'catalog.domains array');
  assert.ok(catalog.total > 0, 'catalog.total > 0');

  const audit = await c.getAuditLog({ limit: 3 });
  assert.ok(Array.isArray(audit.entries), 'audit.entries array');
  assert.ok(audit.entries.length <= 3,    'audit limit respected');

  const qg = await c.getQualityGateStatus();
  assert.ok(Array.isArray(qg.gates), 'qg.gates array');
  assert.strictEqual(qg.gates.length, 8, 'qg.gates 8개');
  assert.ok(qg.gates.every(g => ['PASS','FAIL','SKIP'].includes(g.result)), 'gate result enum');

  const lc = await c.getDomainLifecycle();
  assert.ok(Array.isArray(lc.domains), 'lc.domains array');
  assert.strictEqual(lc.domains.length, 4, 'lc.domains 4개');
  assert.ok(lc.domains.every(d => ['A','B','C','D','E'].includes(d.current_stage)), 'stage enum');
});

// ── E-1/E-2/E-3: 네트워크 기반 authz + flag gate + SSE 검증 ──────────────
// 패턴: startServerOrSkip(t, startServer, { port: 0, flags }) → runtime.url / runtime.shutdown

function makeFlagProvider(enabledFlags) {
  const enabled = new Set(enabledFlags);
  const allFlags = [
    'system_api.enabled', 'system_api.sse_stream.enabled',
    'system_api.flag_toggle_ui.enabled', 'system_api.rollback_ui.enabled',
  ];
  return {
    evaluate: (n) => ({ flagName: n, value: enabled.has(n), reason: 'TEST', metadata: {}, stale: false }),
    isEnabled: (n) => enabled.has(n),
    getFullFlagDetails: () => allFlags.map(f => ({ flag: f, enabled: enabled.has(f), env_overridden: false, source: 'test', group: 'plugin_flags' })),
    getRuntimeStatus: () => ({ flagsLoaded: true, metadataLoaded: true, errors: [], flagCount: allFlags.length, metadataCount: allFlags.length, envOverridesApplied: 0, env_overridden_flags: [], enabled_flags: [...enabled] }),
  };
}

test('[Stage E] INV-SYS-001: toggleFlag — system.admin 없음 → 403', async (t) => {
  const flags = makeFlagProvider(['system_api.enabled', 'system_api.flag_toggle_ui.enabled']);
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags });
  if (!runtime) return;
  try {
    const res = await fetch(`${runtime.url}/api/v1/system/flags/system_api.enabled`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },  // 권한 헤더 없음
      body: JSON.stringify({ enabled: false }),
    });
    assert.strictEqual(res.status, 403, 'system.admin 없음 → 403');
    const body = await res.json();
    assert.ok(body.title || body.detail || body.type, 'ProblemDetails 구조');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[Stage E] INV-SYS-002: triggerRollback — system.admin 없음 → 403', async (t) => {
  const flags = makeFlagProvider(['system_api.enabled', 'system_api.rollback_ui.enabled']);
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags });
  if (!runtime) return;
  try {
    const res = await fetch(`${runtime.url}/api/v1/system/rollback/billing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },  // 권한 헤더 없음
      body: JSON.stringify({ confirmation: 'ROLLBACK billing' }),
    });
    assert.strictEqual(res.status, 403, 'system.admin 없음 → 403');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[Stage E] INV-SYS-003: system_api.enabled=false → GET /health → 404', async (t) => {
  const flags = makeFlagProvider([]);  // 모든 system_api 플래그 비활성
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags });
  if (!runtime) return;
  try {
    const res = await fetch(`${runtime.url}/api/v1/system/health`);
    assert.strictEqual(res.status, 404, 'system_api.enabled=false → 404');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[Stage E] INV-SYS-004: flag_toggle_ui=false → PATCH /flags/:id → 503', async (t) => {
  const flags = makeFlagProvider(['system_api.enabled']);  // flag_toggle_ui 미활성
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags });
  if (!runtime) return;
  try {
    const res = await fetch(`${runtime.url}/api/v1/system/flags/system_api.enabled`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-permissions': 'system.admin' },
      body: JSON.stringify({ enabled: false }),
    });
    assert.strictEqual(res.status, 503, 'flag_toggle_ui=false → 503');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[Stage E] INV-SYS-005: rollback_ui=false → POST /rollback → 503', async (t) => {
  const flags = makeFlagProvider(['system_api.enabled']);  // rollback_ui 미활성
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags });
  if (!runtime) return;
  try {
    const res = await fetch(`${runtime.url}/api/v1/system/rollback/billing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-permissions': 'system.admin' },
      body: JSON.stringify({ confirmation: 'ROLLBACK billing' }),
    });
    assert.strictEqual(res.status, 503, 'rollback_ui=false → 503');
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});

test('[Stage E] GET /api/v1/system/events → text/event-stream (SSE 연결 확인)', async (t) => {
  const flags = makeFlagProvider(['system_api.enabled', 'system_api.sse_stream.enabled']);
  const runtime = await startServerOrSkip(t, startServer, { port: 0, flags });
  if (!runtime) return;
  try {
    // AbortController는 Node.js 20+에서 전역 사용 가능 (eslint no-undef 우회)
    // eslint-disable-next-line no-undef
    const ctrl = new AbortController();
    const res  = await fetch(`${runtime.url}/api/v1/system/events`, { signal: ctrl.signal });
    assert.ok(res.headers.get('content-type')?.includes('text/event-stream'),
      'content-type: text/event-stream');
    ctrl.abort();
  } finally {
    await runtime.shutdown({ reason: 'test' });
  }
});
