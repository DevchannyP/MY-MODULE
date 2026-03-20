#!/usr/bin/env node
'use strict';

/**
 * 도메인 카탈로그 정적 HTML 생성
 * node scripts/generate-catalog-site.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { collectDomainEntries } = require('./lib/domain-discovery');

const output = path.join(__dirname, '..', 'artifacts', 'catalog-site', 'index.html');
const domainsDir = path.join(__dirname, '..', 'domains');

fs.mkdirSync(path.dirname(output), { recursive: true });

const domains = [];
if (fs.existsSync(domainsDir)) {
  for (const entry of collectDomainEntries(domainsDir)) {
    const title = entry.specFile && fs.existsSync(entry.specFile)
      ? (fs.readFileSync(entry.specFile, 'utf-8').match(/^#\s+(.+)/m) || [null, entry.id])[1]
      : entry.id;
    domains.push({
      id: entry.id,
      title,
      openapi: entry.contractsDir ? fs.existsSync(path.join(entry.contractsDir, 'openapi.yaml')) : false,
      events: entry.contractsDir ? fs.existsSync(path.join(entry.contractsDir, 'events.schema.json')) : false,
      ui: entry.contractsDir ? fs.existsSync(path.join(entry.contractsDir, 'ui-contract.yaml')) : false,
      capability: entry.contractsDir ? fs.existsSync(path.join(entry.contractsDir, 'capability.yaml')) : false,
    });
  }
}

const cards = domains.map((domain) => {
  const badges = [
    { label: 'OpenAPI', ok: domain.openapi },
    { label: 'Events', ok: domain.events },
    { label: 'UI', ok: domain.ui },
    { label: 'Cap', ok: domain.capability },
  ].map((badge) => `<span class="badge ${badge.ok ? 'yes' : 'no'}">${badge.label}</span>`).join('');
  return `<div class="card"><h2>${escapeHtml(domain.title)}</h2><div class="id">${escapeHtml(domain.id)}</div><div class="badges">${badges}</div></div>`;
}).join('');

const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>Workflow OS - 도메인 카탈로그</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:2rem}h1{color:#fbbf24;font-size:2rem;margin-bottom:.5rem}.meta{color:#94a3b8;margin-bottom:1.5rem}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem}.card{background:#1e293b;border-radius:12px;padding:1.5rem;border:1px solid #334155}.card h2{color:#38bdf8;margin-bottom:.25rem}.id{font-size:.85rem;color:#64748b;margin-bottom:.75rem}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.75rem;margin:2px}.badge.yes{background:#065f46;color:#6ee7b7}.badge.no{background:#7f1d1d;color:#fca5a5}.empty{text-align:center;padding:3rem;color:#64748b}</style>
</head><body><h1>Workflow OS - 도메인 카탈로그</h1>
<div class="meta">총 ${domains.length}개 도메인 | ${new Date().toISOString().split('T')[0]}</div>
${domains.length ? `<div class="grid">${cards}</div>` : '<div class="empty">도메인 없음. <code>A [도메인명]</code>으로 시작하세요.</div>'}
</body></html>`;

fs.writeFileSync(output, html, 'utf-8');
process.stdout.write(`✅ 카탈로그 사이트: ${output}\n`);

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
