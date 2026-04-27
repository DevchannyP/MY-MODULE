#!/usr/bin/env node
'use strict';

/**
 * 계약 파일 → 코드 스켈레톤 자동 생성
 * node scripts/generate-from-contracts.js {domain-id}
 */

const fs = require('node:fs');
const path = require('node:path');
const { resolveDomainEntry } = require('./lib/domain-discovery');

const domainId = process.argv[2];
if (!domainId) {
  process.stderr.write('Usage: node scripts/generate-from-contracts.js {domain-id}\n');
  process.exit(1);
}

const domainsDir = path.join(__dirname, '..', 'domains');
const entry = resolveDomainEntry(domainsDir, domainId);

if (!entry) {
  process.stderr.write(`❌ 도메인을 찾을 수 없음: ${domainId}\n`);
  process.exit(1);
}

const contractsDir = entry.contractsDir;
const srcDir = entry.srcDir || path.join(entry.dir, 'src');
let generated = 0;

function writeIfNew(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    process.stdout.write(`⏭️  이미 존재: ${filePath}\n`);
    return;
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  generated++;
  process.stdout.write(`✅ 생성: ${filePath}\n`);
}

if (contractsDir) {
  const eventsFile = path.join(contractsDir, 'events.schema.json');
  if (fs.existsSync(eventsFile)) {
    try {
      const schema = JSON.parse(fs.readFileSync(eventsFile, 'utf-8'));
      const events = schema.events || schema.definitions || {};
      for (const [name, definition] of Object.entries(events)) {
        const className = toClassName(name);
        const fields = Object.keys((definition.properties || definition.payload || {}));
        const fieldList = fields.join(', ');
        const assignments = fields.map((field) => `    this.${field} = ${field};`).join('\n');
        const code = `'use strict';\n// AUTO-GENERATED from events.schema.json\nclass ${className} {\n  constructor({ ${fieldList} }) {\n${assignments}\n    this.occurredAt = new Date().toISOString();\n    Object.freeze(this);\n  }\n}\nmodule.exports = { ${className} };\n`;
        writeIfNew(path.join(srcDir, 'domain', 'events', `${className}.js`), code);
      }
    } catch (error) {
      process.stderr.write(`⚠️ events.schema.json 파싱 실패: ${error.message}\n`);
    }
  }

  const capabilityFile = path.join(contractsDir, 'capability.yaml');
  if (fs.existsSync(capabilityFile)) {
    const content = fs.readFileSync(capabilityFile, 'utf-8');
    const capabilities = [];
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*-?\s*name:\s*"?(.*?)"?\s*$/);
      if (match) {
        capabilities.push(match[1]);
      }
    }

    for (const capability of capabilities) {
      const className = `${toClassName(capability)}Port`;
      const code = `'use strict';\n// AUTO-GENERATED from capability.yaml\nclass ${className} {\n  async findById(_id) { throw new Error('Not implemented'); }\n  async save(_entity) { throw new Error('Not implemented'); }\n  async findAll(_criteria) { throw new Error('Not implemented'); }\n}\nmodule.exports = { ${className} };\n`;
      writeIfNew(path.join(srcDir, 'application', 'ports', `${className}.js`), code);
    }
  }
}

process.stdout.write(`\n📦 총 ${generated}개 스켈레톤 생성 완료\n`);

function toClassName(value) {
  return value
    .replace(/[-_/](\w)/g, (_, char) => char.toUpperCase())
    .replace(/^\w/, (char) => char.toUpperCase());
}
