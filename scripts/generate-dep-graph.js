#!/usr/bin/env node
'use strict';

/**
 * domain-map.yaml → Mermaid 의존성 다이어그램
 * node scripts/generate-dep-graph.js
 */

const fs = require('node:fs');
const path = require('node:path');

const domainMap = path.join(__dirname, '..', 'requirements', 'domain-map.yaml');
const output = path.join(__dirname, '..', 'docs', 'reference', 'generated', 'domain-dependency-graph.md');

fs.mkdirSync(path.dirname(output), { recursive: true });

if (!fs.existsSync(domainMap)) {
  const empty = '# 도메인 의존성 그래프\n> 도메인이 아직 없습니다.\n```mermaid\ngraph LR\n  empty[도메인 없음]\n```\n';
  fs.writeFileSync(output, empty, 'utf-8');
  process.stdout.write('⚠️ domain-map.yaml 없음 — 빈 그래프 생성\n');
  process.exit(0);
}

const content = fs.readFileSync(domainMap, 'utf-8');
const domains = [];
const deps = [];
let currentDomain = null;
let mode = null;

for (const line of content.split('\n')) {
  const domainMatch = line.match(/^ {2}- id:\s*"?(.*?)"?\s*$/);
  if (domainMatch) {
    currentDomain = domainMatch[1];
    domains.push(currentDomain);
    mode = null;
    continue;
  }
  if (line.includes('depends_on:')) {
    mode = 'dep';
    continue;
  }
  if (mode === 'dep' && currentDomain) {
    const depMatch = line.match(/^\s*-\s*"?(.*?)"?\s*$/);
    if (depMatch) {
      deps.push({ from: currentDomain, to: depMatch[1] });
    } else if (line.trim() && !line.match(/^\s*#/)) {
      mode = null;
    }
  }
}

let mermaid = 'graph LR\n';
domains.forEach((domain) => {
  const nodeId = sanitizeNodeId(domain);
  mermaid += `  ${nodeId}[${domain}]\n`;
});
deps.forEach((dep) => {
  mermaid += `  ${sanitizeNodeId(dep.from)} --> ${sanitizeNodeId(dep.to)}\n`;
});

const doc = `# 도메인 의존성 그래프\n> 자동 생성: \`node scripts/generate-dep-graph.js\`\n\n\`\`\`mermaid\n${mermaid}\`\`\`\n\n## 범례\n- A → B: "A가 B에 의존"\n`;
fs.writeFileSync(output, doc, 'utf-8');
process.stdout.write(`✅ 의존성 그래프: ${output}\n`);

function sanitizeNodeId(value) {
  return value.replace(/[^a-zA-Z0-9_]/g, '_');
}
