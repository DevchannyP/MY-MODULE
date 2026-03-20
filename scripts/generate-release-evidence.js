#!/usr/bin/env node
'use strict';

/**
 * 릴리즈 증거 패키지 생성
 * node scripts/generate-release-evidence.js {domain-id} {version}
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveDomainEntry } = require('./lib/domain-discovery');

const [, , domainId, version = '1.0.0'] = process.argv;
if (!domainId) {
  process.stderr.write('Usage: node scripts/generate-release-evidence.js {domain-id} {version}\n');
  process.exit(1);
}

const domainsDir = path.join(__dirname, '..', 'domains');
const entry = resolveDomainEntry(domainsDir, domainId);
if (!entry) {
  process.stderr.write(`❌ 도메인을 찾을 수 없음: ${domainId}\n`);
  process.exit(1);
}

const releaseDir = path.join(__dirname, '..', 'artifacts', 'releases', `${domainId.replace(/\//g, '_')}-v${version}`);
fs.mkdirSync(releaseDir, { recursive: true });

const evidence = {
  domain_id: domainId,
  version,
  released_at: new Date().toISOString(),
  artifacts: {},
};

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

if (entry.contractsDir && fs.existsSync(entry.contractsDir)) {
  const dest = path.join(releaseDir, 'contracts');
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(entry.contractsDir)) {
    const sourcePath = path.join(entry.contractsDir, file);
    const targetPath = path.join(dest, file);
    fs.copyFileSync(sourcePath, targetPath);
    evidence.artifacts[`contract:${file}`] = hashFile(sourcePath);
  }
}

const reviewFile = path.join(__dirname, '..', 'worklog', 'B_review.md');
if (fs.existsSync(reviewFile)) {
  fs.copyFileSync(reviewFile, path.join(releaseDir, 'B_review.md'));
}

const auditFile = path.join(__dirname, '..', 'worklog', 'audit-chain.json');
if (fs.existsSync(auditFile)) {
  fs.copyFileSync(auditFile, path.join(releaseDir, 'audit-chain.json'));
}

fs.writeFileSync(path.join(releaseDir, 'evidence-manifest.json'), JSON.stringify(evidence, null, 2), 'utf-8');
process.stdout.write(`✅ 릴리즈 증거 패키지: ${releaseDir}\n`);
