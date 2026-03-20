#!/usr/bin/env node
'use strict';

/**
 * 실행 메트릭 기록
 * node scripts/record-metrics.js {domain} {stage} {duration_sec} {passed} {total} {gate_result}
 */

const fs = require('node:fs');
const path = require('node:path');

const [, , domain, stage, duration, passed, total, gate] = process.argv;
if (!domain || !stage || !gate) {
  process.stderr.write('Usage: node scripts/record-metrics.js {domain} {stage} {duration} {passed} {total} {gate}\n');
  process.exit(1);
}

const metricsFile = path.join(__dirname, '..', 'memory', 'project', 'metrics.yaml');
let content = fs.existsSync(metricsFile) ? fs.readFileSync(metricsFile, 'utf-8') : 'executions: []\n';

const entry = `\n  - date: "${new Date().toISOString().split('T')[0]}"\n    domain: "${domain}"\n    stage: "${stage}"\n    duration_seconds: ${duration || 0}\n    tests_passed: ${passed || 0}\n    tests_total: ${total || 0}\n    gate_result: "${gate}"\n    timestamp: "${new Date().toISOString()}"`;

content = content.replace(/executions:\s*\[\]/, 'executions:' + entry)
  .replace(/^(executions:.+)$/m, (match) => match.endsWith('[]') ? match : match + entry);

if (content.includes('executions: []')) {
  content = 'executions:\n' + entry + '\n';
} else {
  const lines = content.split('\n');
  const lastIndex = lines
    .map((line, index) => line.match(/^\s{2}-/) ? index : -1)
    .filter(index => index !== -1)
    .pop();

  if (lastIndex !== undefined) {
    const indent = '  ';
    lines.splice(
      lastIndex + 1,
      0,
      `${indent}- date: "${new Date().toISOString().split('T')[0]}"`,
      `${indent}  domain: "${domain}"`,
      `${indent}  stage: "${stage}"`,
      `${indent}  duration_seconds: ${duration || 0}`,
      `${indent}  tests_passed: ${passed || 0}`,
      `${indent}  tests_total: ${total || 0}`,
      `${indent}  gate_result: "${gate}"`,
      `${indent}  timestamp: "${new Date().toISOString()}"`
    );
    content = lines.join('\n');
  }
}

fs.writeFileSync(metricsFile, content, 'utf-8');
process.stdout.write(`✅ 메트릭 기록: ${domain} / Stage ${stage} / ${gate}\n`);
