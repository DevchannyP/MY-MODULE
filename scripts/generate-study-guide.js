#!/usr/bin/env node
// scripts/generate-study-guide.js
// 학습 최적화 HTML 스터디 가이드 생성기
// 외부 의존성 없음 — Node.js 내장 모듈만 사용

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'artifacts', 'study-guide');
const OUT_FILE = path.join(OUT_DIR, 'index.html');

// ---------------------------------------------------------------------------
// YAML 파서 (경량 구현 — 외부 라이브러리 금지)
// ---------------------------------------------------------------------------
function parseYaml(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ obj: root, indent: -1, lastKey: undefined, isArray: false }];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.replace(/\s*#.*$/, '').trimEnd();
    i++;
    if (!trimmed.trim()) continue;

    const indent = trimmed.length - trimmed.trimStart().length;
    const content = trimmed.trimStart();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const frame = stack[stack.length - 1];
    const parent = frame.obj;

    if (content.startsWith('- ')) {
      const val = content.slice(2).trim();
      // Find nearest array ancestor in stack
      let arrFrame = null;
      for (let j = stack.length - 1; j >= 0; j--) {
        if (Array.isArray(stack[j].obj)) { arrFrame = stack[j]; break; }
      }
      if (arrFrame) {
        if (val.includes(': ')) {
          const itemObj = {};
          const cidx = val.indexOf(': ');
          const k = val.slice(0, cidx).trim();
          const v = parseScalar(val.slice(cidx + 2).trim());
          itemObj[k] = v;
          arrFrame.obj.push(itemObj);
          stack.push({ obj: itemObj, indent, lastKey: k, isArray: false });
        } else if (val === '') {
          const itemObj = {};
          arrFrame.obj.push(itemObj);
          stack.push({ obj: itemObj, indent, lastKey: undefined, isArray: false });
        } else {
          arrFrame.obj.push(parseScalar(val));
        }
      }
    } else if (content.includes(': ')) {
      const colonIdx = content.indexOf(': ');
      const key = content.slice(0, colonIdx).trim();
      const val = content.slice(colonIdx + 2).trim();

      if (val === '' || val === '|' || val === '>') {
        if (val === '|' || val === '>') {
          const blockLines = [];
          while (i < lines.length) {
            const nextRaw = lines[i];
            const nextIndent = nextRaw.length - nextRaw.trimStart().length;
            if (nextRaw.trim() === '' || nextIndent > indent) {
              blockLines.push(nextRaw.trimEnd());
              i++;
            } else { break; }
          }
          parent[key] = blockLines.map(l => l.trimStart()).join('\n').trim();
          frame.lastKey = key;
        } else {
          parent[key] = {};
          frame.lastKey = key;
          stack.push({ obj: parent[key], indent, lastKey: undefined, isArray: false });
        }
      } else if (val.startsWith('[')) {
        parent[key] = parseInlineArray(val);
        frame.lastKey = key;
      } else {
        parent[key] = parseScalar(val);
        frame.lastKey = key;
      }
    } else if (content.endsWith(':')) {
      const key = content.slice(0, -1).trim();
      const nextLine = (lines[i] || '').trimStart();
      if (nextLine.startsWith('- ') || nextLine === '-') {
        parent[key] = [];
        frame.lastKey = key;
        stack.push({ obj: parent[key], indent, lastKey: key, isArray: true });
      } else {
        parent[key] = {};
        frame.lastKey = key;
        stack.push({ obj: parent[key], indent, lastKey: undefined, isArray: false });
      }
    }
  }
  return root;
}

function parseScalar(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~') return null;
  const num = Number(val);
  if (!Number.isNaN(num) && val !== '') return num;
  return val.replace(/^["']|["']$/g, '');
}

function parseInlineArray(val) {
  const inner = val.replace(/^\[|\]$/g, '').trim();
  if (!inner) return [];
  return inner.split(',').map(s => parseScalar(s.trim()));
}

// ---------------------------------------------------------------------------
// Markdown ADR パーサー — 맥락/결정/결과 섹션 추출
// ---------------------------------------------------------------------------
function parseAdrMarkdown(text) {
  const result = {
    title: '',
    date: '',
    status: '',
    context: '',
    decision: '',
    consequences: '',
  };

  const lines = text.split('\n');
  let section = null;
  const sectionBuf = {};

  for (const line of lines) {
    if (line.startsWith('# ')) {
      result.title = line.slice(2).trim();
      continue;
    }
    const dateMatch = line.match(/\*\*날짜\*\*[:\s]+(.+)/);
    if (dateMatch) { result.date = dateMatch[1].trim(); continue; }
    const statusMatch = line.match(/\*\*상태\*\*[:\s]+(.+)/);
    if (statusMatch) { result.status = statusMatch[1].trim(); continue; }

    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim();
      if (heading === '맥락') { section = 'context'; continue; }
      if (heading === '결정') { section = 'decision'; continue; }
      if (heading === '결과') { section = 'consequences'; continue; }
      section = heading;
      continue;
    }

    if (section && ['context', 'decision', 'consequences'].includes(section)) {
      sectionBuf[section] = (sectionBuf[section] || '') + line + '\n';
    }
  }

  result.context = (sectionBuf['context'] || '').trim();
  result.decision = (sectionBuf['decision'] || '').trim();
  result.consequences = (sectionBuf['consequences'] || '').trim();

  return result;
}

// Minimal markdown → HTML
function mdToHtml(md) {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // code blocks
  html = html.replace(/```[\s\S]*?```/g, m => {
    const inner = m.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
    return `<pre><code>${inner}</code></pre>`;
  });
  // inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // list items
  const lines = html.split('\n');
  const out = [];
  let inList = false;
  for (const ln of lines) {
    if (ln.match(/^- (.+)/)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${ln.slice(2)}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (ln.trim()) out.push(`<p>${ln}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 데이터 로더
// ---------------------------------------------------------------------------
function safeReadYaml(filePath) {
  try {
    return parseYaml(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function loadAdrs(adrDir, adrIndex) {
  const adrs = [];
  const entries = (adrIndex && Array.isArray(adrIndex.adrs)) ? adrIndex.adrs : [];
  for (const entry of entries) {
    const filePath = path.join(adrDir, entry.file || '');
    const text = safeReadText(filePath);
    if (!text) continue;
    const parsed = parseAdrMarkdown(text);
    adrs.push({
      id: entry.id || '',
      file: entry.file || '',
      title: parsed.title || entry.title || '',
      date: parsed.date || '',
      status: parsed.status || String(entry.status || ''),
      context: parsed.context,
      decision: parsed.decision,
      consequences: parsed.consequences,
    });
  }
  return adrs;
}

function loadCapabilities() {
  const capabilityPaths = [
    { domain: 'task-management', name: '작업 관리', relPath: 'domains/productivity/task-tracking/contract/capability.yaml' },
    { domain: 'billing', name: '청구 관리', relPath: 'domains/billing/contracts/capability.yaml' },
    { domain: 'video', name: '비디오 관리', relPath: 'domains/video/contract/capability.yaml' },
  ];

  const result = [];
  for (const entry of capabilityPaths) {
    const data = safeReadYaml(path.join(ROOT, entry.relPath));
    if (!data) continue;
    result.push({
      domain: entry.domain,
      name: data.name || data.module_key || entry.name,
      description: data.description || '',
      capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
      events_emitted: Array.isArray(data.events_emitted) ? data.events_emitted : [],
      invariants: Array.isArray(data.invariants) ? data.invariants : [],
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// HTML 렌더러
// ---------------------------------------------------------------------------
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function levelBadge(level) {
  const map = {
    foundation: { label: '기초', color: '#388bfd' },
    apprentice: { label: '견습', color: '#3fb950' },
    practitioner: { label: '실무', color: '#d29922' },
    mastery: { label: '숙련', color: '#f85149' },
  };
  const m = map[level] || { label: level, color: '#8b949e' };
  return `<span class="badge" style="background:${m.color}20;color:${m.color};border:1px solid ${m.color}40">${m.label}</span>`;
}

function renderMilestones(masteryMap) {
  if (!masteryMap || !Array.isArray(masteryMap.milestones)) {
    return '<p class="empty">학습 로드맵 데이터를 찾을 수 없습니다.</p>';
  }

  const levelOrder = ['foundation', 'apprentice', 'practitioner', 'mastery'];
  const grouped = {};
  for (const m of masteryMap.milestones) {
    const lv = m.level || 'foundation';
    if (!grouped[lv]) grouped[lv] = [];
    grouped[lv].push(m);
  }

  let html = '';
  for (const lv of levelOrder) {
    if (!grouped[lv]) continue;
    const lvLabel = { foundation: '기초', apprentice: '견습', practitioner: '실무', mastery: '숙련' }[lv] || lv;
    html += `<div class="level-group">
      <h3 class="level-title">${levelBadge(lv)} ${escHtml(lvLabel)} 단계</h3>`;
    for (const ms of grouped[lv]) {
      const prereqs = Array.isArray(ms.prerequisites) && ms.prerequisites.length
        ? `<div class="prereq">선행 조건: ${ms.prerequisites.map(p => escHtml(p)).join(', ')}</div>`
        : '';
      const proofs = Array.isArray(ms.proof) && ms.proof.length
        ? `<ul class="proof-list">${ms.proof.map(p => `<li>${escHtml(p)}</li>`).join('')}</ul>`
        : '';
      html += `<div class="milestone-card">
        <div class="ms-header">
          <span class="ms-id">${escHtml(ms.id || '')}</span>
          <span class="ms-title">${escHtml(ms.title || '')}</span>
        </div>
        <p class="ms-objective">${escHtml(ms.objective || '')}</p>
        ${prereqs}
        ${proofs ? `<div class="proof-section"><strong>증명 방법</strong>${proofs}</div>` : ''}
      </div>`;
    }
    html += '</div>';
  }
  return html;
}

function renderAdrs(adrs) {
  if (!adrs || adrs.length === 0) {
    return '<p class="empty">ADR 데이터를 찾을 수 없습니다.</p>';
  }
  let html = '';
  for (const adr of adrs) {
    const statusLower = (adr.status || '').toLowerCase();
    const statusClass = statusLower.includes('수락') || statusLower.includes('accepted')
      ? 'status-accepted'
      : statusLower.includes('archived') ? 'status-archived' : 'status-other';
    html += `<div class="adr-card">
      <div class="adr-header">
        <span class="adr-num">ADR-${escHtml(adr.id)}</span>
        <span class="adr-title">${escHtml(adr.title)}</span>
        <span class="adr-status ${statusClass}">${escHtml(adr.status || '미정')}</span>
      </div>
      ${adr.date ? `<div class="adr-date">날짜: ${escHtml(adr.date)}</div>` : ''}
      <div class="adr-sections">
        <div class="adr-section">
          <h4>상황 (맥락)</h4>
          <div class="adr-content">${mdToHtml(adr.context) || '<em>내용 없음</em>'}</div>
        </div>
        <div class="adr-section">
          <h4>결정</h4>
          <div class="adr-content">${mdToHtml(adr.decision) || '<em>내용 없음</em>'}</div>
        </div>
        <div class="adr-section">
          <h4>결과</h4>
          <div class="adr-content">${mdToHtml(adr.consequences) || '<em>내용 없음</em>'}</div>
        </div>
      </div>
    </div>`;
  }
  return html;
}

function renderCapabilities(domains) {
  if (!domains || domains.length === 0) {
    return '<p class="empty">도메인 역량 데이터를 찾을 수 없습니다.</p>';
  }
  let html = '';
  for (const d of domains) {
    const caps = d.capabilities;
    const capRows = caps.map(c => {
      const typeLabel = c.type === 'command' ? '커맨드' : c.type === 'query' ? '쿼리' : (c.type || '-');
      const typeClass = c.type === 'command' ? 'type-command' : 'type-query';
      const perms = Array.isArray(c.permissions_required)
        ? c.permissions_required
        : Array.isArray(c.required_permissions) ? c.required_permissions : [];
      const invs = Array.isArray(c.invariants) ? c.invariants : [];
      return `<tr>
        <td><strong>${escHtml(c.id || c.name || '')}</strong><br><small>${escHtml(c.description || '')}</small></td>
        <td><span class="type-badge ${typeClass}">${typeLabel}</span></td>
        <td>${perms.map(p => `<code>${escHtml(String(p))}</code>`).join(' ')}</td>
        <td>${invs.map(inv => `<code>${escHtml(String(inv))}</code>`).join(' ')}</td>
      </tr>`;
    }).join('');

    const events = d.events_emitted.map(e => `<code>${escHtml(typeof e === 'string' ? e : JSON.stringify(e))}</code>`).join(' ');
    const domainInvs = Array.isArray(d.invariants) ? d.invariants : [];

    html += `<div class="domain-card">
      <div class="domain-header">
        <span class="domain-key">${escHtml(d.domain)}</span>
        <span class="domain-name">${escHtml(d.name)}</span>
      </div>
      ${d.description ? `<p class="domain-desc">${escHtml(d.description)}</p>` : ''}
      ${caps.length > 0 ? `<table class="cap-table">
        <thead><tr><th>역량 ID / 설명</th><th>유형</th><th>필요 권한</th><th>불변조건</th></tr></thead>
        <tbody>${capRows}</tbody>
      </table>` : ''}
      ${domainInvs.length > 0 ? `<div class="domain-invs">
        <strong>도메인 불변조건</strong>
        <ul>${domainInvs.map(inv => `<li><code>${escHtml(inv.id || '')}</code> ${escHtml(inv.description || '')}</li>`).join('')}</ul>
      </div>` : ''}
      ${events ? `<div class="domain-events"><strong>발행 이벤트</strong><br>${events}</div>` : ''}
    </div>`;
  }
  return html;
}

function renderLessons(lessonsData) {
  if (!lessonsData || !Array.isArray(lessonsData.lessons) || lessonsData.lessons.length === 0) {
    return '<p class="empty">아직 등록된 교훈이 없습니다. Reflexion Loop가 실행되면 자동으로 채워집니다.</p>';
  }
  let html = '';
  for (const lesson of lessonsData.lessons) {
    html += `<div class="lesson-card">
      <div class="lesson-header">${escHtml(lesson.title || lesson.id || '교훈')}</div>
      <p>${escHtml(lesson.description || lesson.content || JSON.stringify(lesson))}</p>
    </div>`;
  }
  return html;
}

// ---------------------------------------------------------------------------
// HTML 템플릿
// ---------------------------------------------------------------------------
function buildHtml(opts) {
  const {
    milestones,
    adrs,
    capabilities,
    lessons,
    generatedAt,
    summary,
  } = opts;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Workflow OS 학습 가이드</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #f5efe4;
    --bg-card: #fffdf8;
    --bg-card2: #fbf6ec;
    --border: #ddcfb9;
    --text: #1f2937;
    --text-muted: #667085;
    --accent: #0f766e;
    --accent-light: #1d4ed8;
    --green: #0f766e;
    --yellow: #b45309;
    --red: #c2410c;
    --sidebar-w: 260px;
    --shadow: 0 18px 40px rgba(66, 51, 32, 0.08);
  }

  html { scroll-behavior: smooth; }

  body {
    background:
      radial-gradient(circle at top left, rgba(15,118,110,0.13), transparent 20%),
      linear-gradient(180deg, #fcf8f0 0%, var(--bg) 100%);
    color: var(--text);
    font-family: "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    font-size: 14px;
    line-height: 1.65;
    display: flex;
    min-height: 100vh;
  }

  nav#sidebar {
    position: fixed;
    top: 0;
    left: 0;
    width: var(--sidebar-w);
    height: 100vh;
    background: var(--bg-card);
    border-right: 1px solid var(--border);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    z-index: 100;
    box-shadow: var(--shadow);
  }

  .sidebar-logo {
    padding: 24px 18px 16px;
    font-size: 14px;
    font-weight: 800;
    color: var(--accent);
    letter-spacing: -0.02em;
    border-bottom: 1px solid var(--border);
  }

  .sidebar-logo small {
    display: block;
    font-weight: 500;
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  nav#sidebar ul {
    list-style: none;
    padding: 8px 0;
    flex: 1;
  }

  nav#sidebar ul li a {
    display: block;
    padding: 10px 18px;
    color: var(--text-muted);
    text-decoration: none;
    font-size: 13px;
    transition: color 0.15s, background 0.15s;
    border-left: 3px solid transparent;
  }

  nav#sidebar ul li a:hover,
  nav#sidebar ul li a.active {
    color: var(--text);
    background: rgba(29,78,216,0.08);
    border-left-color: var(--accent-light);
  }

  .sidebar-footer {
    padding: 12px 16px;
    font-size: 11px;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
  }

  main {
    margin-left: var(--sidebar-w);
    flex: 1;
    padding: 28px 40px 56px;
    max-width: 1160px;
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    margin-bottom: 18px;
    padding: 14px 18px;
    border-radius: 999px;
    background: rgba(255, 253, 248, 0.9);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    position: sticky;
    top: 16px;
    z-index: 40;
    backdrop-filter: blur(10px);
  }

  .topbar strong { display: block; }
  .topbar span { color: var(--text-muted); font-size: 12px; }

  .topbar-links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .topbar-links a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
    font-size: 13px;
    font-weight: 700;
    background: white;
  }

  .hero {
    background: linear-gradient(135deg, rgba(255,255,255,0.92), rgba(249,241,226,0.96));
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    border-radius: 26px;
    padding: 32px;
    margin-bottom: 24px;
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
    font-weight: 800;
    margin-bottom: 16px;
  }

  .page-title {
    font-size: 38px;
    font-weight: 800;
    color: var(--text);
    margin-bottom: 8px;
    letter-spacing: -0.04em;
  }

  .page-subtitle {
    color: var(--text-muted);
    font-size: 16px;
    line-height: 1.75;
  }

  .overview-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-top: 22px;
  }

  .overview-card {
    background: rgba(255,255,255,0.88);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 16px;
  }

  .overview-card span {
    display: block;
    color: var(--text-muted);
    font-size: 12px;
    margin-bottom: 6px;
  }

  .overview-card strong {
    font-size: 28px;
    letter-spacing: -0.04em;
  }

  section { margin-bottom: 64px; }

  section h2 {
    font-size: 23px;
    font-weight: 700;
    color: var(--accent-light);
    border-bottom: 1px solid var(--border);
    padding-bottom: 10px;
    margin-bottom: 24px;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    margin-right: 6px;
  }

  .level-group { margin-bottom: 28px; }

  .level-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-muted);
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .milestone-card,
  .adr-card,
  .domain-card,
  .lesson-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
  }

  .milestone-card {
    padding: 16px 20px;
    margin-bottom: 12px;
    transition: border-color 0.15s, transform 0.15s;
  }

  .milestone-card:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }

  .ms-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 8px;
  }

  .ms-id {
    font-family: "JetBrains Mono", "D2Coding", monospace;
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-card2);
    padding: 2px 6px;
    border-radius: 6px;
  }

  .ms-title { font-size: 15px; font-weight: 700; color: var(--text); }
  .ms-objective { color: var(--text-muted); font-size: 13px; margin-bottom: 8px; }
  .prereq { font-size: 12px; color: var(--yellow); margin-bottom: 8px; }
  .proof-section { margin-top: 10px; }
  .proof-section strong { font-size: 12px; color: var(--text-muted); }
  .proof-list { margin-top: 6px; padding-left: 20px; }
  .proof-list li { font-size: 13px; color: var(--text); margin-bottom: 4px; }

  .adr-card {
    padding: 20px 24px;
    margin-bottom: 20px;
  }

  .adr-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }

  .adr-num {
    font-family: "JetBrains Mono", "D2Coding", monospace;
    font-size: 12px;
    color: var(--accent-light);
    background: rgba(29,78,216,0.08);
    padding: 2px 8px;
    border-radius: 6px;
    border: 1px solid rgba(29,78,216,0.18);
  }

  .adr-title { font-size: 16px; font-weight: 700; color: var(--text); flex: 1; }

  .adr-status {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 700;
  }

  .status-accepted { background: rgba(15,118,110,0.1); color: var(--green); border: 1px solid rgba(15,118,110,0.18); }
  .status-archived { background: rgba(102,112,133,0.1); color: var(--text-muted); border: 1px solid var(--border); }
  .status-other    { background: rgba(180,83,9,0.1); color: var(--yellow); border: 1px solid rgba(180,83,9,0.18); }

  .adr-date { font-size: 12px; color: var(--text-muted); margin-bottom: 16px; }

  .adr-sections {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
  }

  .adr-section {
    background: var(--bg-card2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
  }

  .adr-section h4 {
    font-size: 12px;
    font-weight: 800;
    color: var(--accent-light);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }

  .adr-content { font-size: 13px; color: var(--text); }
  .adr-content p { margin-bottom: 8px; }
  .adr-content ul { padding-left: 18px; margin-bottom: 8px; }
  .adr-content li { margin-bottom: 4px; }
  .adr-content pre { background: #f4ecdd; padding: 10px; border-radius: 8px; overflow-x: auto; font-size: 12px; margin: 8px 0; }
  .adr-content code { background: rgba(180,83,9,0.1); padding: 1px 4px; border-radius: 6px; font-family: "JetBrains Mono", "D2Coding", monospace; font-size: 12px; }
  .adr-content pre code { background: transparent; padding: 0; }
  .adr-content em { color: var(--text-muted); }

  .domain-card {
    padding: 20px 24px;
    margin-bottom: 20px;
  }

  .domain-header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }

  .domain-key {
    font-family: "JetBrains Mono", "D2Coding", monospace;
    font-size: 12px;
    background: rgba(15,118,110,0.1);
    color: var(--green);
    border: 1px solid rgba(15,118,110,0.18);
    padding: 2px 8px;
    border-radius: 6px;
  }

  .domain-name { font-size: 16px; font-weight: 700; }
  .domain-desc { font-size: 13px; color: var(--text-muted); margin-bottom: 14px; }

  .cap-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    margin-bottom: 14px;
  }

  .cap-table th {
    text-align: left;
    padding: 8px 12px;
    background: var(--bg-card2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .cap-table td {
    padding: 10px 12px;
    border: 1px solid var(--border);
    vertical-align: top;
  }

  .cap-table tr:hover td { background: rgba(255,255,255,0.65); }

  .cap-table code,
  .domain-invs code,
  .domain-events code {
    background: rgba(180,83,9,0.1);
    padding: 1px 5px;
    border-radius: 6px;
    font-size: 11px;
    font-family: "JetBrains Mono", "D2Coding", monospace;
  }

  .type-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 700;
  }

  .type-command { background: rgba(194,65,12,0.1); color: var(--red); border: 1px solid rgba(194,65,12,0.18); }
  .type-query { background: rgba(29,78,216,0.1); color: var(--accent-light); border: 1px solid rgba(29,78,216,0.18); }

  .domain-invs, .domain-events {
    font-size: 13px;
    margin-top: 10px;
    padding: 10px 14px;
    background: var(--bg-card2);
    border-radius: 12px;
    border: 1px solid var(--border);
  }

  .domain-invs ul { padding-left: 18px; margin-top: 6px; }
  .domain-invs li { margin-bottom: 4px; }

  .lesson-card {
    border-left: 3px solid var(--yellow);
    padding: 16px 20px;
    margin-bottom: 12px;
  }

  .lesson-header { font-weight: 700; color: var(--yellow); margin-bottom: 8px; }

  .empty {
    color: var(--text-muted);
    font-style: italic;
    padding: 20px;
    text-align: center;
    background: var(--bg-card);
    border: 1px dashed var(--border);
    border-radius: 14px;
  }

  @media (max-width: 980px) {
    nav#sidebar {
      position: static;
      width: 100%;
      height: auto;
    }

    body {
      display: block;
    }

    main {
      margin-left: 0;
      padding: 20px 16px 40px;
      max-width: none;
    }

    .topbar {
      display: block;
    }

    .topbar-links {
      margin-top: 12px;
    }

    .overview-grid {
      grid-template-columns: 1fr;
    }

    .adr-sections {
      grid-template-columns: 1fr;
    }
  }
</style>
</head>
<body>

<nav id="sidebar">
  <div class="sidebar-logo">
    Workflow OS
    <small>한국어 학습 가이드</small>
  </div>
  <ul>
    <li><a href="#roadmap">학습 로드맵</a></li>
    <li><a href="#adrs">아키텍처 결정 트레일</a></li>
    <li><a href="#capabilities">도메인 역량 탐색</a></li>
    <li><a href="#lessons">교훈 모음</a></li>
  </ul>
  <div class="sidebar-footer">생성일: ${escHtml(generatedAt)}</div>
</nav>

<main>
  <div class="topbar">
    <div>
      <strong>Workflow OS 학습 화면</strong>
      <span>ADR, 로드맵, 도메인 역량을 한국어 중심으로 정리한 온보딩 화면</span>
    </div>
    <div class="topbar-links">
      <a href="../index.html">홈</a>
      <a href="../master-planner/index.html">플래너</a>
      <a href="../catalog-site/index.html">카탈로그</a>
    </div>
  </div>

  <section class="hero">
    <div class="eyebrow">신규 참여자 추천 시작점</div>
    <h1 class="page-title">Workflow OS 학습 가이드</h1>
    <p class="page-subtitle">아키텍처 패턴, 도메인 역량, 결정 이력을 한국어 중심으로 탐색하세요. 로드맵부터 보고, 필요한 순간에 ADR과 도메인 역량으로 깊이를 더하면 됩니다.</p>
    <div class="overview-grid">
      <div class="overview-card"><span>학습 단계</span><strong>${summary.milestoneCount}</strong></div>
      <div class="overview-card"><span>ADR 문서</span><strong>${summary.adrCount}</strong></div>
      <div class="overview-card"><span>도메인 역량</span><strong>${summary.capabilityCount}</strong></div>
      <div class="overview-card"><span>교훈 항목</span><strong>${summary.lessonCount}</strong></div>
    </div>
  </section>

  <section id="roadmap">
    <h2>학습 로드맵</h2>
    ${milestones}
  </section>

  <section id="adrs">
    <h2>아키텍처 결정 트레일</h2>
    ${adrs}
  </section>

  <section id="capabilities">
    <h2>도메인 역량 탐색</h2>
    ${capabilities}
  </section>

  <section id="lessons">
    <h2>교훈 모음</h2>
    ${lessons}
  </section>
</main>

<script>
(function () {
  const links = document.querySelectorAll('nav#sidebar a');
  const sections = document.querySelectorAll('main section[id]');

  function setActive() {
    let current = '';
    sections.forEach(function(s) {
      const top = s.getBoundingClientRect().top;
      if (top <= 80) current = s.id;
    });
    links.forEach(function(a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current);
    });
  }

  window.addEventListener('scroll', setActive, { passive: true });
  setActive();
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------
function main() {
  const adrDir = path.join(ROOT, 'docs', 'adr');
  const adrIndex = safeReadYaml(path.join(adrDir, 'adr-index.yaml'));
  const masteryMap = safeReadYaml(path.join(ROOT, 'master-shell', 'catalog', 'learning-mastery-map.yaml'));
  const lessonsData = safeReadYaml(path.join(ROOT, 'memory', 'project', 'lessons-learned.yaml'));

  const adrs = loadAdrs(adrDir, adrIndex);
  const capabilities = loadCapabilities();
  const milestoneLevels = Array.isArray(masteryMap?.levels) ? masteryMap.levels : [];
  const lessonItems = Array.isArray(lessonsData?.lessons) ? lessonsData.lessons : [];

  const generatedAt = new Date().toISOString().slice(0, 10);

  const html = buildHtml({
    milestones: renderMilestones(masteryMap),
    adrs: renderAdrs(adrs),
    capabilities: renderCapabilities(capabilities),
    lessons: renderLessons(lessonsData),
    generatedAt,
    summary: {
      milestoneCount: milestoneLevels.length,
      adrCount: adrs.length,
      capabilityCount: capabilities.length,
      lessonCount: lessonItems.length,
    },
  });

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  fs.writeFileSync(OUT_FILE, html, 'utf8');
  process.stdout.write('생성 완료: artifacts/study-guide/index.html\n');
}

main();
