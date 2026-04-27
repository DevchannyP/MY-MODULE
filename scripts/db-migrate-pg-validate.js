//@ts-check
/* eslint-disable no-console */
'use strict';

/**
 * db-migrate-pg-validate.js
 *
 * Validates that every domain has a Postgres migration baseline:
 *  - migrations/001_initial_pg.sql exists and is non-empty
 *  - Required tables are declared with CREATE TABLE IF NOT EXISTS
 *
 * No live Postgres connection required. CI-safe.
 */

const fs   = require('node:fs');
const path = require('node:path');

const DOMAINS = [
  {
    name:          'task-tracking',
    migrationPath: 'domains/productivity/task-tracking/src/infrastructure/migrations/001_initial_pg.sql',
    requiredTables: ['tasks', 'task_outbox'],
  },
  {
    name:          'billing',
    migrationPath: 'domains/billing/src/infrastructure/migrations/001_initial_pg.sql',
    requiredTables: ['billing_invoices', 'billing_payments', 'billing_exceptions'],
  },
  {
    name:          'video',
    migrationPath: 'domains/video/src/infrastructure/migrations/001_initial_pg.sql',
    requiredTables: ['video_contents', 'video_transcode_jobs'],
  },
];

let allPass = true;

for (const domain of DOMAINS) {
  const fullPath = path.resolve(domain.migrationPath);

  if (!fs.existsSync(fullPath)) {
    console.error(`✗ ${domain.name} — migration file missing: ${domain.migrationPath}`);
    allPass = false;
    continue;
  }

  const sql = fs.readFileSync(fullPath, 'utf8').trim();

  if (sql.length === 0) {
    console.error(`✗ ${domain.name} — migration file is empty`);
    allPass = false;
    continue;
  }

  const missingTables = domain.requiredTables.filter(
    (table) => !new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}`, 'i').test(sql),
  );

  if (missingTables.length > 0) {
    console.error(`✗ ${domain.name} — missing required tables: ${missingTables.join(', ')}`);
    allPass = false;
    continue;
  }

  const tableCount = (sql.match(/CREATE TABLE IF NOT EXISTS/gi) || []).length;
  console.log(`✓ ${domain.name} — ${tableCount} table(s) defined (${domain.migrationPath})`);
}

if (!allPass) {
  console.error('\n✗ PG migration validation FAILED');
  process.exit(1);
}

console.log('\n✓ All PG migration baselines valid.');
