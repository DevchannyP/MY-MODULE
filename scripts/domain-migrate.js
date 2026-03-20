#!/usr/bin/env node
'use strict';

/**
 * 도메인 마이그레이션 CLI
 * node scripts/domain-migrate.js export {domain-id} --target {path}
 * node scripts/domain-migrate.js import {source-path} --into {project-root}
 * node scripts/domain-migrate.js detach {domain-id}
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sourcePath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(sourcePath, destPath);
    } else {
      fs.copyFileSync(sourcePath, destPath);
    }
  }
}

const [, , command, target, ...rest] = process.argv;

if (command === 'export') {
  const domainId = target;
  const targetFlag = rest.indexOf('--target');
  const targetPath = targetFlag !== -1 ? rest[targetFlag + 1] : `./${domainId}-export`;

  const domainDir = path.join('domains', domainId);
  if (!fs.existsSync(domainDir)) {
    process.stderr.write(`❌ domains/${domainId} 없음\n`);
    process.exit(1);
  }

  const exportDir = path.join(targetPath, domainId);
  fs.mkdirSync(exportDir, { recursive: true });
  copyDirSync(domainDir, exportDir);

  const memExport = path.join(exportDir, 'memory');
  fs.mkdirSync(memExport, { recursive: true });
  for (const stage of ['stageA', 'stageB', 'stageC', 'stageD', 'stageE']) {
    const filePath = path.join('memory', stage, `${domainId}.yaml`);
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, path.join(memExport, `${stage}.yaml`));
    }
  }

  const reflectionsDir = path.join('memory', 'reflections');
  if (fs.existsSync(reflectionsDir)) {
    const reflections = fs.readdirSync(reflectionsDir).filter(file => file.startsWith(domainId));
    if (reflections.length > 0) {
      const exportReflectionDir = path.join(memExport, 'reflections');
      fs.mkdirSync(exportReflectionDir, { recursive: true });
      reflections.forEach(file => {
        fs.copyFileSync(path.join(reflectionsDir, file), path.join(exportReflectionDir, file));
      });
    }
  }

  const reportsDir = path.join('worklog', 'reports');
  if (fs.existsSync(reportsDir)) {
    const reports = fs.readdirSync(reportsDir).filter(dir => dir.includes(domainId));
    if (reports.length > 0) {
      const exportReportsDir = path.join(exportDir, 'reports');
      fs.mkdirSync(exportReportsDir, { recursive: true });
      reports.forEach(dir => copyDirSync(path.join(reportsDir, dir), path.join(exportReportsDir, dir)));
    }
  }

  const contractsDir = path.join(domainDir, 'contracts');
  const manifest = {
    domain_id: domainId,
    version: '1.0.0',
    exported_at: new Date().toISOString(),
    source_project: 'my-module',
    contract_hashes: {
      openapi: hashFile(path.join(contractsDir, 'openapi.yaml')),
      events: hashFile(path.join(contractsDir, 'events.schema.json')),
      ui_contract: hashFile(path.join(contractsDir, 'ui-contract.yaml')),
      capability: hashFile(path.join(contractsDir, 'capability.yaml')),
    }
  };
  fs.writeFileSync(path.join(exportDir, 'manifest.yaml'), JSON.stringify(manifest, null, 2), 'utf-8');

  process.stdout.write(`✅ Export 완료: ${exportDir}\n`);
  process.stdout.write(`   계약 해시: ${JSON.stringify(manifest.contract_hashes, null, 2)}\n`);
  process.stdout.write(`   재흡수: node scripts/domain-migrate.js import ${exportDir} --into <project-root>\n`);
} else if (command === 'import') {
  process.stdout.write('📦 Import: Stage B 재실행이 필요합니다.\n');
  process.stdout.write('   migration-export skill 참조\n');
} else if (command === 'detach') {
  process.stdout.write('🔌 Detach: migration-export skill 참조\n');
} else {
  process.stdout.write('Usage:\n');
  process.stdout.write('  export {domain-id} --target {path}\n');
  process.stdout.write('  import {source} --into {root}\n');
  process.stdout.write('  detach {domain-id}\n');
}
