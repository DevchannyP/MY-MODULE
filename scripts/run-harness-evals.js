'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN_PATH = path.join(ROOT, 'evals', 'golden', 'harness-core.jsonl');
const BASELINE_PATH = path.join(ROOT, 'evals', 'metrics', 'baseline.json');
const CASES_DIR = path.join(ROOT, 'evals', 'cases');
const OUTPUT_DIR = path.join(ROOT, 'artifacts', 'evals', 'harness', 'latest');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'harness-eval-report.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonLines(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function stableNow() {
  return new Date().toISOString();
}

function summarizeModes(records) {
  return records.reduce((acc, record) => {
    const key = String(record.mode || 'UNKNOWN');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function summarizePacketTypes(records) {
  return records.reduce((acc, record) => {
    const key = String(record.packet_type || 'UNKNOWN');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function validateGoldenRecords(records) {
  const failures = [];

  records.forEach((record) => {
    if (!record.id) failures.push('missing id');
    if (!record.mode) failures.push(`${record.id || 'unknown'} missing mode`);
    if (!record.packet_type) failures.push(`${record.id || 'unknown'} missing packet_type`);
    if (!record.input || typeof record.input !== 'object') failures.push(`${record.id || 'unknown'} missing input`);
    if (!record.expect || typeof record.expect !== 'object') failures.push(`${record.id || 'unknown'} missing expect`);

    if (record.expect && !Array.isArray(record.expect.required_sections)) {
      failures.push(`${record.id || 'unknown'} missing expect.required_sections`);
    }
  });

  return failures;
}

function loadCaseFiles() {
  if (!fs.existsSync(CASES_DIR)) {
    return [];
  }

  return fs.readdirSync(CASES_DIR)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .map((name) => {
      const absolute = path.join(CASES_DIR, name);
      const rows = readJsonLines(absolute);
      return {
        path: path.relative(ROOT, absolute),
        count: rows.length,
        modes: Array.from(new Set(rows.map((row) => String(row.mode || 'UNKNOWN')))).sort(),
        ids: rows.map((row) => String(row.id || 'UNKNOWN')),
      };
    });
}

function buildReport() {
  const golden = readJsonLines(GOLDEN_PATH);
  const baseline = readJson(BASELINE_PATH);
  const validationFailures = validateGoldenRecords(golden);
  const modeCoverage = summarizeModes(golden);
  const packetTypeCoverage = summarizePacketTypes(golden);
  const caseFiles = loadCaseFiles();
  const report = {
    eval_run_id: crypto.randomUUID(),
    generated_at_utc: stableNow(),
    repository: 'my-module',
    suite: 'harness-core-offline',
    baseline_id: String(baseline.baseline_id || 'unknown'),
    prompt_version: String(baseline.prompt_version || 'unknown'),
    status: validationFailures.length === 0 ? 'PASS' : 'FAIL',
    summary: {
      golden_case_count: golden.length,
      baseline_case_count: Number(baseline?.golden_set?.case_count || 0),
      case_count_delta: golden.length - Number(baseline?.golden_set?.case_count || 0),
      modes: modeCoverage,
      packet_types: packetTypeCoverage,
      case_files: caseFiles.length,
    },
    checks: {
      golden_set_parsed: true,
      baseline_loaded: true,
      required_case_floor_met: golden.length >= 10,
      required_modes_present: ['Research', 'Build', 'Debug', 'Operate', 'Policy'].every((mode) => Object.prototype.hasOwnProperty.call(modeCoverage, mode)),
      validation_failures: validationFailures,
    },
    case_files: caseFiles,
    next_steps: validationFailures.length === 0
      ? [
        '모델 호출 기반 grader를 추가한다',
        'baseline 대비 schema_violation_rate와 retry_rate를 측정한다',
        'safety/red-team case file을 별도 추가한다',
      ]
      : [
        'golden set record schema를 수정한다',
        '누락된 mode 또는 required field를 보완한다',
      ],
  };

  return report;
}

function main() {
  ensureDir(OUTPUT_DIR);
  const report = buildReport();
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  process.stdout.write([
    '=== Harness Evals ===',
    `status      : ${report.status}`,
    `eval_run_id : ${report.eval_run_id}`,
    `golden      : ${report.summary.golden_case_count}`,
    `baseline    : ${report.summary.baseline_case_count}`,
    `case delta  : ${report.summary.case_count_delta}`,
    `artifact    : artifacts/evals/harness/latest/harness-eval-report.json`,
  ].join('\n') + '\n');

  if (report.checks.validation_failures.length > 0) {
    process.stdout.write('[Failures]\n');
    report.checks.validation_failures.forEach((item) => process.stdout.write(`- ${item}\n`));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
};
