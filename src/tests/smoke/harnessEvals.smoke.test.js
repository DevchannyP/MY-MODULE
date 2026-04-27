'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const REPORT_PATH = path.join(ROOT, 'artifacts', 'evals', 'harness', 'latest', 'harness-eval-report.json');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'run-harness-evals.js');
const GOLDEN_PATH = path.join(ROOT, 'evals', 'golden', 'harness-core.jsonl');

test('[harness evals smoke] offline harness eval runner emits a report artifact', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  const goldenCaseCount = fs.readFileSync(GOLDEN_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .length;
  assert.equal(report.status, 'PASS');
  assert.equal(report.summary.golden_case_count, goldenCaseCount);
  assert.ok(report.summary.case_files >= 5, `expected at least 5 case files, got ${report.summary.case_files}`);
  assert.ok(Array.isArray(report.case_files));
  assert.ok(fs.existsSync(REPORT_PATH));
  assert.deepEqual(report.checks.validation_failures, [], 'golden set should have no validation failures');
  assert.equal(report.checks.required_modes_present, true, 'all 5 modes (Research/Build/Debug/Operate/Policy) must be present');
  assert.equal(report.checks.required_packet_types_present, true, 'all 5 packet types (arch/governance/meta/shell/executor) must be present');
  assert.deepEqual(report.checks.packet_type_coverage.missing, [], 'no packet type should be missing');
});
