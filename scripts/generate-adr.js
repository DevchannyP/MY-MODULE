#!/usr/bin/env node
'use strict';

/**
 * ADR 자동 생성
 * node scripts/generate-adr.js --domain {id} --stage {X} --title {제목}
 * node scripts/generate-adr.js --index-only
 */

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const get = (flag) => {
  const index = args.indexOf(flag);
  return index !== -1 ? args[index + 1] : null;
};

const adrDir = path.join(__dirname, '..', 'docs', 'adr');
const indexFile = path.join(adrDir, 'adr-index.yaml');
const templateFile = path.join(adrDir, 'templates', 'adr-template.md');

if (args.includes('--index-only')) {
  rebuildIndex();
  process.exit(0);
}

const domain = get('--domain');
const stage = get('--stage') || 'A';
const title = get('--title');

if (!domain || !title) {
  process.stderr.write('Usage: node scripts/generate-adr.js --domain {id} --stage {X} --title {제목}\n');
  process.exit(1);
}

const existing = fs.existsSync(adrDir) ? fs.readdirSync(adrDir).filter((file) => /^\d{4}-/.test(file)).length : 0;
const id = String(existing + 1).padStart(4, '0');
const date = new Date().toISOString().split('T')[0];
const slug = title.replace(/[^a-zA-Z0-9가-힣]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 50) || 'adr';
const filename = `${id}-${slug}.md`;

fs.mkdirSync(adrDir, { recursive: true });
let content = fs.readFileSync(templateFile, 'utf-8');
content = content
  .replace(/adr_id: NNNN/, `adr_id: ${id}`)
  .replace(/title: "\[도메인\] 결정 제목"/, `title: "[${domain}] ${title}"`)
  .replace(/date: YYYY-MM-DD/, `date: ${date}`)
  .replace(/domain: domain-id/, `domain: ${domain}`)
  .replace(/stage: A/, `stage: ${stage}`)
  .replace(/^# NNNN\. \[결정 제목\]$/m, `# ${id}. [${domain}] ${title}`)
  .replace(/^Proposed — YYYY-MM-DD$/m, `Proposed — ${date}`);

fs.writeFileSync(path.join(adrDir, filename), content, 'utf-8');
process.stdout.write(`✅ ADR 생성: docs/adr/${filename}\n`);

appendToIndex(id, title, domain, stage, date, filename);

function appendToIndex(adrId, adrTitle, adrDomain, adrStage, adrDate, file) {
  let yaml = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf-8') : 'adrs: []\n';
  const entry = `\n  - id: "${adrId}"\n    title: "${adrTitle}"\n    domain: "${adrDomain}"\n    stage: "${adrStage}"\n    date: "${adrDate}"\n    file: "${file}"\n    status: proposed`;
  if (yaml.includes('adrs: []')) {
    yaml = yaml.replace('adrs: []', `adrs:${entry}`);
  } else {
    yaml += entry;
  }
  fs.writeFileSync(indexFile, yaml, 'utf-8');
}

function rebuildIndex() {
  if (!fs.existsSync(adrDir)) {
    return;
  }

  const files = fs.readdirSync(adrDir).filter((file) => /^\d{4}-.+\.md$/.test(file));
  let yaml = 'adrs:\n';

  for (const file of files.sort()) {
    const content = fs.readFileSync(path.join(adrDir, file), 'utf-8');
    const adrId = file.match(/^(\d{4})/)?.[1] || '0000';
    const titleMatch = content.match(/^# \d+\. (.+)$/m);
    yaml += `  - id: "${adrId}"\n    file: "${file}"\n    title: "${titleMatch ? titleMatch[1] : ''}"\n`;
  }

  fs.writeFileSync(indexFile, yaml, 'utf-8');
  process.stdout.write(`✅ ADR 인덱스 재생성: ${files.length}개\n`);
}
