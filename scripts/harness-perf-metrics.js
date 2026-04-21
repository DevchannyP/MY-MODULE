'use strict';

/**
 * WP-MPO-029: Live eval metric loop
 *
 * Reads artifacts/evals/harness/invocation-log.jsonl and
 * artifacts/evals/harness/latest/harness-eval-report.json, then
 * computes per-tier metrics and writes harness-perf-metrics.json.
 *
 * Usage: node scripts/harness-perf-metrics.js [--root <path>]
 */

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) {
      args.root = argv[i + 1];
      i++;
    }
  }
  return args;
}

function readJsonlines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function computeTierStats(invocationEntries, providerInvocations) {
  const tierMap = {};

  for (const entry of invocationEntries) {
    const tier = entry.selected_model_tier || 'unknown';
    if (!tierMap[tier]) {
      tierMap[tier] = {
        invocation_count: 0,
        session_ids: new Set(),
        wp_ids: new Set(),
        route_ids: new Set(),
        risk_levels: {},
        trust_levels: {},
      };
    }
    const t = tierMap[tier];
    t.invocation_count++;
    if (entry.session_id) t.session_ids.add(entry.session_id);
    if (entry.wp_id) t.wp_ids.add(entry.wp_id);
    if (entry.route_id) t.route_ids.add(entry.route_id);
    if (entry.risk_level) t.risk_levels[entry.risk_level] = (t.risk_levels[entry.risk_level] || 0) + 1;
    if (entry.trust_level) t.trust_levels[entry.trust_level] = (t.trust_levels[entry.trust_level] || 0) + 1;
  }

  const provMap = {};
  for (const prov of (providerInvocations || [])) {
    const tier = prov.selected_model_tier || 'unknown';
    if (!provMap[tier]) {
      provMap[tier] = { schema_valid_count: 0, schema_invalid_count: 0, fallback_count: 0, latencies: [] };
    }
    const p = provMap[tier];
    if (prov.schema_valid === true) p.schema_valid_count++;
    else p.schema_invalid_count++;
    if (prov.fallback_applied === true) p.fallback_count++;
    if (typeof prov.latency_ms === 'number') p.latencies.push(prov.latency_ms);
  }

  const tiers = {};
  for (const [tier, t] of Object.entries(tierMap)) {
    const p = provMap[tier] || { schema_valid_count: 0, schema_invalid_count: 0, fallback_count: 0, latencies: [] };
    const provTotal = p.schema_valid_count + p.schema_invalid_count;
    const avgLatency = p.latencies.length > 0
      ? Math.round(p.latencies.reduce((a, b) => a + b, 0) / p.latencies.length)
      : null;

    tiers[tier] = {
      invocation_count: t.invocation_count,
      unique_sessions: t.session_ids.size,
      unique_wps: t.wp_ids.size,
      routes: [...t.route_ids],
      risk_level_distribution: t.risk_levels,
      trust_level_distribution: t.trust_levels,
      schema_valid_count: p.schema_valid_count,
      schema_invalid_count: p.schema_invalid_count,
      success_rate: provTotal > 0 ? Number((p.schema_valid_count / provTotal).toFixed(4)) : null,
      fallback_count: p.fallback_count,
      fallback_rate: provTotal > 0 ? Number((p.fallback_count / provTotal).toFixed(4)) : null,
      avg_latency_ms: avgLatency,
      latency_sample_count: p.latencies.length,
    };
  }
  return tiers;
}

function computeSessionStats(invocationEntries) {
  const sessionMap = {};
  for (const entry of invocationEntries) {
    const sid = entry.session_id || '__unknown__';
    if (!sessionMap[sid]) sessionMap[sid] = { wp_count: 0, timestamps: [] };
    sessionMap[sid].wp_count++;
    if (entry.ts) sessionMap[sid].timestamps.push(new Date(entry.ts).getTime());
  }

  const wpCounts = Object.values(sessionMap).map((s) => s.wp_count);
  const avgWps = wpCounts.length > 0
    ? Number((wpCounts.reduce((a, b) => a + b, 0) / wpCounts.length).toFixed(2))
    : 0;

  return {
    total_sessions: Object.keys(sessionMap).length,
    total_wp_invocations: invocationEntries.length,
    avg_wps_per_session: avgWps,
    max_wps_per_session: wpCounts.length > 0 ? Math.max(...wpCounts) : 0,
  };
}

function run(root) {
  const logPath = path.join(root, 'artifacts/evals/harness/invocation-log.jsonl');
  const evalReportPath = path.join(root, 'artifacts/evals/harness/latest/harness-eval-report.json');
  const outPath = path.join(root, 'artifacts/evals/harness/latest/harness-perf-metrics.json');

  const invocationEntries = readJsonlines(logPath);
  const evalReport = readJson(evalReportPath);
  const providerInvocations = evalReport ? (evalReport.provider_invocations || []) : [];

  const tierStats = computeTierStats(invocationEntries, providerInvocations);
  const sessionStats = computeSessionStats(invocationEntries);

  const allSchemaValid = providerInvocations.filter((p) => p.schema_valid === true).length;
  const allProvTotal = providerInvocations.length;
  const overallSuccessRate = allProvTotal > 0
    ? Number((allSchemaValid / allProvTotal).toFixed(4))
    : null;

  const output = {
    generated_at_utc: new Date().toISOString(),
    source_log: logPath,
    source_eval_report: evalReportPath,
    session_stats: sessionStats,
    overall_success_rate: overallSuccessRate,
    overall_fallback_count: providerInvocations.filter((p) => p.fallback_applied).length,
    per_tier: tierStats,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  const tierCount = Object.keys(tierStats).length;
  process.stdout.write(
    `[harness-perf-metrics] ${invocationEntries.length} invocations, `
    + `${sessionStats.total_sessions} sessions, ${tierCount} tier(s) → ${outPath}\n`,
  );
  return output;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  const root = args.root ? path.resolve(args.root) : path.resolve(__dirname, '..');
  run(root);
}

module.exports = { run };
