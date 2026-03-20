#!/usr/bin/env node
'use strict';

/**
 * 계약 드리프트 검증 + 호환성 매트릭스 생성
 * node scripts/validate-contracts.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { collectDomainEntries } = require('./lib/domain-discovery');

const requiredContracts = ['openapi.yaml', 'events.schema.json', 'ui-contract.yaml', 'capability.yaml'];
const domainsDir = path.join(__dirname, '..', 'domains');
const outputFile = path.join(__dirname, '..', 'worklog', 'contract-matrix.md');

if (!fs.existsSync(domainsDir)) {
  process.stdout.write('⚠️ domains/ 없음\n');
  process.exit(0);
}

const domainEntries = collectDomainEntries(domainsDir);
let failCount = 0;
const rows = [];

for (const entry of domainEntries) {
  const statuses = requiredContracts.map((file) => entry.contractsDir && fs.existsSync(path.join(entry.contractsDir, file)) ? '✅' : '❌');
  const allPass = statuses.every((status) => status === '✅');
  if (!allPass) {
    failCount++;
  }
  rows.push({ domain: entry.id, statuses, allPass });
}

const header = `# 계약 호환성 매트릭스\n> 자동 생성: ${new Date().toISOString().split('T')[0]}\n\n| Domain | OpenAPI | Events | UI | Capability | Status |\n|--------|---------|--------|----|------------|--------|\n`;
const body = rows.map((row) => `| ${row.domain} | ${row.statuses[0]} | ${row.statuses[1]} | ${row.statuses[2]} | ${row.statuses[3]} | ${row.allPass ? 'PASS' : 'FAIL'} |`).join('\n');

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${header}${body}\n`, 'utf-8');

process.stdout.write(`\n계약 호환성 매트릭스: ${outputFile}\n`);
rows.forEach((row) => process.stdout.write(`  [${row.allPass ? '✅' : '❌'}] ${row.domain}\n`));
process.stdout.write(`\n총 ${domainEntries.length}개 도메인 | FAIL: ${failCount}개\n`);
if (failCount > 0) {
  process.exit(1);
}
