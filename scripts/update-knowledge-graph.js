#!/usr/bin/env node
'use strict';

/**
 * 지식 그래프 갱신
 * domains/ + contracts/ + tests/ + ADR을 종합하여 knowledge-graph.yaml 재작성
 */

const fs = require('node:fs');
const path = require('node:path');
const { collectDomainEntries } = require('./lib/domain-discovery');

const graphFile = path.join(__dirname, '..', 'memory', 'knowledge-graph.yaml');
const domainsDir = path.join(__dirname, '..', 'domains');
const adrDir = path.join(__dirname, '..', 'docs', 'adr');

const domainEntries = fs.existsSync(domainsDir) ? collectDomainEntries(domainsDir) : [];
let yaml = `# 도메인 간 관계 추적 그래프\n# 자동 갱신: ${new Date().toISOString()}\nentities:\n  domains:\n`;

for (const entry of domainEntries) {
  const contractFiles = ['openapi.yaml', 'events.schema.json', 'ui-contract.yaml', 'capability.yaml'];
  const hasContracts = contractFiles.map((file) => entry.contractsDir ? fs.existsSync(path.join(entry.contractsDir, file)) : false);
  const testCount = countFiles(entry.testsDir, '.test.js');
  const srcCount = countFiles(entry.srcDir, '.js');

  const relatedAdrs = [];
  if (fs.existsSync(adrDir)) {
    for (const file of fs.readdirSync(adrDir).filter((item) => item.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(adrDir, file), 'utf-8');
      if (content.includes(`domain: ${entry.id}`)) {
        relatedAdrs.push(file);
      }
    }
  }

  yaml += `    "${entry.id}":\n`;
  yaml += `      contracts: { openapi: ${hasContracts[0]}, events: ${hasContracts[1]}, ui: ${hasContracts[2]}, capability: ${hasContracts[3]} }\n`;
  yaml += `      test_files: ${testCount}\n`;
  yaml += `      src_files: ${srcCount}\n`;
  yaml += `      related_adrs: [${relatedAdrs.map((file) => `"${file}"`).join(', ')}]\n`;
}

yaml += '  invariants: {}\n';
yaml += '  learnings:\n';
yaml += '    recent_patterns: []\n';
yaml += '    recent_anti_patterns: []\n';

fs.writeFileSync(graphFile, yaml, 'utf-8');
process.stdout.write(`✅ 지식 그래프 갱신: ${domainEntries.length}개 도메인\n`);

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
