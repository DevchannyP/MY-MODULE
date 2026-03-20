#!/usr/bin/env node
'use strict';

/**
 * 도메인 건강도 대시보드
 * node scripts/health-dashboard.js
 * node scripts/health-dashboard.js --json
 */

const fs = require('node:fs');
const path = require('node:path');
const { collectDomainEntries } = require('./lib/domain-discovery');

const jsonMode = process.argv.includes('--json');
const domainsDir = path.join(__dirname, '..', 'domains');
const scoresFile = path.join(__dirname, '..', 'master-shell', 'observability', 'health-scores.yaml');

if (!fs.existsSync(domainsDir)) {
  process.stdout.write(jsonMode ? '{}\n' : '⚠️ 도메인 없음\n');
  process.exit(0);
}

const domainEntries = collectDomainEntries(domainsDir);
const previousScores = {};
if (fs.existsSync(scoresFile)) {
  const content = fs.readFileSync(scoresFile, 'utf-8');
  for (const match of content.matchAll(/"([^"]+)":\s*\n\s+score:\s*(\d+(?:\.\d+)?)/g)) {
    previousScores[match[1]] = parseFloat(match[2]);
  }
}

const results = [];

for (const entry of domainEntries) {
  const contracts = ['openapi.yaml', 'events.schema.json', 'ui-contract.yaml', 'capability.yaml'];
  const contractScore = entry.contractsDir
    ? (contracts.filter((file) => fs.existsSync(path.join(entry.contractsDir, file))).length / 4) * 100
    : 0;

  const testCount = countFiles(entry.testsDir, '.test.js');
  const srcCount = countFiles(entry.srcDir, '.js');
  const testScore = srcCount > 0 ? Math.min(100, (testCount / srcCount) * 100) : 0;

  let reviewScore = 0;
  const reviewFile = path.join(__dirname, '..', 'worklog', 'B_review.md');
  if (fs.existsSync(reviewFile)) {
    const content = fs.readFileSync(reviewFile, 'utf-8');
    if (content.includes(entry.id)) {
      if (new RegExp(`${escapeRegExp(entry.id)}.*PASS`, 'i').test(content)) reviewScore = 100;
      else if (new RegExp(`${escapeRegExp(entry.id)}.*CONDITIONAL`, 'i').test(content)) reviewScore = 80;
      else if (new RegExp(`${escapeRegExp(entry.id)}.*FAIL`, 'i').test(content)) reviewScore = 0;
    }
  }

  const reportsDir = path.join(__dirname, '..', 'worklog', 'reports');
  const reportCount = fs.existsSync(reportsDir)
    ? fs.readdirSync(reportsDir).filter((dir) => dir.includes(entry.id.replace(/\//g, '_')) || dir.includes(entry.id)).length
    : 0;
  const reportScore = Math.min(100, reportCount * 20);

  const health = Math.round(contractScore * 0.30 + testScore * 0.30 + reviewScore * 0.20 + reportScore * 0.20);
  const previous = previousScores[entry.id];
  const trend = previous === undefined ? '→' : health > previous + 5 ? '↑' : health < previous - 5 ? '↓' : '→';
  const ejectable = contractScore === 100 && testScore >= 80;

  results.push({
    domain: entry.id,
    health,
    contractScore: Math.round(contractScore),
    testScore: Math.round(testScore),
    reviewScore,
    reportScore,
    trend,
    ejectable,
  });
}

let yaml = 'domains:\n';
results.forEach((result) => {
  yaml += `  "${result.domain}":\n`;
  yaml += `    score: ${result.health}\n`;
  yaml += `    trend: "${result.trend}"\n`;
  yaml += `    ejectable: ${result.ejectable}\n`;
});
yaml += `last_calculated: "${new Date().toISOString()}"\n`;
fs.writeFileSync(scoresFile, yaml, 'utf-8');

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else {
  process.stdout.write('\n## 도메인 건강도 대시보드\n');
  process.stdout.write('| 도메인 | 점수 | 계약 | 테스트 | 리뷰 | 보고서 | 추세 | 사출가능 |\n');
  process.stdout.write('|--------|------|------|--------|------|--------|------|---------|\n');
  results.forEach((result) => {
    process.stdout.write(`| ${result.domain} | ${result.health} | ${result.contractScore}% | ${result.testScore}% | ${result.reviewScore} | ${result.reportScore} | ${result.trend} | ${result.ejectable ? '✅' : '✗'} |\n`);
  });
}

function countFiles(dir, extension) {
  if (!dir || !fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(target, extension);
    } else if (entry.name.endsWith(extension)) {
      count++;
    }
  }
  return count;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
