#!/usr/bin/env node
'use strict';

/**
 * Error Budget 기반 Stage 진입 판단
 * SLO 기준 에러율 계산 → Stage E 실행 권고 또는 리팩토링 추천
 */

const fs = require('node:fs');
const path = require('node:path');

const domainId = process.argv[2];
if (!domainId) {
  process.stderr.write('Usage: node scripts/error-budget-check.js {domain-id}\n');
  process.exit(1);
}

const sloErrorRate = 0.01;
const metricsFile = path.join(__dirname, '..', 'memory', 'project', 'metrics.yaml');
let errorRate = 0;
let hasData = false;

if (fs.existsSync(metricsFile)) {
  const content = fs.readFileSync(metricsFile, 'utf-8');
  const entries = [];
  let current = {};

  for (const line of content.split('\n')) {
    if (/^\s*- date:/.test(line)) {
      if (current.domain) {
        entries.push(current);
      }
      current = {};
      continue;
    }

    const match = line.match(/^\s+([a-zA-Z_]+):\s*(.+)/);
    if (match) {
      current[match[1]] = match[2].trim().replace(/"/g, '');
    }
  }

  if (current.domain) {
    entries.push(current);
  }

  const domainEntries = entries.filter((entry) => entry.domain === domainId);
  if (domainEntries.length > 0) {
    const latest = domainEntries[domainEntries.length - 1];
    const passed = parseInt(latest.tests_passed || '0', 10);
    const total = parseInt(latest.tests_total || '0', 10);
    if (total > 0) {
      errorRate = (total - passed) / total;
      hasData = true;
    }
  }
}

const budgetRemaining = sloErrorRate - errorRate;

if (!hasData) {
  process.stdout.write(`⚠️ ${domainId}: 메트릭 없음 — Stage D 실행 후 재측정\n`);
} else if (budgetRemaining <= 0) {
  process.stdout.write(`🔴 ${domainId}: Error Budget 소진 (현재 에러율 ${(errorRate * 100).toFixed(1)}%) → Stage E 즉시 실행 권고\n`);
} else if (budgetRemaining < sloErrorRate * 0.3) {
  process.stdout.write(`🟡 ${domainId}: Error Budget 30% 이하 → Stage E 계획 권고\n`);
} else {
  process.stdout.write(`🟢 ${domainId}: Error Budget 여유 (에러율 ${(errorRate * 100).toFixed(1)}%) → 리팩토링 가능\n`);
}
