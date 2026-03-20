#!/usr/bin/env node
'use strict';

/**
 * 아키텍처 피트니스 함수 + 경계 검사
 * C001 (직접 import 금지), C002 (Clean Architecture), C003 (계약 존재) 자동 검증
 * node scripts/architecture-fitness.js          → 전체 도메인
 * node scripts/architecture-fitness.js {domain} → 단일 도메인
 */

const fs = require('node:fs');
const path = require('node:path');
const { collectDomainEntries, resolveDomainEntry } = require('./lib/domain-discovery');

const targetDomain = process.argv[2] || null;
const domainsDir = path.join(__dirname, '..', 'domains');

if (!fs.existsSync(domainsDir)) {
  process.stdout.write('⚠️ domains/ 없음 — 도메인이 아직 없습니다.\n');
  process.exit(0);
}

const domainEntries = targetDomain
  ? (() => {
      const entry = resolveDomainEntry(domainsDir, targetDomain);
      if (!entry) {
        process.stderr.write(`❌ 대상 도메인을 찾을 수 없음: ${targetDomain}\n`);
        process.exit(1);
      }
      return [entry];
    })()
  : collectDomainEntries(domainsDir);

let totalFails = 0;

for (const entry of domainEntries) {
  const fails = [];
  let coupling = 0;

  if (entry.srcDir && fs.existsSync(entry.srcDir)) {
    const jsFiles = walkJs(entry.srcDir);
    for (const file of jsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (line.includes('require(') && line.includes('/domains/') && line.includes('/src/')) {
          fails.push(`C001: ${relPath(file)}:${index + 1} → ${line.trim()}`);
        }
        if (line.includes('require(') && (line.includes('/contracts/') || line.includes('/contract/'))) {
          coupling++;
        }
      });
    }
  }

  const domainCoreDir = entry.srcDir ? path.join(entry.srcDir, 'domain') : null;
  const forbidden = ['express', 'koa', 'fastify', 'http', 'https', 'pg', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'sequelize', 'knex', 'react', 'vue', 'angular'];
  if (domainCoreDir && fs.existsSync(domainCoreDir)) {
    for (const file of walkJs(domainCoreDir)) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        for (const pkg of forbidden) {
          const pattern = new RegExp(`require\\(['"](${pkg}|${pkg}/)['"\\)]`);
          if (pattern.test(line)) {
            fails.push(`C002: ${relPath(file)}:${index + 1} → require('${pkg}')`);
          }
        }
      });
    }
  }

  if (!entry.contractsDir || !fs.existsSync(entry.contractsDir) || fs.readdirSync(entry.contractsDir).length === 0) {
    fails.push('C003: contracts/ 또는 contract/ 없음 또는 비어있음');
  }

  const status = fails.length === 0 ? '✅ PASS' : '❌ FAIL';
  process.stdout.write(`\n[${entry.id}] ${status} | 결합도: ${coupling}\n`);
  fails.forEach((failure) => process.stdout.write(`  ${failure}\n`));
  totalFails += fails.length;
}

process.stdout.write(`\n=== 총 ${domainEntries.length}개 도메인 | 위반: ${totalFails}건 ===\n`);
if (totalFails > 0) {
  process.exit(1);
}

function walkJs(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJs(target));
    } else if (entry.name.endsWith('.js')) {
      files.push(target);
    }
  }
  return files;
}

function relPath(filePath) {
  return path.relative(process.cwd(), filePath);
}
