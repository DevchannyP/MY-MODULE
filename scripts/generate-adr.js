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

if (isReservedPlaceholder(domain) || isReservedPlaceholder(title)) {
  process.stderr.write('Reserved placeholder values are not allowed for ADR domain/title.\n');
  process.exit(1);
}

const id = String(getNextAdrNumber()).padStart(4, '0');
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

function getNextAdrNumber() {
  if (!fs.existsSync(adrDir)) {
    return 1;
  }

  const ids = fs.readdirSync(adrDir)
    .map((file) => file.match(/^(\d{4})-/)?.[1])
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10));

  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
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
    const frontmatter = parseFrontmatter(content);
    const title =
      frontmatter.title
      || content.match(/^# ADR \d+:\s+(.+)$/m)?.[1]
      || content.match(/^# \d+\.\s+(.+)$/m)?.[1]
      || file.replace(/^\d{4}-/, '').replace(/\.md$/, '');

    yaml += `  - id: "${adrId}"\n    file: "${file}"\n    title: "${title}"\n`;

    if (frontmatter.domain) {
      yaml += `    domain: "${frontmatter.domain}"\n`;
    }

    if (frontmatter.stage) {
      yaml += `    stage: "${frontmatter.stage}"\n`;
    }

    if (frontmatter.date) {
      yaml += `    date: "${frontmatter.date}"\n`;
    }

    if (frontmatter.status) {
      yaml += `    status: ${frontmatter.status}\n`;
    }
  }

  fs.writeFileSync(indexFile, yaml, 'utf-8');
  process.stdout.write(`✅ ADR 인덱스 재생성: ${files.length}개\n`);
}

function isReservedPlaceholder(value) {
  const normalized = String(value).trim().toLowerCase();
  return [
    '__test__',
    'test',
    'placeholder',
    'domain-id',
    '[도메인] 결정 제목',
  ].includes(normalized);
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  const result = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.+)$/);
    if (!kv) {
      continue;
    }

    result[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, '$1');
  }

  return result;
}
