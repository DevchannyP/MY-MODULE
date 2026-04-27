#!/usr/bin/env node
'use strict';

/**
 * SHA-256 해시 체인 감사 추적
 * node scripts/audit-chain.js append "{action}" "{details}"
 * node scripts/audit-chain.js verify
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const auditFile = path.join(__dirname, '..', 'worklog', 'audit-chain.json');

function load() {
  if (!fs.existsSync(auditFile)) {
    return { entries: [], last_hash: '0'.repeat(64) };
  }
  return JSON.parse(fs.readFileSync(auditFile, 'utf-8'));
}

function append(action, details) {
  const chain = load();
  const entry = {
    seq: chain.entries.length + 1,
    timestamp: new Date().toISOString(),
    action,
    details,
    prev_hash: chain.last_hash,
  };
  entry.hash = crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');
  chain.entries.push(entry);
  chain.last_hash = entry.hash;
  fs.writeFileSync(auditFile, JSON.stringify(chain, null, 2), 'utf-8');
  process.stdout.write(`✅ 감사 로그 #${entry.seq}: ${action}\n`);
}

function verify() {
  const chain = load();
  let previousHash = '0'.repeat(64);
  let ok = true;

  for (const entry of chain.entries) {
    const expectedEntry = {
      seq: entry.seq,
      timestamp: entry.timestamp,
      action: entry.action,
      details: entry.details,
      prev_hash: previousHash,
    };
    const expectedHash = crypto.createHash('sha256').update(JSON.stringify(expectedEntry)).digest('hex');
    if (expectedHash !== entry.hash) {
      process.stderr.write(`❌ 해시 불일치: #${entry.seq}\n`);
      ok = false;
    }
    previousHash = entry.hash;
  }

  if (ok) {
    process.stdout.write(`✅ 감사 체인 무결성 확인: ${chain.entries.length}개 항목\n`);
  }
  return ok;
}

module.exports = { append, verify };

const command = process.argv[2];
if (command === 'verify') {
  process.exit(verify() ? 0 : 1);
} else if (command === 'append') {
  append(process.argv[3] || 'unknown', process.argv[4] || '');
} else {
  process.stdout.write('Usage: node scripts/audit-chain.js verify|append {action} {details}\n');
}
