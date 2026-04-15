'use strict';
/**
 * scripts/lib/ui-shell.js
 * Workflow OS — 공통 UI Shell 생성기 (빌드타임 Node.js 모듈)
 *
 * WP:    WP-UI-005  Stage D
 * Stage B ref: memory/stageB/ui-shell-composition.yaml
 * ADR:   docs/adr/0012-ui-shell-composition-strategy.md
 *
 * 사용법:
 *   const { generateShellHeader, generateDesignSystem, generateShellScript } = require('./lib/ui-shell');
 *   const header = generateShellHeader({ currentPage: '/', title: 'Workflow OS' });
 */

const fs   = require('node:fs');
const path = require('node:path');

const REPO_ROOT  = path.resolve(__dirname, '../..');
const NAV_PATH   = path.join(REPO_ROOT, 'master-shell/navigation/nav.yaml');
const FLAGS_PATH = path.join(REPO_ROOT, 'master-shell/feature-flags/flags.yaml');
const CSS_PATH   = path.join(REPO_ROOT, 'artifacts/shared/shell.css');
const JS_PATH    = path.join(REPO_ROOT, 'artifacts/shared/shell.js');

// ── Minimal YAML parsers ──────────────────────────────────────────────────────

/**
 * Parse navigation_groups from nav.yaml.
 * Returns an array of group objects, each with an `items` array.
 *
 * @param {string} text
 * @returns {Array<{ id: string, label: string, items: Array<{ plugin_id: string, label: string, route: string, feature_flag?: string }> }>}
 */
function parseNavYaml(text) {
  const groups = [];
  let currentGroup = null;
  let currentItem  = null;
  let inGroups     = false;
  let inItems      = false;

  for (const raw of text.split('\n')) {
    const line    = raw.replace(/#.*$/, '');  // strip inline comments
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === 'navigation_groups:') { inGroups = true; continue; }
    if (!inGroups) continue;

    // Top-level section reset — only zero-indent keys (line starts with a-z, not spaces/dash)
    if (/^[a-z]/.test(line) && !line.startsWith(' ') && !line.startsWith('\t') && !line.startsWith('-')) {
      inGroups = false;
      continue;
    }

    // Group start: two-space indent, dash, id key
    const gm = line.match(/^ {2}- id:\s+"([^"]+)"/);
    if (gm) {
      currentGroup = { id: gm[1], label: '', items: [] };
      groups.push(currentGroup);
      inItems     = false;
      currentItem = null;
      continue;
    }

    if (!currentGroup) continue;

    const labelG = line.match(/^ {4}label:\s+"([^"]+)"/);
    if (labelG) { currentGroup.label = labelG[1]; continue; }

    if (trimmed === 'items:') { inItems = true; continue; }

    if (inItems) {
      const im = line.match(/^ {6}- plugin_id:\s+"([^"]+)"/);
      if (im) {
        currentItem = { plugin_id: im[1], label: '', route: '', feature_flag: null };
        currentGroup.items.push(currentItem);
        continue;
      }
      if (currentItem) {
        const il = line.match(/^ {8}label:\s+"([^"]+)"/);
        if (il) { currentItem.label = il[1]; continue; }

        const ir = line.match(/^ {8}route:\s+"([^"]+)"/);
        if (ir) { currentItem.route = ir[1]; continue; }

        const iflag = line.match(/^ {8}feature_flag:\s+"([^"]+)"/);
        if (iflag) { currentItem.feature_flag = iflag[1]; continue; }
      }
    }
  }
  return groups;
}

/**
 * Parse enabled flags from flags.yaml.
 * Returns a Set of flag IDs whose value is `true`.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function parseEnabledFlags(text) {
  const enabled = new Set();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '');
    const kv   = line.match(/^\s+([a-zA-Z0-9_.:-]+):\s+true/);
    if (kv) enabled.add(kv[1]);
  }
  return enabled;
}

// ── Public generators ──────────────────────────────────────────────────────────

/**
 * Generate the common navigation header HTML string.
 *
 * Reads `master-shell/navigation/nav.yaml` and `master-shell/feature-flags/flags.yaml`
 * at call time to build a nav reflecting the current flag state.
 *
 * Items whose `feature_flag` is not enabled are rendered as disabled links
 * (aria-disabled, pointer-events: none) so the full nav structure is always visible.
 *
 * @param {{
 *   currentPage?: string,
 *   title?: string,
 * }} config
 * @returns {string}  HTML fragment — does NOT include <html>/<head>/<body> wrappers.
 */
function generateShellHeader({ currentPage = '/', title = 'Workflow OS' } = {}) {
  let navGroups   = [];
  let enabledFlags = new Set();

  try {
    navGroups = parseNavYaml(fs.readFileSync(NAV_PATH, 'utf8'));
  } catch (_) { /* nav.yaml absent — empty nav */ }

  try {
    enabledFlags = parseEnabledFlags(fs.readFileSync(FLAGS_PATH, 'utf8'));
  } catch (_) { /* flags.yaml absent — all flags treated as disabled */ }

  const allItems = navGroups.flatMap(g => g.items);

  const navLinksHtml = allItems.map(item => {
    const flagOk   = !item.feature_flag || enabledFlags.has(item.feature_flag);
    const isActive = item.route === currentPage;
    const classes  = [
      'wf-nav-link',
      isActive  ? 'wf-nav-link--active'   : '',
      !flagOk   ? 'wf-nav-link--disabled' : '',
    ].filter(Boolean).join(' ');

    return `<a href="${escapeAttr(item.route)}" class="${classes}"${!flagOk ? ' aria-disabled="true" tabindex="-1"' : ''}>${escapeHtml(item.label || item.route)}</a>`;
  }).join('\n      ');

  return `<header class="wf-shell-header" data-component="nav-header">
  <div class="wf-shell-header__brand">
    <a href="/" class="wf-shell-header__logo">${escapeHtml(title)}</a>
  </div>
  <nav class="wf-shell-header__nav" role="navigation" aria-label="주 메뉴">
      ${navLinksHtml}
  </nav>
  <div class="wf-shell-header__status">
    <span class="wf-sse-indicator wf-sse-indicator--offline"
          data-sse-indicator
          title="System OS 실시간 연결 상태"
          aria-label="실시간 연결 끊김">●</span>
  </div>
</header>`;
}

/**
 * Return an HTML fragment that loads the design system CSS.
 *
 * If `artifacts/shared/shell.css` exists it emits a <link> tag;
 * otherwise it inlines the CSS inside a <style> block.
 *
 * @returns {string}
 */
function generateDesignSystem() {
  if (fs.existsSync(CSS_PATH)) {
    return '<link rel="stylesheet" href="/shared/shell.css">';
  }
  return `<style>\n${getDesignSystemCss()}\n</style>`;
}

/**
 * Return an HTML fragment that loads the Shell JS runtime.
 *
 * If `artifacts/shared/shell.js` exists it emits a <script src> tag;
 * otherwise it inlines the JS inside a <script> block.
 *
 * @returns {string}
 */
function generateShellScript() {
  if (fs.existsSync(JS_PATH)) {
    return '<script src="/shared/shell.js"></script>';
  }
  return `<script>\n${getShellRuntimeJs()}\n</script>`;
}

// ── Inline CSS/JS fallbacks (also written to artifacts/shared/) ───────────────

/**
 * Return the complete design-system CSS string.
 * This is written verbatim to `artifacts/shared/shell.css`.
 *
 * @returns {string}
 */
function getDesignSystemCss() {
  return `/* Workflow OS Design System v1.0 — artifacts/shared/shell.css */
/* WP: WP-UI-005 | Stage: D | Generated by scripts/lib/ui-shell.js */

:root {
  --wf-color-pass:    #22c55e;
  --wf-color-fail:    #ef4444;
  --wf-color-warn:    #f59e0b;
  --wf-color-neutral: #64748b;
  --wf-color-bg:      #0f172a;
  --wf-color-surface: #1e293b;
  --wf-color-border:  #334155;
  --wf-color-text:    #f1f5f9;
  --wf-color-accent:  #6366f1;
  --wf-font-mono:     'JetBrains Mono', 'Fira Code', monospace;
  --wf-font-sans:     'Inter', system-ui, sans-serif;
  --wf-radius:        0.5rem;
  --wf-shadow:        0 2px 8px rgba(0,0,0,0.4);
  --wf-spacing-sm:    0.5rem;
  --wf-spacing-md:    1rem;
  --wf-spacing-lg:    1.5rem;
}

@media (prefers-color-scheme: light) {
  :root {
    --wf-color-bg:      #f8fafc;
    --wf-color-surface: #ffffff;
    --wf-color-border:  #e2e8f0;
    --wf-color-text:    #0f172a;
    --wf-shadow:        0 2px 8px rgba(0,0,0,0.08);
  }
}

*, *::before, *::after { box-sizing: border-box; }

body {
  background: var(--wf-color-bg);
  color: var(--wf-color-text);
  font-family: var(--wf-font-sans);
  margin: 0;
  line-height: 1.5;
}

/* ─── Shell Header ──────────────────────────────────────────── */
.wf-shell-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  background: var(--wf-color-surface);
  border-bottom: 1px solid var(--wf-color-border);
  padding: 0 var(--wf-spacing-lg);
  height: 56px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: var(--wf-shadow);
}
.wf-shell-header__brand { flex-shrink: 0; }
.wf-shell-header__logo {
  color: var(--wf-color-accent);
  font-weight: 700;
  font-size: 1.05rem;
  text-decoration: none;
  letter-spacing: -0.02em;
}
.wf-shell-header__nav {
  display: flex;
  gap: 0.25rem;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
}
.wf-shell-header__nav::-webkit-scrollbar { display: none; }
.wf-shell-header__status { flex-shrink: 0; display: flex; align-items: center; }

/* ─── Nav Links ─────────────────────────────────────────────── */
.wf-nav-link {
  color: var(--wf-color-text);
  text-decoration: none;
  padding: 0.3rem 0.7rem;
  border-radius: var(--wf-radius);
  font-size: 0.875rem;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.wf-nav-link:hover         { background: rgba(99,102,241,0.12); color: var(--wf-color-accent); }
.wf-nav-link--active       { background: rgba(99,102,241,0.18); color: var(--wf-color-accent); font-weight: 600; }
.wf-nav-link--disabled     { opacity: 0.35; cursor: not-allowed; pointer-events: none; }

/* ─── SSE Indicator ─────────────────────────────────────────── */
.wf-sse-indicator { font-size: 0.65rem; user-select: none; cursor: default; }
.wf-sse-indicator--online      { color: var(--wf-color-pass); }
.wf-sse-indicator--offline     { color: var(--wf-color-fail); animation: wf-blink 1.2s step-end infinite; }
.wf-sse-indicator--connecting  { color: var(--wf-color-warn); animation: wf-blink 0.6s step-end infinite; }
@keyframes wf-blink { 50% { opacity: 0; } }

/* ─── Page Layout ───────────────────────────────────────────── */
.wf-page       { padding: var(--wf-spacing-lg); max-width: 1400px; margin: 0 auto; }
.wf-section    { margin-bottom: var(--wf-spacing-lg); }
.wf-section__title { font-size: 1rem; font-weight: 600; margin: 0 0 var(--wf-spacing-sm); color: var(--wf-color-neutral); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.75rem; }

.wf-grid     { display: grid; gap: var(--wf-spacing-md); }
.wf-grid--2  { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.wf-grid--3  { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.wf-grid--4  { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }

/* ─── Card ──────────────────────────────────────────────────── */
.wf-card {
  background: var(--wf-color-surface);
  border: 1px solid var(--wf-color-border);
  border-radius: var(--wf-radius);
  padding: var(--wf-spacing-md);
  box-shadow: var(--wf-shadow);
  transition: border-color 0.2s;
}
.wf-card:hover       { border-color: var(--wf-color-accent); }
.wf-card__title      { font-weight: 600; margin: 0 0 var(--wf-spacing-sm); }
.wf-card__meta       { color: var(--wf-color-neutral); font-size: 0.8rem; }
.wf-card__actions    { display: flex; gap: 0.5rem; margin-top: var(--wf-spacing-sm); flex-wrap: wrap; }

/* ─── Badge ─────────────────────────────────────────────────── */
.wf-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.wf-badge--pass     { background: rgba(34,197,94,0.15);   color: var(--wf-color-pass); }
.wf-badge--fail     { background: rgba(239,68,68,0.15);   color: var(--wf-color-fail); }
.wf-badge--warn     { background: rgba(245,158,11,0.15);  color: var(--wf-color-warn); }
.wf-badge--neutral  { background: rgba(100,116,139,0.12); color: var(--wf-color-neutral); }
.wf-badge--stage    { background: rgba(99,102,241,0.15);  color: var(--wf-color-accent); }
.wf-badge--dot::before { content: '●'; margin-right: 0.3rem; font-size: 0.6rem; }

/* ─── Button ────────────────────────────────────────────────── */
.wf-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.9rem;
  border-radius: var(--wf-radius);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s, transform 0.1s;
  text-decoration: none;
  font-family: inherit;
}
.wf-btn:active       { transform: scale(0.97); }
.wf-btn--primary     { background: var(--wf-color-accent); color: #fff; }
.wf-btn--danger      { background: var(--wf-color-fail);   color: #fff; }
.wf-btn--ghost       { background: transparent; border: 1px solid var(--wf-color-border); color: var(--wf-color-text); }
.wf-btn--sm          { padding: 0.25rem 0.6rem; font-size: 0.8rem; }
.wf-btn:disabled,
.wf-btn[aria-disabled="true"] { opacity: 0.38; cursor: not-allowed; pointer-events: none; }

/* ─── Toggle Switch ─────────────────────────────────────────── */
.wf-toggle { display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer; }
.wf-toggle input[type=checkbox] {
  appearance: none;
  width: 2.25rem; height: 1.25rem;
  border-radius: 999px;
  background: var(--wf-color-border);
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}
.wf-toggle input[type=checkbox]:checked         { background: var(--wf-color-accent); }
.wf-toggle input[type=checkbox]::after {
  content: '';
  position: absolute;
  width: 1rem; height: 1rem;
  border-radius: 50%;
  background: #fff;
  top: 0.125rem; left: 0.125rem;
  transition: left 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
.wf-toggle input[type=checkbox]:checked::after  { left: 1.125rem; }
.wf-toggle input:disabled                       { opacity: 0.38; cursor: not-allowed; }

/* ─── Modal ─────────────────────────────────────────────────── */
.wf-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.65);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
  padding: var(--wf-spacing-md);
}
.wf-modal-overlay[hidden] { display: none !important; }
.wf-modal {
  background: var(--wf-color-surface);
  border: 1px solid var(--wf-color-border);
  border-radius: var(--wf-radius);
  padding: var(--wf-spacing-lg);
  max-width: 520px;
  width: 100%;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
.wf-modal__title   { font-weight: 700; font-size: 1.05rem; margin: 0 0 var(--wf-spacing-md); }
.wf-modal__body    { margin-bottom: var(--wf-spacing-md); font-size: 0.9rem; }
.wf-modal__actions { display: flex; gap: 0.5rem; justify-content: flex-end; }

/* ─── Gauge ─────────────────────────────────────────────────── */
.wf-gauge              { display: flex; flex-direction: column; gap: 0.25rem; }
.wf-gauge__label       { display: flex; justify-content: space-between; font-size: 0.8rem; }
.wf-gauge__value       { font-weight: 700; font-family: var(--wf-font-mono); }
.wf-gauge__track       { background: var(--wf-color-border); border-radius: 999px; height: 0.375rem; overflow: hidden; }
.wf-gauge__fill        { height: 100%; border-radius: 999px; transition: width 0.4s ease; background: var(--wf-color-pass); }
.wf-gauge__fill--warn  { background: var(--wf-color-warn); }
.wf-gauge__fill--fail  { background: var(--wf-color-fail); }

/* ─── Status Bar ────────────────────────────────────────────── */
.wf-status-bar {
  display: flex; gap: 1.5rem; flex-wrap: wrap;
  background: var(--wf-color-surface);
  border: 1px solid var(--wf-color-border);
  border-radius: var(--wf-radius);
  padding: var(--wf-spacing-md);
  margin-bottom: var(--wf-spacing-md);
}
.wf-status-item        { display: flex; flex-direction: column; gap: 0.15rem; }
.wf-status-item__label { font-size: 0.7rem; color: var(--wf-color-neutral); text-transform: uppercase; letter-spacing: 0.06em; }
.wf-status-item__value { font-size: 1.3rem; font-weight: 700; font-family: var(--wf-font-mono); }

/* ─── Timeline ──────────────────────────────────────────────── */
.wf-timeline  { display: flex; flex-direction: column; gap: 0.25rem; }
.wf-timeline-row {
  display: grid;
  grid-template-columns: 5rem 6rem 1fr auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.4rem 0.5rem;
  border-radius: calc(var(--wf-radius) / 2);
  font-size: 0.82rem;
  transition: background 0.15s;
}
.wf-timeline-row:hover         { background: rgba(255,255,255,0.03); }
.wf-timeline-row__time         { color: var(--wf-color-neutral); font-family: var(--wf-font-mono); font-size: 0.72rem; }
.wf-timeline-row__domain       { }
.wf-timeline-row__action       { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-timeline-row__hash         { font-family: var(--wf-font-mono); font-size: 0.7rem; color: var(--wf-color-neutral); }

/* ─── Quality Gate Matrix ───────────────────────────────────── */
.wf-matrix { border-collapse: collapse; width: 100%; font-size: 0.82rem; }
.wf-matrix th {
  background: var(--wf-color-surface);
  border: 1px solid var(--wf-color-border);
  padding: 0.4rem 0.6rem;
  text-align: center;
  font-weight: 600;
  font-size: 0.72rem;
  color: var(--wf-color-neutral);
}
.wf-matrix td {
  border: 1px solid var(--wf-color-border);
  padding: 0.4rem 0.6rem;
  text-align: center;
}
.wf-matrix td.pass { background: rgba(34,197,94,0.1);  color: var(--wf-color-pass); font-weight: 700; }
.wf-matrix td.fail { background: rgba(239,68,68,0.1);  color: var(--wf-color-fail); font-weight: 700; cursor: pointer; }
.wf-matrix td.skip { background: rgba(100,116,139,0.05); color: var(--wf-color-neutral); }

/* ─── Toast ─────────────────────────────────────────────────── */
.wf-toast-container {
  position: fixed; bottom: 1.5rem; right: 1.5rem;
  z-index: 2000;
  display: flex; flex-direction: column; gap: 0.5rem;
  pointer-events: none;
}
.wf-toast {
  background: var(--wf-color-surface);
  border: 1px solid var(--wf-color-border);
  border-radius: var(--wf-radius);
  padding: 0.7rem 1rem;
  font-size: 0.875rem;
  box-shadow: var(--wf-shadow);
  pointer-events: all;
  animation: wf-slide-in 0.2s ease;
  max-width: 320px;
}
.wf-toast--pass { border-left: 3px solid var(--wf-color-pass); }
.wf-toast--fail { border-left: 3px solid var(--wf-color-fail); }
.wf-toast--warn { border-left: 3px solid var(--wf-color-warn); }
@keyframes wf-slide-in { from { transform: translateX(110%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

/* ─── Loading Skeleton ──────────────────────────────────────── */
.wf-skeleton {
  background: linear-gradient(90deg,
    var(--wf-color-surface) 25%,
    rgba(255,255,255,0.04) 50%,
    var(--wf-color-surface) 75%);
  background-size: 200% 100%;
  animation: wf-shimmer 1.5s infinite;
  border-radius: var(--wf-radius);
}
@keyframes wf-shimmer { to { background-position: -200% 0; } }

/* ─── Pipeline Bar (lifecycle) ──────────────────────────────── */
.wf-pipeline { display: flex; gap: 0.25rem; align-items: center; }
.wf-pipeline-stage {
  display: flex; align-items: center; justify-content: center;
  width: 2rem; height: 2rem;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 700;
  border: 2px solid var(--wf-color-border);
  cursor: default;
  transition: border-color 0.2s, background 0.2s;
}
.wf-pipeline-stage--pass    { background: rgba(34,197,94,0.2);  border-color: var(--wf-color-pass); color: var(--wf-color-pass); }
.wf-pipeline-stage--current { background: rgba(99,102,241,0.2); border-color: var(--wf-color-accent); color: var(--wf-color-accent); animation: wf-pulse 2s ease-in-out infinite; }
.wf-pipeline-stage--pending { color: var(--wf-color-neutral); }
.wf-pipeline-arrow          { color: var(--wf-color-border); font-size: 0.7rem; }
@keyframes wf-pulse { 50% { box-shadow: 0 0 0 4px rgba(99,102,241,0.2); } }

/* ─── Responsive ────────────────────────────────────────────── */
@media (max-width: 768px) {
  .wf-shell-header          { padding: 0 var(--wf-spacing-md); }
  .wf-nav-link              { padding: 0.3rem 0.5rem; font-size: 0.8rem; }
  .wf-grid--2,
  .wf-grid--3,
  .wf-grid--4               { grid-template-columns: 1fr; }
  .wf-timeline-row          { grid-template-columns: 4rem 1fr; }
  .wf-timeline-row__domain,
  .wf-timeline-row__hash    { display: none; }
  .wf-status-bar            { gap: 1rem; }
}`;
}

/**
 * Return the complete Shell JS runtime string.
 * This is written verbatim to `artifacts/shared/shell.js`.
 *
 * @returns {string}
 */
function getShellRuntimeJs() {
  return `/* Workflow OS Shell Runtime v1.0 — artifacts/shared/shell.js
 * WP: WP-UI-005 | Stage: D | Generated by scripts/lib/ui-shell.js
 * Requires: artifacts/shared/shell.css
 * Contract: contracts/system-api/events.schema.json (CloudEvents 1.0)
 */
(function (root) {
  'use strict';

  root.WfShell = root.WfShell || {};
  var WfShell = root.WfShell;

  // ── Toast ───────────────────────────────────────────────────────────────────
  WfShell.toast = function (message, type) {
    type = type || 'pass';
    var container = document.querySelector('.wf-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'wf-toast-container';
      document.body.appendChild(container);
    }
    var el = document.createElement('div');
    el.className = 'wf-toast wf-toast--' + type;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  };

  // ── SSE ─────────────────────────────────────────────────────────────────────
  var _src          = null;
  var _handlers     = {};   // { eventType: [fn, ...] }
  var _retryCount   = 0;
  var _retryDelay   = 1000; // ms, doubles on each failure (max 30 s)
  var _connected    = false;
  var _connectUrl   = '/api/v1/system/events';
  var _SSE_TYPES    = [
    'system.health.updated',
    'system.flag.toggled',
    'system.rollback.triggered',
    'system.quality-gate.updated',
    'system.domain.lifecycle-changed',
  ];
  var MAX_RETRIES   = 10;
  var MAX_DELAY_MS  = 30000;

  function _setIndicator(state) {
    _connected = (state === 'online');
    document.querySelectorAll('[data-sse-indicator]').forEach(function (el) {
      el.className = 'wf-sse-indicator wf-sse-indicator--' + state;
      var labels = { online: 'System OS 연결됨', offline: 'System OS 연결 끊김', connecting: 'System OS 재연결 중...' };
      el.title = labels[state] || state;
      el.setAttribute('aria-label', el.title);
    });
  }

  function _dispatch(data) {
    var type = data.type || (data.data && data.data.type);
    [type, '*'].forEach(function (t) {
      if (t && _handlers[t]) {
        _handlers[t].forEach(function (fn) {
          try { fn(data); } catch (e) { console.error('[WfShell SSE handler error]', t, e); }
        });
      }
    });
  }

  WfShell.sse = {
    /** @param {string} [url]  Defaults to /api/v1/system/events */
    connect: function (url) {
      _connectUrl = url || _connectUrl;
      if (_src) { _src.close(); _src = null; }
      _setIndicator('connecting');

      if (!root.EventSource) {
        console.warn('[WfShell] EventSource not supported');
        _setIndicator('offline');
        return;
      }

      try { _src = new EventSource(_connectUrl); }
      catch (e) { _setIndicator('offline'); return; }

      _src.onopen = function () {
        _retryCount  = 0;
        _retryDelay  = 1000;
        _setIndicator('online');
      };

      _src.onerror = function () {
        _setIndicator('offline');
        _src.close(); _src = null;
        if (_retryCount < MAX_RETRIES) {
          _retryCount++;
          _retryDelay = Math.min(_retryDelay * 2, MAX_DELAY_MS);
          WfShell.toast('재연결 중... (' + _retryCount + '/' + MAX_RETRIES + ')', 'warn');
          setTimeout(function () { WfShell.sse.connect(); }, _retryDelay);
        } else {
          WfShell.toast('실시간 연결 실패 — 페이지를 새로고침하세요', 'fail');
        }
      };

      // Generic onmessage (data: JSON without event: field)
      _src.onmessage = function (e) {
        try { _dispatch(JSON.parse(e.data)); } catch (_) {}
      };

      // Named CloudEvents listeners
      _SSE_TYPES.forEach(function (evtType) {
        _src.addEventListener(evtType, function (e) {
          try { _dispatch(JSON.parse(e.data)); } catch (_) {}
        });
      });
    },

    /** Register a handler for a specific SSE event type (or '*' for all). */
    on: function (eventType, handler) {
      if (!_handlers[eventType]) _handlers[eventType] = [];
      _handlers[eventType].push(handler);
    },

    off: function (eventType, handler) {
      if (!_handlers[eventType]) return;
      _handlers[eventType] = _handlers[eventType].filter(function (fn) { return fn !== handler; });
    },

    disconnect: function () {
      if (_src) { _src.close(); _src = null; }
      _setIndicator('offline');
    },

    isConnected: function () { return _connected; },
  };

  // ── Permissions ──────────────────────────────────────────────────────────────
  WfShell.permissions = {
    _role: null,

    /** Call after loading the page with the current user's role. */
    setRole: function (role) {
      this._role = role;
      this._applyToDOM();
    },

    can: function (permission) {
      if (this._role === 'system.admin') return true;
      if (permission === 'system.viewer' || permission === 'domain.viewer') {
        return ['system.viewer', 'domain.viewer', 'system.admin'].includes(this._role);
      }
      return false;
    },

    _applyToDOM: function () {
      var self = this;
      document.querySelectorAll('[data-require-permission]').forEach(function (el) {
        el.hidden = !self.can(el.getAttribute('data-require-permission'));
      });
      document.querySelectorAll('[data-disable-without-permission]').forEach(function (el) {
        var perm = el.getAttribute('data-disable-without-permission');
        if (!self.can(perm)) {
          el.disabled = true;
          el.setAttribute('aria-disabled', 'true');
          el.title = '이 작업에는 ' + perm + ' 권한이 필요합니다';
        }
      });
    },
  };

  // ── Built-in SSE → DOM handlers ──────────────────────────────────────────────

  // system.health.updated → update health gauge + score for matching domain cards
  WfShell.sse.on('system.health.updated', function (payload) {
    var d     = payload.data || {};
    var domId = d.domain_id;
    var score = d.score;
    if (!domId || score === undefined) return;

    document.querySelectorAll('[data-domain-id="' + domId + '"]').forEach(function (card) {
      var fill  = card.querySelector('.wf-gauge__fill');
      var label = card.querySelector('[data-health-score]');
      if (fill)  fill.style.width = score + '%';
      if (label) label.textContent = score;

      // Update fill class based on score
      if (fill) {
        fill.classList.toggle('wf-gauge__fill--warn', score < 70 && score >= 50);
        fill.classList.toggle('wf-gauge__fill--fail', score < 50);
      }
    });
  });

  // system.flag.toggled → update toggle switch in flag panel
  WfShell.sse.on('system.flag.toggled', function (payload) {
    var d = payload.data || {};
    if (!d.flag_id) return;

    document.querySelectorAll('[data-flag-id="' + d.flag_id + '"]').forEach(function (el) {
      var input = el.querySelector('input[type=checkbox]') || el;
      if (input && input.type === 'checkbox') {
        input.checked = Boolean(d.enabled);
      }
      // Update dot indicators
      el.querySelectorAll('[data-flag-dot]').forEach(function (dot) {
        dot.style.color = d.enabled
          ? 'var(--wf-color-pass)'
          : 'var(--wf-color-neutral)';
      });
    });
    WfShell.toast((d.enabled ? '활성화' : '비활성화') + ': ' + d.flag_id, 'pass');
  });

  // system.rollback.triggered → show toast
  WfShell.sse.on('system.rollback.triggered', function (payload) {
    var d = payload.data || {};
    WfShell.toast('롤백 시작: ' + (d.domain || '알 수 없음'), 'warn');
  });

  // system.quality-gate.updated → append to quality timeline if present
  WfShell.sse.on('system.quality-gate.updated', function (payload) {
    var d = payload.data || {};
    var timeline = document.querySelector('[data-quality-timeline]');
    if (!timeline) return;

    var row = document.createElement('div');
    row.className = 'wf-timeline-row';
    row.innerHTML =
      '<span class="wf-timeline-row__time">방금</span>' +
      '<span class="wf-timeline-row__domain">' + (d.domain || 'system') + '</span>' +
      '<span class="wf-timeline-row__action">' + (d.gate_id || '') + '</span>' +
      '<span class="wf-badge wf-badge--' + (d.result === 'PASS' ? 'pass' : 'fail') + '">' + (d.result || '') + '</span>';
    timeline.prepend(row);
  });

  // ── Confirmation modal helper ────────────────────────────────────────────────
  /**
   * Show a confirmation modal with a required text input.
   * Resolves true if confirmed, false if cancelled.
   *
   * @param {{ title: string, body: string, confirmText: string, dangerLabel?: string }} opts
   * @returns {Promise<boolean>}
   */
  WfShell.confirm = function (opts) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'wf-modal-overlay';
      overlay.innerHTML =
        '<div class="wf-modal" role="dialog" aria-modal="true">' +
        '  <div class="wf-modal__title">' + _esc(opts.title) + '</div>' +
        '  <div class="wf-modal__body">' + _esc(opts.body) + '</div>' +
        '  <input type="text" class="wf-modal__confirm-input" placeholder="' + _esc(opts.confirmText) + '" autocomplete="off" style="width:100%;margin-bottom:.75rem;padding:.4rem .6rem;background:var(--wf-color-bg);border:1px solid var(--wf-color-border);color:var(--wf-color-text);border-radius:var(--wf-radius);font-size:.875rem;">' +
        '  <div class="wf-modal__actions">' +
        '    <button class="wf-btn wf-btn--ghost wf-modal__cancel">취소</button>' +
        '    <button class="wf-btn wf-btn--danger wf-modal__execute" disabled>' + _esc(opts.dangerLabel || '실행') + '</button>' +
        '  </div>' +
        '</div>';
      document.body.appendChild(overlay);

      var input   = overlay.querySelector('.wf-modal__confirm-input');
      var execBtn = overlay.querySelector('.wf-modal__execute');
      var cancelBtn = overlay.querySelector('.wf-modal__cancel');

      input.addEventListener('input', function () {
        execBtn.disabled = input.value !== opts.confirmText;
      });
      execBtn.addEventListener('click', function () {
        overlay.remove(); resolve(true);
      });
      cancelBtn.addEventListener('click', function () {
        overlay.remove(); resolve(false);
      });
      overlay.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { overlay.remove(); resolve(false); }
      });
      input.focus();
    });
  };

  function _esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Auto-connect ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var trigger = document.querySelector('[data-sse-connect]');
    if (trigger) {
      WfShell.sse.connect(trigger.getAttribute('data-sse-connect') || undefined);
    }
  });

}(typeof globalThis !== 'undefined' ? globalThis : window));`;
}

// ── HTML escape helpers ───────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Primary API
  generateShellHeader,
  generateDesignSystem,
  generateShellScript,
  // Internals (exported for testing)
  parseNavYaml,
  parseEnabledFlags,
  getDesignSystemCss,
  getShellRuntimeJs,
  escapeHtml,
  escapeAttr,
};
