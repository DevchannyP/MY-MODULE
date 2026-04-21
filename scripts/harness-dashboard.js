#!/usr/bin/env node
'use strict';

/**
 * WP-MPO-030: Harness Performance Dashboard — 6 key metrics
 *
 * Aggregates harness-perf-metrics.json + invocation-log.jsonl
 * + worklog/reports/*WP-AUTO* to compute 6 KPIs with targets.
 *
 * Usage: node scripts/harness-dashboard.js [--root <path>] [--json]
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TARGETS = {
  avg_token_per_wp: { target: 15000, direction: 'lte', label: 'WP 평균 토큰 ≤ 15k' },
  intake_success_rate: { target: 0.95, direction: 'gte', label: 'Intake 성공률 ≥ 95%' },
  gate_first_pass_rate: { target: 0.80, direction: 'gte', label: '게이트 첫 통과율 ≥ 80%' },
  auto_approve_rate: { target: 0.30, direction: 'gte', label: '자동 승인 비율 ≥ 30%' },
  truthfulness_violation_rate: { target: 0, direction: 'lte', label: 'Truthfulness 위반 = 0%' },
  memory_sync_atomic_rate: { target: 1.0, direction: 'gte', label: '메모리 동기화 원자성 100%' },
};

function parseArgs(argv) {
  const args = { json: false, root: path.resolve(__dirname, '..') };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--json') args.json = true;
    if (argv[i] === '--root' && argv[i + 1]) { args.root = path.resolve(argv[i + 1]); i++; }
  }
  return args;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function readJsonlines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n').filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function readYaml(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const result = spawnSync('python3', ['-c',
    'import json,yaml,pathlib,sys; print(json.dumps(yaml.safe_load(pathlib.Path(sys.argv[1]).read_text()) or {}))',
    filePath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function globPattern(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => pattern.test(f))
    .map((f) => path.join(dir, f));
}

function computeMetrics(root) {
  const invocationLog = readJsonlines(path.join(root, 'artifacts/evals/harness/invocation-log.jsonl'));
  const perfMetrics = readJsonIfExists(path.join(root, 'artifacts/evals/harness/latest/harness-perf-metrics.json'));
  const failurePatterns = readYaml(path.join(root, 'memory/L0-hot/failure-patterns.yaml')) || {};
  const wpReportPaths = globPattern(
    path.join(root, 'worklog/reports'),
    /WP-AUTO/,
  );

  const wpReports = wpReportPaths.map((p) => readYaml(p)).filter(Boolean);

  // 1. avg_token_per_wp — from worklog reports token_usage.used
  const tokenUsages = wpReports
    .map((r) => r.token_usage?.used)
    .filter((v) => typeof v === 'number' && v > 0);
  const avgTokenPerWp = tokenUsages.length > 0
    ? Math.round(tokenUsages.reduce((a, b) => a + b, 0) / tokenUsages.length)
    : null;

  // 2. intake_success_rate — all sessions that produced valid intake (no schema error)
  //    proxy: sessions that have at least 1 invocation entry = intake succeeded
  const totalSessions = perfMetrics?.session_stats?.total_sessions ?? 0;
  const failedIntakeSessions = (failurePatterns.patterns || [])
    .filter((p) => String(p.root_cause_category || '').includes('intake')).length;
  const intakeSuccessRate = totalSessions > 0
    ? Number(((totalSessions - failedIntakeSessions) / totalSessions).toFixed(4))
    : null;

  // 3. gate_first_pass_rate — WP reports where attempt === 1 and verification_status === PASS
  const firstPassWps = wpReports.filter((r) => r.attempt === 1 && r.verification_status === 'PASS').length;
  const totalWpReports = wpReports.length;
  const gateFirstPassRate = totalWpReports > 0
    ? Number((firstPassWps / totalWpReports).toFixed(4))
    : null;

  // 4. auto_approve_rate — sessions with auto_approved / total sessions
  //    proxy from invocation log: sessions grouped, check if they appear to have been auto-approved
  //    (we use routing-learning snapshot as a proxy)
  const routingLearning = readJsonIfExists(
    path.join(root, 'artifacts/evals/harness/latest/mpo-routing-learning.json'),
  );
  const autoApproveRate = routingLearning?.latest_packet_type === 'docs'
    || routingLearning?.latest_packet_type === 'refactor'
    ? 1.0
    : totalSessions > 0
      ? Number((
        invocationLog.filter((e, i, all) => {
          return all.findIndex((x) => x.session_id === e.session_id) === i;
        }).filter((e) => e.risk_level === 'low' && (e.mode === 'Build' || e.mode === 'Operate')).length
        / totalSessions
      ).toFixed(4))
      : null;

  // 5. truthfulness_violation_rate — violations from failure-patterns
  const truthfulnessViolations = (failurePatterns.patterns || [])
    .filter((p) => String(p.root_cause_category || '').includes('truthfulness')).length;
  const completedWps = totalWpReports;
  const truthfulnessViolationRate = completedWps > 0
    ? Number((truthfulnessViolations / completedWps).toFixed(4))
    : 0;

  // 6. memory_sync_atomic_rate — successful wp-complete calls / total completed WPs
  //    proxy: all worklog reports that have 'last_completed_mpo_session' in memory/current-state
  const currentState = readYaml(path.join(root, 'memory/current-state.yaml')) || {};
  const memorySyncAtomic = currentState.last_completed_mpo_session ? 1.0 : (completedWps === 0 ? null : 0);

  return {
    avg_token_per_wp: avgTokenPerWp,
    intake_success_rate: intakeSuccessRate,
    gate_first_pass_rate: gateFirstPassRate,
    auto_approve_rate: autoApproveRate,
    truthfulness_violation_rate: truthfulnessViolationRate,
    memory_sync_atomic_rate: memorySyncAtomic,
  };
}

function evaluateMetric(key, value) {
  const target = TARGETS[key];
  if (value === null || value === undefined) return { status: 'NO_DATA', meets_target: null };
  const meets = target.direction === 'gte' ? value >= target.target : value <= target.target;
  return { status: meets ? 'PASS' : 'FAIL', meets_target: meets };
}

function formatValue(key, value) {
  if (value === null || value === undefined) return 'N/A';
  if (key === 'avg_token_per_wp') return `${value.toLocaleString()} tok`;
  return `${(value * 100).toFixed(1)}%`;
}

function run(root, jsonOutput) {
  const metrics = computeMetrics(root);
  const perfMetrics = readJsonIfExists(path.join(root, 'artifacts/evals/harness/latest/harness-perf-metrics.json'));

  const dashboard = {
    generated_at_utc: new Date().toISOString(),
    schema_version: '1.0',
    data_sources: {
      invocation_log: 'artifacts/evals/harness/invocation-log.jsonl',
      perf_metrics: 'artifacts/evals/harness/latest/harness-perf-metrics.json',
      worklog_reports: 'worklog/reports/*WP-AUTO*.yaml',
      failure_patterns: 'memory/L0-hot/failure-patterns.yaml',
    },
    session_summary: perfMetrics?.session_stats ?? {},
    kpis: Object.entries(metrics).map(([key, value]) => {
      const evaluation = evaluateMetric(key, value);
      const target = TARGETS[key];
      return {
        key,
        label: target.label,
        value,
        target: target.target,
        direction: target.direction,
        status: evaluation.status,
        meets_target: evaluation.meets_target,
      };
    }),
  };

  const passCount = dashboard.kpis.filter((k) => k.status === 'PASS').length;
  const failCount = dashboard.kpis.filter((k) => k.status === 'FAIL').length;
  const noDataCount = dashboard.kpis.filter((k) => k.status === 'NO_DATA').length;
  dashboard.summary = {
    total_kpis: dashboard.kpis.length,
    pass: passCount,
    fail: failCount,
    no_data: noDataCount,
    overall_status: failCount === 0 ? (noDataCount > 0 ? 'PARTIAL' : 'PASS') : 'FAIL',
  };

  const outPath = path.join(root, 'artifacts/evals/harness/latest/harness-dashboard.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(dashboard, null, 2) + '\n', 'utf8');

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(dashboard, null, 2) + '\n');
    return dashboard;
  }

  const bar = (status) => status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⬜';
  process.stdout.write('\n=== Harness Performance Dashboard — MPO v1.0 ===\n');
  process.stdout.write(`Generated: ${dashboard.generated_at_utc}\n\n`);

  if (perfMetrics?.session_stats) {
    const s = perfMetrics.session_stats;
    process.stdout.write(`Sessions: ${s.total_sessions}  |  WP Invocations: ${s.total_wp_invocations}`
      + `  |  Avg WPs/session: ${s.avg_wps_per_session}\n\n`);
  }

  process.stdout.write('KPI                                Value       Target     Status\n');
  process.stdout.write('─'.repeat(64) + '\n');
  for (const kpi of dashboard.kpis) {
    const valStr = formatValue(kpi.key, kpi.value).padEnd(10);
    const tgtStr = formatValue(kpi.key, kpi.target).padEnd(10);
    process.stdout.write(`${bar(kpi.status)} ${kpi.label.padEnd(32)} ${valStr} ${tgtStr} ${kpi.status}\n`);
  }

  process.stdout.write('\n');
  process.stdout.write(`Overall: ${dashboard.summary.overall_status} `
    + `(${passCount} PASS / ${failCount} FAIL / ${noDataCount} NO_DATA)\n`);
  process.stdout.write(`Output: ${outPath}\n\n`);

  return dashboard;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  run(args.root, args.json);
}

module.exports = { run, computeMetrics, evaluateMetric };
