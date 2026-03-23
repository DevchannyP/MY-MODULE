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

  const domainCoreDir = entry.srcDir ? path.join(entry.srcDir, 'domain') : null;
  // forbidden 패턴을 루프 밖에서 1회 컴파일 (도메인 루프 내 반복 컴파일 제거)
  const forbidden = ['express', 'koa', 'fastify', 'http', 'https', 'pg', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'sequelize', 'knex', 'react', 'vue', 'angular'];
  const forbiddenPatterns = forbidden.map(pkg => ({ pkg, re: new RegExp(`require\\(['"](${pkg}|${pkg}/)['"\\)]`) }));
  const infraPatterns = [/^InMemory/i, /^SQLite/i, /^Postgres/i, /^Mongo/i, /^Redis/i, /^MySQL/i];

  // 단일 패스: srcDir 전체를 1회 순회, 파일당 1회 readFileSync로 C001·C002·C004 동시 검사
  if (entry.srcDir && fs.existsSync(entry.srcDir)) {
    for (const file of walkJs(entry.srcDir)) {
      const isDomainFile = domainCoreDir !== null && file.startsWith(domainCoreDir + path.sep);
      const basename = path.basename(file);

      // C004: 파일명만 검사 — readFileSync 불필요
      if (isDomainFile && infraPatterns.some(p => p.test(basename))) {
        fails.push(`C004: ${relPath(file)} — 인프라 어댑터가 domain/ 레이어에 배치됨 (infrastructure/로 이동하라)`);
        continue;
      }

      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        // C001: 도메인 간 직접 src/ import 금지
        if (line.includes('require(') && line.includes('/domains/') && line.includes('/src/')) {
          fails.push(`C001: ${relPath(file)}:${index + 1} → ${line.trim()}`);
        }
        // 결합도: contracts/ 참조 카운트
        if (line.includes('require(') && (line.includes('/contracts/') || line.includes('/contract/'))) {
          coupling++;
        }
        // C002: domain/ 파일에만 프레임워크 import 금지 적용
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
