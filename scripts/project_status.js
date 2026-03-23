'use strict';

const { STAGE_ORDER, readYaml, getLegacyStageStates, evaluateStage } = require('./run_stage');

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

  return {
    execution_mode: 'read-only-status',
    repository: 'my-module',
    requirements_stage: typeof requirements.stage === 'string' ? requirements.stage : 'UNKNOWN',
    current_wp: typeof currentWp.id === 'string' ? currentWp.id : 'UNKNOWN',
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
