#!/usr/bin/env node
'use strict';

/**
 * 아키텍처 피트니스 함수 + 경계 검사
 * C001 (직접 import 금지), C002 (Clean Architecture 프레임워크 금지),
 * C003 (계약 존재), C004 (인프라 어댑터 도메인 레이어 배치 금지) 자동 검증
 * node scripts/architecture-fitness.js          → 전체 도메인
 * node scripts/architecture-fitness.js {domain} → 단일 도메인
 *
 * 벤치마킹: ports-and-adapters (Hexagonal Architecture, Alistair Cockburn) —
 *   InMemory/SQLite/MongoDB 어댑터는 infrastructure/ 레이어에만 존재해야 한다.
 *   domain/ 레이어에 어댑터가 있으면 도메인 순수성이 오염된다.
 */

const fs = require('node:fs');
const path = require('node:path');
const { collectDomainEntries, resolveDomainEntry } = require('./lib/domain-discovery');

const domainsDir = path.join(__dirname, '..', 'domains');

function runArchitectureFitness(targetDomain = null) {
  if (!fs.existsSync(domainsDir)) {
    return {
      totalFails: 0,
      domainCount: 0,
      output: '⚠️ domains/ 없음 — 도메인이 아직 없습니다.\n',
      missingTarget: false,
    };
  }

  const domainEntries = targetDomain
    ? (() => {
        const entry = resolveDomainEntry(domainsDir, targetDomain);
        if (!entry) {
          return null;
        }
        return [entry];
      })()
    : collectDomainEntries(domainsDir);

  if (targetDomain && !domainEntries) {
    return {
      totalFails: 1,
      domainCount: 0,
      output: '',
      missingTarget: true,
    };
  }

  let totalFails = 0;
  const outputLines = [];

  for (const entry of domainEntries) {
    const fails = [];
    let coupling = 0;

    const domainCoreDir = entry.srcDir ? path.join(entry.srcDir, 'domain') : null;
    const forbidden = ['express', 'koa', 'fastify', 'http', 'https', 'pg', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'sequelize', 'knex', 'react', 'vue', 'angular'];
    const forbiddenPatterns = forbidden.map((pkg) => ({ pkg, re: new RegExp(`require\\(['"](${pkg}|${pkg}/)['"\\)]`) }));
    const infraPatterns = [/^InMemory/i, /^SQLite/i, /^Postgres/i, /^Mongo/i, /^Redis/i, /^MySQL/i];

    if (entry.srcDir && fs.existsSync(entry.srcDir)) {
      for (const file of walkJs(entry.srcDir)) {
        const isDomainFile = domainCoreDir !== null && file.startsWith(domainCoreDir + path.sep);
        const basename = path.basename(file);

        if (isDomainFile && infraPatterns.some((pattern) => pattern.test(basename))) {
          fails.push(`C004: ${relPath(file)} — 인프라 어댑터가 domain/ 레이어에 배치됨 (infrastructure/로 이동하라)`);
          continue;
        }

        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          if (line.includes('require(') && line.includes('/domains/') && line.includes('/src/')) {
            fails.push(`C001: ${relPath(file)}:${index + 1} → ${line.trim()}`);
          }
          if (line.includes('require(') && (line.includes('/contracts/') || line.includes('/contract/'))) {
            coupling++;
          }
          if (isDomainFile) {
            for (const { pkg, re } of forbiddenPatterns) {
              if (re.test(line)) {
                fails.push(`C002: ${relPath(file)}:${index + 1} → require('${pkg}')`);
              }
            }
          }
        });
      }
    }

    if (!entry.contractsDir || !fs.existsSync(entry.contractsDir) || fs.readdirSync(entry.contractsDir).length === 0) {
      fails.push('C003: contracts/ 또는 contract/ 없음 또는 비어있음');
    }

    const status = fails.length === 0 ? '✅ PASS' : '❌ FAIL';
    outputLines.push(`\n[${entry.id}] ${status} | 결합도: ${coupling}`);
    fails.forEach((failure) => outputLines.push(`  ${failure}`));
    totalFails += fails.length;
  }

  outputLines.push(`\n=== 총 ${domainEntries.length}개 도메인 | 위반: ${totalFails}건 ===`);

  return {
    totalFails,
    domainCount: domainEntries.length,
    output: `${outputLines.join('\n')}\n`,
    missingTarget: false,
  };
}

function main() {
  const targetDomain = process.argv[2] || null;
  const report = runArchitectureFitness(targetDomain);
  if (report.missingTarget) {
    process.stderr.write(`❌ 대상 도메인을 찾을 수 없음: ${targetDomain}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(report.output);
  if (report.totalFails > 0) {
    process.exitCode = 1;
  }
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

if (require.main === module) {
  main();
}

module.exports = {
  runArchitectureFitness,
};
