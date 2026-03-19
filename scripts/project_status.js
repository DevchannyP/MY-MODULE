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

function extractNextWp(nextActions) {
  if (typeof nextActions.next_wp === 'string') {
    return nextActions.next_wp;
  }

  const queue = Array.isArray(nextActions.queue) ? nextActions.queue : [];
  if (queue.length > 0 && typeof queue[0]?.id === 'string') {
    return queue[0].id;
  }

  return 'UNKNOWN';
}

function main() {
  const requirements = readYaml('requirements/requirements.yaml');
  const currentState = readYaml('memory/current-state.yaml');
  const currentWp = readYaml('memory/current-wp.yaml');
  const nextActions = readYaml('memory/next-actions.yaml');
  const legacyProjectState = readYaml('memory/project/current-state.yaml');
  const legacyStageStates = getLegacyStageStates();

  const report = {
    execution_mode: 'read-only-status',
    repository: 'my-module',
    requirements_stage: typeof requirements.stage === 'string' ? requirements.stage : 'UNKNOWN',
    current_wp: typeof currentWp.id === 'string' ? currentWp.id : 'UNKNOWN',
    last_completed_wp: currentState.last_completed_wp?.id || 'UNKNOWN',
    next_wp: extractNextWp(nextActions),
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

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
