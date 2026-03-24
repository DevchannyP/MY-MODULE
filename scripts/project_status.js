'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { STAGE_ORDER, readYaml, getLegacyStageStates, evaluateStage } = require('./run_stage');

const REPO_ROOT = path.resolve(__dirname, '..');
const PROMOTION_ARTIFACT_DIR = path.join(REPO_ROOT, 'artifacts', 'promotion-pipeline', 'latest');
const BENCHMARK_CATALOG_PATH = 'master-shell/catalog/benchmark-signals.yaml';

function estimateTokensFromBytes(byteCount) {
  if (!Number.isFinite(byteCount) || byteCount <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(byteCount / 4));
}

function collectPathMetric(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) {
    return { path: relativePath || '', exists: false, file_count: 0, total_bytes: 0, estimated_tokens: 0 };
  }

  const target = path.resolve(REPO_ROOT, relativePath.replace(/\/$/, ''));
  if (!fs.existsSync(target)) {
    return { path: relativePath, exists: false, file_count: 0, total_bytes: 0, estimated_tokens: 0 };
  }

  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return {
      path: relativePath,
      exists: true,
      file_count: 1,
      total_bytes: stat.size,
      estimated_tokens: estimateTokensFromBytes(stat.size),
    };
  }

  let fileCount = 0;
  let totalBytes = 0;
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        return;
      }
      if (entry.isFile()) {
        const entryStat = fs.statSync(fullPath);
        fileCount += 1;
        totalBytes += entryStat.size;
      }
    });
  }
  return {
    path: relativePath,
    exists: true,
    file_count: fileCount,
    total_bytes: totalBytes,
    estimated_tokens: estimateTokensFromBytes(totalBytes),
  };
}

function summarizeContextBudget(contextBudget) {
  const tierReads = Array.isArray(contextBudget?.tier_reads) ? contextBudget.tier_reads : [];
  const contextReads = Array.isArray(contextBudget?.context_reads) ? contextBudget.context_reads : [];
  const metricSummary = (paths) => paths.reduce((acc, currentPath) => {
    const metric = collectPathMetric(currentPath);
    acc.file_count += metric.file_count;
    acc.total_bytes += metric.total_bytes;
    acc.estimated_tokens += metric.estimated_tokens;
    return acc;
  }, { file_count: 0, total_bytes: 0, estimated_tokens: 0 });

  const tierSummary = metricSummary(tierReads);
  const contextSummary = metricSummary(contextReads);
  return {
    tier_reads: tierReads.length,
    context_reads: contextReads.length,
    tier_files: tierSummary.file_count,
    context_files: contextSummary.file_count,
    estimated_tokens: tierSummary.estimated_tokens + contextSummary.estimated_tokens,
  };
}

function findCanonicalWpById(wpQueue, wpId) {
  if (typeof wpId !== 'string' || !wpId) {
    return null;
  }

  const capabilities = Array.isArray(wpQueue?.capabilities) ? wpQueue.capabilities : [];
  for (const capability of capabilities) {
    const workPackets = Array.isArray(capability?.work_packets) ? capability.work_packets : [];
    for (const workPacket of workPackets) {
      if (workPacket?.id === wpId) {
        return workPacket;
      }
    }
  }

  return null;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha1ForFile(filePath) {
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}

function summarizePromotionPipeline() {
  const pipelineReportPath = path.join(PROMOTION_ARTIFACT_DIR, 'pipeline-report.json');
  const contextLockPath = path.join(PROMOTION_ARTIFACT_DIR, 'context-lock.json');
  const pipelineReport = readJsonIfExists(pipelineReportPath);
  const contextLock = readJsonIfExists(contextLockPath);

  const lockedFiles = [];
  ['primary', 'secondary'].forEach((tier) => {
    const entries = Array.isArray(contextLock?.locked_files?.[tier]) ? contextLock.locked_files[tier] : [];
    entries.forEach((entry) => {
      if (entry && entry.exists !== false && typeof entry.path === 'string') {
        lockedFiles.push(entry);
      }
    });
  });

  let changed = 0;
  let missing = 0;
  lockedFiles.forEach((entry) => {
    const target = path.join(REPO_ROOT, entry.path);
    if (!fs.existsSync(target)) {
      missing += 1;
      return;
    }
    if (sha1ForFile(target) !== entry.sha1) {
      changed += 1;
    }
  });

  return {
    artifact_dir: 'artifacts/promotion-pipeline/latest',
    available: Boolean(Object.keys(pipelineReport).length || Object.keys(contextLock).length),
    promotion_ready: Boolean(pipelineReport.promotion_ready),
    locked_tokens: Number(pipelineReport.locked_context_budget?.locked_total_estimated_tokens || 0),
    locked_files: lockedFiles.length,
    drift_status: changed || missing ? 'drifted' : 'clean',
    changed_files: changed,
    missing_files: missing,
  };
}

function summarizeScopeBoundary(currentWp) {
  const scopeIn = Array.isArray(currentWp?.scope_in) ? currentWp.scope_in : [];
  const scopeOut = Array.isArray(currentWp?.scope_out) ? currentWp.scope_out : [];
  return {
    scope_in: scopeIn.length,
    scope_out: scopeOut.length,
    protects_core: scopeOut.some((item) => /system os|master os|domains\//i.test(String(item))),
  };
}

function summarizeCapabilities(currentState) {
  const capabilities = Array.isArray(currentState.working_capabilities)
    ? currentState.working_capabilities
    : [];

  return capabilities.map((item) => ({
    id: item.id || 'UNKNOWN',
    status: item.status || 'unknown',
  }));
}

function summarizeManualPlaceholders(currentState) {
  const placeholders = Array.isArray(currentState.placeholders_manual)
    ? currentState.placeholders_manual
    : [];

  return placeholders.map((item) => ({
    id: item.id || 'UNKNOWN',
    status: item.status || 'unknown',
  }));
}

function summarizeKnownIssues(currentState) {
  const issues = Array.isArray(currentState.known_issues)
    ? currentState.known_issues
    : [];

  return issues.map((item) => ({
    id: item.id || 'UNKNOWN',
    severity: item.severity || 'unknown',
  }));
}

function summarizeEssentialImprovements(promotionPipeline) {
  const benchmarkCatalog = readYaml(BENCHMARK_CATALOG_PATH);
  const essentialImprovements = Array.isArray(benchmarkCatalog.essential_improvements)
    ? benchmarkCatalog.essential_improvements
    : [];
  const essentialIds = new Set(essentialImprovements.map((item) => item.id).filter(Boolean));
  const plannerArtifactReady = fs.existsSync(path.join(REPO_ROOT, 'artifacts', 'master-planner', 'index.html'));
  const intakeReady = fs.existsSync(path.join(REPO_ROOT, 'master-shell', 'catalog', 'project-intake-canvas.yaml'));
  const liveOpsReady = fs.existsSync(path.join(REPO_ROOT, 'master-shell', 'observability', 'timeline.jsonl'))
    && fs.existsSync(path.join(REPO_ROOT, 'master-shell', 'catalog', 'learning-replay-lenses.yaml'));

  return [
    {
      id: 'master-planning-truth-surface',
      tracked: essentialIds.has('master-planning-truth-surface'),
      ready: plannerArtifactReady && intakeReady,
      detail: 'planner artifact + intake canvas + benchmark-backed planning triad',
    },
    {
      id: 'minimum-context-routing-performance',
      tracked: essentialIds.has('minimum-context-routing-performance'),
      ready: Boolean(promotionPipeline.available && promotionPipeline.locked_tokens >= 0),
      detail: 'promotion pipeline + context lock + drift awareness',
    },
    {
      id: 'guided-learning-live-ops-cockpit',
      tracked: essentialIds.has('guided-learning-live-ops-cockpit'),
      ready: liveOpsReady,
      detail: 'timeline feed + replay lenses + observability surfaces',
    },
  ];
}

function buildStageSummary(requirements, currentState, currentWp, legacyStageStates) {
  return STAGE_ORDER.map((stage) => {
    const evaluated = evaluateStage(stage, requirements, currentState, currentWp, legacyStageStates);
    return {
      stage,
      route_status: evaluated.status,
      legacy_stage_state: evaluated.legacy_stage_state,
      unmet_prerequisites: evaluated.unmet_prerequisites,
      docs_ref: evaluated.docs_ref,
      recommended_commands: evaluated.recommended_commands,
    };
  });
}

function collectCanonicalWps(wpQueue) {
  const capabilities = Array.isArray(wpQueue.capabilities) ? wpQueue.capabilities : [];
  const wps = [];

  capabilities.forEach((capability) => {
    const workPackets = Array.isArray(capability.work_packets) ? capability.work_packets : [];
    workPackets.forEach((wp) => {
      wps.push({
        id: typeof wp.id === 'string' ? wp.id : 'UNKNOWN',
        status: typeof wp.status === 'string' ? wp.status : 'unknown',
        tierPriority: ({
          infra: 0,
          arch: 1,
          governance: 2,
          domain: 3,
          meta: 4,
        })[wp.tier] ?? 99,
        capPriority: typeof capability.priority === 'number' ? capability.priority : 99,
        dependsOn: Array.isArray(wp.depends_on) ? wp.depends_on : [],
      });
    });
  });

  return wps;
}

function extractNextWp(nextActions, wpQueue) {
  const canonicalWps = collectCanonicalWps(wpQueue);
  if (canonicalWps.length === 0) {
    return typeof nextActions.next_wp === 'string' ? nextActions.next_wp : 'UNKNOWN';
  }

  const doneIds = new Set(
    canonicalWps
      .filter((wp) => wp.status === 'done')
      .map((wp) => wp.id)
  );

  const ready = canonicalWps
    .filter((wp) => wp.status === 'pending' && wp.dependsOn.every((dependency) => doneIds.has(dependency)))
    .sort((left, right) => {
      if (left.tierPriority !== right.tierPriority) {
        return left.tierPriority - right.tierPriority;
      }
      if (left.capPriority !== right.capPriority) {
        return left.capPriority - right.capPriority;
      }
      return left.id.localeCompare(right.id);
    });

  if (ready.length > 0) {
    return ready[0].id;
  }

  return 'NONE';
}

function buildReport() {
  const requirements = readYaml('requirements/requirements.yaml');
  const currentState = readYaml('memory/current-state.yaml');
  const currentWp = readYaml('memory/current-wp.yaml');
  const nextActions = readYaml('memory/next-actions.yaml');
  const wpQueue = readYaml('memory/wp-queue.yaml');
  const legacyProjectState = readYaml('memory/project/current-state.yaml');
  const legacyStageStates = getLegacyStageStates();
  const promotionPipeline = summarizePromotionPipeline();
  const canonicalCurrentWp = findCanonicalWpById(wpQueue, currentWp.id);
  const currentWpContextBudget = summarizeContextBudget(
    currentWp.context_budget || canonicalCurrentWp?.context_budget
  );

  return {
    execution_mode: 'read-only-status',
    repository: 'my-module',
    requirements_stage: typeof requirements.stage === 'string' ? requirements.stage : 'UNKNOWN',
    current_wp: typeof currentWp.id === 'string' ? currentWp.id : 'UNKNOWN',
    current_wp_goal: typeof currentWp.goal === 'string' ? currentWp.goal : 'UNKNOWN',
    current_wp_type: typeof currentWp.type === 'string' ? currentWp.type : 'UNKNOWN',
    current_wp_stage: typeof currentWp.stage === 'string' ? currentWp.stage : 'UNKNOWN',
    current_wp_context_budget: currentWpContextBudget,
    current_wp_scope_boundary: summarizeScopeBoundary(currentWp),
    promotion_pipeline: promotionPipeline,
    essential_improvements: summarizeEssentialImprovements(promotionPipeline),
    last_completed_wp: currentState.last_completed_wp?.id || 'UNKNOWN',
    next_wp: extractNextWp(nextActions, wpQueue),
    legacy_last_completed_stage: legacyProjectState.last_completed_stage || 'UNKNOWN',
    stage_summary: buildStageSummary(requirements, currentState, currentWp, legacyStageStates),
    capabilities: summarizeCapabilities(currentState),
    manual_placeholders: summarizeManualPlaceholders(currentState),
    known_issues: summarizeKnownIssues(currentState),
    memory_sources: {
      current_state: 'memory/current-state.yaml',
      current_wp: 'memory/current-wp.yaml',
      next_actions: 'memory/next-actions.yaml',
      legacy_project_state: 'memory/project/current-state.yaml',
    },
  };
}

function main() {
  process.stdout.write(`${JSON.stringify(buildReport(), null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
};
