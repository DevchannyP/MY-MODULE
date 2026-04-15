'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const RELEASE_EVIDENCE_PATH = path.join(ROOT, 'artifacts/release-evidence/release-evidence.json');
const HARNESS_CONTRACT_PATH = path.join(ROOT, 'requirements/harness-engineering.yaml');

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return {};
  }
}

function readPromptVersionFallback() {
  if (!fs.existsSync(HARNESS_CONTRACT_PATH)) {
    return 'unknown';
  }

  const content = fs.readFileSync(HARNESS_CONTRACT_PATH, 'utf8');
  const matched = content.match(/^version:\s*"([^"]+)"/m);
  return matched ? matched[1] : 'unknown';
}

function loadHarnessReleaseMetadata() {
  const evidence = readJsonIfExists(RELEASE_EVIDENCE_PATH);
  const harnessRelease = evidence.harness_release && typeof evidence.harness_release === 'object'
    ? evidence.harness_release
    : {};

  return {
    prompt_version: String(harnessRelease.prompt_version || readPromptVersionFallback()),
    rollout_stage: String(harnessRelease.rollout_stage || 'unknown'),
    rollback_target: String(harnessRelease.rollback_target || 'unknown'),
    rollback_strategy: String(harnessRelease.rollback_strategy || 'unknown'),
    output_schema_ref: String(harnessRelease.output_schema_ref || 'contracts/harness/output.schema.json'),
    release_evidence_present: fs.existsSync(RELEASE_EVIDENCE_PATH),
  };
}

function evaluateFlag(flagsProvider, flagName) {
  if (!flagsProvider || typeof flagsProvider.isEnabled !== 'function') {
    return false;
  }

  return Boolean(flagsProvider.isEnabled(flagName, false, {
    route: '/harness-runtime',
    method: 'GET',
    userId: 'system',
    targetingKey: 'harness-runtime',
  }));
}

function resolveRouteShape(mode, toggles) {
  switch (mode) {
    case 'Research':
      return toggles.frontierResearch
        ? { route_id: 'frontier-research', selected_model_tier: 'frontier', reasoning_effort: 'high' }
        : { route_id: 'standard-research', selected_model_tier: 'standard', reasoning_effort: 'medium' };
    case 'Build':
      return toggles.miniBuild
        ? { route_id: 'mini-build', selected_model_tier: 'mini', reasoning_effort: 'medium' }
        : { route_id: 'standard-build', selected_model_tier: 'standard', reasoning_effort: 'medium' };
    case 'Debug':
      return toggles.frontierResearch
        ? { route_id: 'frontier-debug', selected_model_tier: 'frontier', reasoning_effort: 'high' }
        : { route_id: 'standard-debug', selected_model_tier: 'standard', reasoning_effort: 'high' };
    case 'Operate':
      return toggles.miniBuild
        ? { route_id: 'mini-operate', selected_model_tier: 'mini', reasoning_effort: 'medium' }
        : { route_id: 'standard-operate', selected_model_tier: 'standard', reasoning_effort: 'medium' };
    case 'Policy':
      return toggles.frontierResearch
        ? { route_id: 'frontier-policy', selected_model_tier: 'frontier', reasoning_effort: 'high' }
        : { route_id: 'standard-policy', selected_model_tier: 'standard', reasoning_effort: 'high' };
    default:
      return { route_id: 'standard-default', selected_model_tier: 'standard', reasoning_effort: 'medium' };
  }
}

function resolveHarnessRuntimeRoute({ mode = 'Build', flagsProvider = null } = {}) {
  const release = loadHarnessReleaseMetadata();
  const toggles = {
    frontierResearch: evaluateFlag(flagsProvider, 'harness_routing_frontier_research'),
    miniBuild: evaluateFlag(flagsProvider, 'harness_routing_mini_build'),
    promptCaching: evaluateFlag(flagsProvider, 'harness_prompt_caching_enabled'),
    batchEval: evaluateFlag(flagsProvider, 'harness_batch_eval_enabled'),
  };
  const routeShape = resolveRouteShape(String(mode || 'Build'), toggles);

  return {
    mode: String(mode || 'Build'),
    recipe_id: 'harness-vnext-router',
    prompt_version: release.prompt_version,
    rollout_stage: release.rollout_stage,
    rollback_target: release.rollback_target,
    rollback_strategy: release.rollback_strategy,
    output_schema_ref: release.output_schema_ref,
    release_evidence_present: release.release_evidence_present,
    route_id: routeShape.route_id,
    selected_model_tier: routeShape.selected_model_tier,
    reasoning_effort: routeShape.reasoning_effort,
    prompt_caching_enabled: toggles.promptCaching,
    batch_eval_enabled: toggles.batchEval,
    batch_recommended: toggles.batchEval && ['Research', 'Policy'].includes(String(mode || 'Build')),
    flags_consumed: [
      'harness_routing_frontier_research',
      'harness_routing_mini_build',
      'harness_prompt_caching_enabled',
      'harness_batch_eval_enabled',
    ],
  };
}

module.exports = {
  resolveHarnessRuntimeRoute,
  loadHarnessReleaseMetadata,
};
