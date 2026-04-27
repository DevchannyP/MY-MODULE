#!/usr/bin/env node
'use strict';

/**
 * DAG 기반 도메인 병렬 실행 스케줄러
 * node scripts/orchestrate.js          → 실행 계획 텍스트 출력
 * node scripts/orchestrate.js --json   → JSON 출력
 */

const fs = require('node:fs');
const path = require('node:path');

const domainMap = path.join(__dirname, '..', 'requirements', 'domain-map.yaml');
const jsonMode = process.argv.includes('--json');

if (!fs.existsSync(domainMap)) {
  const result = { groups: [], message: 'domain-map.yaml 없음' };
  process.stdout.write(jsonMode ? `${JSON.stringify(result, null, 2)}\n` : '⚠️ domain-map.yaml 없음\n');
  process.exit(0);
}

const content = fs.readFileSync(domainMap, 'utf-8');
const graph = {};
let current = null;
let mode = null;

for (const line of content.split('\n')) {
  const idMatch = line.match(/^ {2}- id:\s*"?(.*?)"?\s*$/);
  if (idMatch) {
    current = idMatch[1];
    graph[current] = [];
    mode = null;
    continue;
  }
  if (line.includes('depends_on:')) {
    mode = 'dep';
    continue;
  }
  if (mode === 'dep' && current) {
    const depMatch = line.match(/^\s*-\s*"?(.*?)"?\s*$/);
    if (depMatch) {
      graph[current].push(depMatch[1]);
    } else if (line.trim()) {
      mode = null;
    }
  }
}

const visited = new Set();
const visiting = new Set();
const groups = [];

function detectCycle(node, trail) {
  if (visiting.has(node)) {
    const cycle = [...trail, node];
    process.stderr.write(`❌ 순환 의존 감지: ${cycle.join(' → ')}\n`);
    process.exit(1);
  }
  if (visited.has(node)) return;

  visiting.add(node);
  for (const dep of graph[node] || []) {
    detectCycle(dep, [...trail, node]);
  }
  visiting.delete(node);
  visited.add(node);
}

Object.keys(graph).forEach((node) => detectCycle(node, []));

const remaining = new Set(Object.keys(graph));
const done = new Set();

while (remaining.size > 0) {
  const group = [...remaining].filter((domain) => (graph[domain] || []).every((dep) => done.has(dep)));
  if (group.length === 0) {
    process.stderr.write('❌ 그룹화 실패 (순환?)\n');
    process.exit(1);
  }
  groups.push(group);
  group.forEach((domain) => {
    done.add(domain);
    remaining.delete(domain);
  });
}

if (jsonMode) {
  process.stdout.write(`${JSON.stringify({ groups }, null, 2)}\n`);
} else {
  process.stdout.write('\n## 병렬 실행 계획\n');
  groups.forEach((group, index) => {
    const previous = index === 0 ? '즉시' : `Group ${index} 완료 후`;
    process.stdout.write(`Group ${index + 1} (${previous}, 병렬 가능): ${group.join(', ')}\n`);
  });
}
