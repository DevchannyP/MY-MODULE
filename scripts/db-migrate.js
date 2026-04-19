//@ts-check
'use strict';

/**
 * db-migrate.js — 전 도메인 SQLite 스키마 적용
 *
 * --test  : :memory: DB로 스키마 유효성만 검사 (CI용)
 * (없음)  : data/ 경로 실 DB에 스키마 적용
 */

const path = require('node:path');
const fs   = require('node:fs');

const isTest = process.argv.includes('--test');

const DOMAINS = [
  {
    name:       'task-tracking',
    repoPath:   './domains/productivity/task-tracking/src/infrastructure/SQLiteTaskRepository',
    exportName: 'SQLiteTaskRepository',
    dbFile:     './data/tasks.db',
  },
  {
    name:       'billing',
    repoPath:   './domains/billing/src/infrastructure/SQLiteBillingRepository',
    exportName: 'SQLiteInvoiceRepository',
    dbFile:     './data/billing.db',
  },
  {
    name:       'video',
    repoPath:   './domains/video/src/infrastructure/SQLiteVideoRepository',
    exportName: 'SQLiteVideoRepository',
    dbFile:     './data/video.db',
  },
];

let allPass = true;

for (const domain of DOMAINS) {
  try {
    const mod    = require(path.resolve(domain.repoPath));
    const Repo   = mod[domain.exportName];
    const dbPath = isTest ? ':memory:' : domain.dbFile;

    if (!isTest) {
      const dir = path.dirname(domain.dbFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    Repo.create(dbPath);
    console.log(`✓ ${domain.name} — schema OK (${isTest ? ':memory:' : domain.dbFile})`);
  } catch (err) {
    console.error(`✗ ${domain.name} — FAILED: ${err.message}`);
    allPass = false;
  }
}

if (!allPass) process.exit(1);
console.log(isTest ? '\nAll schemas valid.' : '\nAll migrations applied.');
