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
const contractsDir = path.join(__dirname, '..', 'contracts');
const outputFile = path.join(__dirname, '..', 'worklog', 'contract-matrix.md');

if (!fs.existsSync(domainsDir)) {
  process.stdout.write('⚠️ domains/ 없음\n');
  process.exit(0);
}

// ── Domain contracts ─────────────────────────────────────────────────────────
const domainEntries = collectDomainEntries(domainsDir);
let failCount = 0;
const rows = [];

for (const entry of domainEntries) {
  const statuses = requiredContracts.map((file) =>
    entry.contractsDir && fs.existsSync(path.join(entry.contractsDir, file)) ? '✅' : '❌'
  );
  const allPass = statuses.every((status) => status === '✅');
  if (!allPass) failCount++;
  rows.push({ domain: entry.id, statuses, allPass });
}

// ── Shell-level contracts (contracts/ top-level namespaces) ──────────────────
// drift_validated: whether validate_contract_drift.py explicitly covers this contract
const shellContracts = [
  {
    name: 'ui-shell',
    files: ['openapi.yaml'],
    drift_validated: true,
    note: 'StageRunRuntimeObservability + X-Stage-Run-Report-Saved',
  },
  {
    name: 'harness',
    files: [
      'raw-intent.schema.json',
      'intake.schema.json',
      'wp-dag.schema.json',
      'output.schema.json',
      'completion-report.schema.json',
      'context-sources.yaml',
      'isolation-rules.yaml',
      'provider-adapter.yaml',
    ],
    drift_validated: true,
    note: 'intake schema validated against golden eval records',
  },
  {
    name: 'system-api',
    files: ['openapi.yaml', 'capability.yaml', 'events.schema.json'],
    drift_validated: true,
    note: 'capability↔openapi ops + events_emitted coverage verified',
  },
  {
    name: 'events',
    files: ['registry.yaml'],
    drift_validated: true,
    note: 'all domain events registered and pointer-verified',
  },
];

const shellRows = shellContracts.map((contract) => {
  const dir = path.join(contractsDir, contract.name);
  const fileStatuses = contract.files.map((f) => fs.existsSync(path.join(dir, f)) ? '✅' : '❌');
  const allFilesPresent = fileStatuses.every((s) => s === '✅');
  return { ...contract, allFilesPresent };
});

// ── Generate markdown ────────────────────────────────────────────────────────
const today = new Date().toISOString().split('T')[0];

const domainSection = [
  '## 도메인 계약',
  '',
  '| Domain | OpenAPI | Events | UI | Capability | Status |',
  '|--------|---------|--------|----|------------|--------|',
  ...rows.map((row) =>
    `| ${row.domain} | ${row.statuses[0]} | ${row.statuses[1]} | ${row.statuses[2]} | ${row.statuses[3]} | ${row.allPass ? 'PASS' : 'FAIL'} |`
  ),
].join('\n');

const shellSection = [
  '## Shell 계약 (contracts/)',
  '',
  '| Contract | Files | Drift Validated | Note |',
  '|----------|-------|-----------------|------|',
  ...shellRows.map((row) =>
    `| ${row.name} | ${row.allFilesPresent ? '✅' : '❌'} | ${row.drift_validated ? '✅' : '❌'} | ${row.note} |`
  ),
].join('\n');

const output = [
  `# 계약 호환성 매트릭스`,
  `> 자동 생성: ${today}`,
  '',
  domainSection,
  '',
  shellSection,
  '',
].join('\n');

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, output, 'utf-8');

process.stdout.write(`\n계약 호환성 매트릭스: ${outputFile}\n`);
rows.forEach((row) => process.stdout.write(`  [${row.allPass ? '✅' : '❌'}] ${row.domain}\n`));
shellRows.forEach((row) =>
  process.stdout.write(`  [${row.allFilesPresent ? '✅' : '❌'}] contracts/${row.name} (drift: ${row.drift_validated ? '✅' : '❌'})\n`)
);
process.stdout.write(`\n총 ${domainEntries.length}개 도메인 | FAIL: ${failCount}개\n`);
if (failCount > 0) {
  process.exit(1);
}
